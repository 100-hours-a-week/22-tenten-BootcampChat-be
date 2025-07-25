// backend/services/syncQueueService.js
const redisClient = require('../utils/redisClient');

/**
 * MongoDB 동기화 큐 서비스
 * Redis Streams를 사용하여 Write-Back 전략 구현
 */
class SyncQueueService {
  constructor() {
    this.STREAM_NAME = 'mongo_sync_stream';
    this.CONSUMER_GROUP = 'mongo_sync_workers';
    this.CONSUMER_NAME = `worker_${process.pid}_${Date.now()}`;
    this.MAX_RETRIES = 3;
    this.DEAD_LETTER_STREAM = 'mongo_sync_dead_letter';
  }

  /**
   * 동기화 작업을 큐에 추가
   */
  async enqueueMessageSync(operation, messageData) {
    try {
      const payload = {
        operation,
        data: JSON.stringify(messageData),
        timestamp: new Date().toISOString(),
        retryCount: 0
      };

      // Redis Streams에 작업 추가
      const result = await this.addToStream(this.STREAM_NAME, payload);
      
      console.log(`[SyncQueue] Enqueued ${operation} operation:`, {
        streamId: result,
        messageId: messageData._id,
        operation
      });

      return result;
    } catch (error) {
      console.error('[SyncQueue] Failed to enqueue sync operation:', error);
      throw error;
    }
  }

  /**
   * Redis Streams에 항목 추가
   */
  async addToStream(streamName, payload) {
    try {
      // Redis XADD 명령어 실행
      const fields = [];
      for (const [key, value] of Object.entries(payload)) {
        fields.push(key, value);
      }

      const result = await redisClient.clusterClient.getWriteClient()
        .then(client => client.sendCommand(['XADD', streamName, '*', ...fields]));

      return result;
    } catch (error) {
      console.error('[SyncQueue] Redis XADD error:', error);
      throw error;
    }
  }

  /**
   * 컨슈머 그룹 생성
   */
  async createConsumerGroup() {
    try {
      const client = await redisClient.clusterClient.getWriteClient();
      
      // 컨슈머 그룹이 이미 존재하는지 확인
      try {
        await client.sendCommand(['XGROUP', 'CREATE', this.STREAM_NAME, this.CONSUMER_GROUP, '0', 'MKSTREAM']);
        console.log(`[SyncQueue] Consumer group '${this.CONSUMER_GROUP}' created`);
      } catch (error) {
        if (error.message.includes('BUSYGROUP')) {
          console.log(`[SyncQueue] Consumer group '${this.CONSUMER_GROUP}' already exists`);
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('[SyncQueue] Failed to create consumer group:', error);
      throw error;
    }
  }

  /**
   * 동기화 작업 소비 (블로킹)
   */
  async consumeMessages(callback, timeout = 5000) {
    try {
      const client = await redisClient.clusterClient.getReadClient();
      
      // XREADGROUP 명령어로 메시지 소비
      const result = await client.sendCommand([
        'XREADGROUP', 
        'GROUP', this.CONSUMER_GROUP, this.CONSUMER_NAME,
        'COUNT', '1',
        'BLOCK', timeout.toString(),
        'STREAMS', this.STREAM_NAME, '>'
      ]);

      if (!result || result.length === 0) {
        return null; // 타임아웃 또는 메시지 없음
      }

      // 결과 파싱
      const [streamName, messages] = result[0];
      for (const [messageId, fields] of messages) {
        const payload = this.parseStreamMessage(fields);
        
        console.log(`[SyncQueue] Processing message:`, {
          messageId,
          operation: payload.operation,
          retryCount: payload.retryCount
        });

        try {
          // 콜백 함수로 메시지 처리
          await callback(payload, messageId);
          
          // 성공시 메시지 ACK
          await this.ackMessage(messageId);
          
        } catch (error) {
          console.error('[SyncQueue] Message processing error:', error);
          
          // 재시도 로직
          await this.handleFailedMessage(messageId, payload, error);
        }
      }

      return result;
    } catch (error) {
      console.error('[SyncQueue] Consume messages error:', error);
      throw error;
    }
  }

  /**
   * 스트림 메시지 파싱
   */
  parseStreamMessage(fields) {
    const payload = {};
    for (let i = 0; i < fields.length; i += 2) {
      const key = fields[i];
      const value = fields[i + 1];
      
      if (key === 'data') {
        try {
          payload[key] = JSON.parse(value);
        } catch (error) {
          payload[key] = value;
        }
      } else if (key === 'retryCount') {
        payload[key] = parseInt(value) || 0;
      } else {
        payload[key] = value;
      }
    }
    return payload;
  }

  /**
   * 메시지 처리 완료 ACK
   */
  async ackMessage(messageId) {
    try {
      const client = await redisClient.clusterClient.getWriteClient();
      await client.sendCommand(['XACK', this.STREAM_NAME, this.CONSUMER_GROUP, messageId]);
      
      console.log(`[SyncQueue] Message acknowledged:`, messageId);
    } catch (error) {
      console.error('[SyncQueue] ACK error:', error);
    }
  }

  /**
   * 실패한 메시지 처리
   */
  async handleFailedMessage(messageId, payload, error) {
    try {
      const retryCount = (payload.retryCount || 0) + 1;
      
      if (retryCount <= this.MAX_RETRIES) {
        // 재시도: 새로운 메시지로 큐에 다시 추가
        console.log(`[SyncQueue] Retrying message (${retryCount}/${this.MAX_RETRIES}):`, messageId);
        
        const retryPayload = {
          ...payload,
          retryCount,
          originalMessageId: messageId,
          lastError: error.message,
          retryTimestamp: new Date().toISOString()
        };
        
        await this.addToStream(this.STREAM_NAME, retryPayload);
      } else {
        // 최대 재시도 초과: Dead Letter Queue로 이동
        console.error(`[SyncQueue] Max retries exceeded, moving to dead letter queue:`, messageId);
        
        const deadLetterPayload = {
          ...payload,
          finalError: error.message,
          failedAt: new Date().toISOString(),
          originalMessageId: messageId
        };
        
        await this.addToStream(this.DEAD_LETTER_STREAM, deadLetterPayload);
      }
      
      // 원본 메시지 ACK (처리 완료로 표시)
      await this.ackMessage(messageId);
      
    } catch (retryError) {
      console.error('[SyncQueue] Failed message handling error:', retryError);
    }
  }

  /**
   * 특정 메시지 타입을 위한 편의 메서드들
   */
  async enqueueCreateMessage(messageData) {
    return this.enqueueMessageSync('CREATE_MESSAGE', messageData);
  }

  async enqueueUpdateMessage(messageId, updateData) {
    return this.enqueueMessageSync('UPDATE_MESSAGE', {
      _id: messageId,
      updateData
    });
  }

  async enqueueMarkAsRead(messageId, userId, readAt) {
    return this.enqueueMessageSync('MARK_AS_READ', {
      messageId,
      userId,
      readAt: readAt || new Date()
    });
  }

  async enqueueAddReaction(messageId, emoji, userId) {
    return this.enqueueMessageSync('ADD_REACTION', {
      messageId,
      emoji,
      userId,
      timestamp: new Date()
    });
  }

  async enqueueRemoveReaction(messageId, emoji, userId) {
    return this.enqueueMessageSync('REMOVE_REACTION', {
      messageId,
      emoji,
      userId,
      timestamp: new Date()
    });
  }

  async enqueueDeleteMessage(messageId) {
    return this.enqueueMessageSync('DELETE_MESSAGE', {
      messageId,
      deletedAt: new Date()
    });
  }

  /**
   * 큐 상태 조회
   */
  async getQueueStatus() {
    try {
      const client = await redisClient.clusterClient.getReadClient();
      
      // 스트림 정보 조회
      const streamInfo = await client.sendCommand(['XINFO', 'STREAM', this.STREAM_NAME]);
      
      // 컨슈머 그룹 정보 조회
      let groupInfo = [];
      try {
        groupInfo = await client.sendCommand(['XINFO', 'GROUPS', this.STREAM_NAME]);
      } catch (error) {
        console.warn('[SyncQueue] No consumer groups found');
      }

      // 펜딩 메시지 수 조회
      let pendingCount = 0;
      try {
        const pendingInfo = await client.sendCommand(['XPENDING', this.STREAM_NAME, this.CONSUMER_GROUP]);
        pendingCount = pendingInfo[0] || 0;
      } catch (error) {
        console.warn('[SyncQueue] Cannot get pending messages count');
      }

      return {
        streamName: this.STREAM_NAME,
        consumerGroup: this.CONSUMER_GROUP,
        consumerName: this.CONSUMER_NAME,
        streamLength: this.parseStreamInfo(streamInfo, 'length') || 0,
        pendingMessages: pendingCount,
        groups: groupInfo.length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('[SyncQueue] Failed to get queue status:', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * 스트림 정보 파싱 유틸리티
   */
  parseStreamInfo(streamInfo, key) {
    for (let i = 0; i < streamInfo.length; i += 2) {
      if (streamInfo[i] === key) {
        return streamInfo[i + 1];
      }
    }
    return null;
  }

  /**
   * 서비스 초기화
   */
  async initialize() {
    try {
      console.log('[SyncQueue] Initializing sync queue service...');
      
      // Redis 연결 확인
      await redisClient.connect();
      
      // 컨슈머 그룹 생성
      await this.createConsumerGroup();
      
      console.log('[SyncQueue] Sync queue service initialized successfully');
      return true;
    } catch (error) {
      console.error('[SyncQueue] Failed to initialize sync queue service:', error);
      throw error;
    }
  }

  /**
   * 서비스 종료
   */
  async shutdown() {
    try {
      console.log('[SyncQueue] Shutting down sync queue service...');
      // 현재 구현에서는 특별한 정리 작업이 필요하지 않음
      console.log('[SyncQueue] Sync queue service shut down completed');
    } catch (error) {
      console.error('[SyncQueue] Shutdown error:', error);
    }
  }
}

module.exports = new SyncQueueService();