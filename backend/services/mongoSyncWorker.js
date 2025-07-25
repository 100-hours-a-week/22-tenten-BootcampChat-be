// backend/services/mongoSyncWorker.js
const syncQueueService = require('./syncQueueService');
const Message = require('../models/Message');
const mongoose = require('mongoose');

/**
 * MongoDB 동기화 워커 서비스
 * Redis Streams에서 동기화 작업을 소비하여 MongoDB에 반영
 */
class MongoSyncWorker {
  constructor() {
    this.isRunning = false;
    this.processedCount = 0;
    this.errorCount = 0;
    this.startTime = null;
    this.workerInterval = null;
    this.WORKER_TIMEOUT = 5000; // 5초 타임아웃
    this.stats = {
      processed: 0,
      errors: 0,
      operations: {
        CREATE_MESSAGE: 0,
        UPDATE_MESSAGE: 0,
        MARK_AS_READ: 0,
        ADD_REACTION: 0,
        REMOVE_REACTION: 0,
        DELETE_MESSAGE: 0
      }
    };
  }

  /**
   * 워커 시작
   */
  async start() {
    if (this.isRunning) {
      console.log('[MongoSyncWorker] Worker is already running');
      return;
    }

    try {
      console.log('[MongoSyncWorker] Starting MongoDB sync worker...');
      
      // SyncQueueService 초기화
      await syncQueueService.initialize();
      
      this.isRunning = true;
      this.startTime = new Date();
      
      // 메인 워커 루프 시작
      this.runWorkerLoop();
      
      console.log('[MongoSyncWorker] MongoDB sync worker started successfully');
    } catch (error) {
      console.error('[MongoSyncWorker] Failed to start worker:', error);
      throw error;
    }
  }

  /**
   * 워커 중지
   */
  async stop() {
    if (!this.isRunning) {
      console.log('[MongoSyncWorker] Worker is not running');
      return;
    }

    console.log('[MongoSyncWorker] Stopping MongoDB sync worker...');
    
    this.isRunning = false;
    
    if (this.workerInterval) {
      clearTimeout(this.workerInterval);
      this.workerInterval = null;
    }

    await syncQueueService.shutdown();
    
    console.log('[MongoSyncWorker] MongoDB sync worker stopped');
    this.logStats();
  }

  /**
   * 메인 워커 루프
   */
  async runWorkerLoop() {
    if (!this.isRunning) return;

    try {
      // 동기화 메시지 소비
      await syncQueueService.consumeMessages(
        this.processSyncMessage.bind(this),
        this.WORKER_TIMEOUT
      );
    } catch (error) {
      console.error('[MongoSyncWorker] Worker loop error:', error);
      this.errorCount++;
    }

    // 다음 루프 스케줄링
    if (this.isRunning) {
      this.workerInterval = setTimeout(() => {
        this.runWorkerLoop();
      }, 100); // 100ms 간격으로 실행
    }
  }

  /**
   * 동기화 메시지 처리
   */
  async processSyncMessage(payload, messageId) {
    try {
      console.log(`[MongoSyncWorker] Processing ${payload.operation}:`, {
        messageId,
        operation: payload.operation,
        retryCount: payload.retryCount
      });

      switch (payload.operation) {
        case 'CREATE_MESSAGE':
          await this.handleCreateMessage(payload.data);
          break;
        
        case 'UPDATE_MESSAGE':
          await this.handleUpdateMessage(payload.data);
          break;
        
        case 'MARK_AS_READ':
          await this.handleMarkAsRead(payload.data);
          break;
        
        case 'ADD_REACTION':
          await this.handleAddReaction(payload.data);
          break;
        
        case 'REMOVE_REACTION':
          await this.handleRemoveReaction(payload.data);
          break;
        
        case 'DELETE_MESSAGE':
          await this.handleDeleteMessage(payload.data);
          break;
        
        default:
          throw new Error(`Unknown operation: ${payload.operation}`);
      }

      // 통계 업데이트
      this.processedCount++;
      this.stats.processed++;
      this.stats.operations[payload.operation]++;

      console.log(`[MongoSyncWorker] Successfully processed ${payload.operation} (total: ${this.processedCount})`);

    } catch (error) {
      console.error(`[MongoSyncWorker] Failed to process ${payload.operation}:`, error);
      this.errorCount++;
      this.stats.errors++;
      throw error; // 에러를 다시 던져서 syncQueueService의 재시도 로직이 작동하도록 함
    }
  }

  /**
   * 메시지 생성 처리
   */
  async handleCreateMessage(messageData) {
    try {
      // MongoDB ObjectId 형식으로 변환
      const messageId = new mongoose.Types.ObjectId(messageData._id);
      
      // MongoDB 메시지 문서 생성
      const mongoMessage = new Message({
        _id: messageId,
        room: new mongoose.Types.ObjectId(messageData.room),
        sender: new mongoose.Types.ObjectId(messageData.sender._id),
        content: messageData.content,
        type: messageData.type,
        file: messageData.file,
        aiType: messageData.aiType,
        mentions: messageData.mentions,
        timestamp: new Date(messageData.timestamp),
        readers: messageData.readers.map(reader => ({
          userId: new mongoose.Types.ObjectId(reader.userId),
          readAt: new Date(reader.readAt)
        })),
        reactions: messageData.reactions,
        metadata: messageData.metadata,
        isDeleted: messageData.isDeleted || false
      });

      await mongoMessage.save();
      console.log(`[MongoSyncWorker] Message ${messageId} created in MongoDB`);

    } catch (error) {
      if (error.code === 11000) {
        // 중복 키 에러 (이미 존재하는 메시지) - 무시
        console.log(`[MongoSyncWorker] Message ${messageData._id} already exists in MongoDB`);
        return;
      }
      throw error;
    }
  }

  /**
   * 메시지 업데이트 처리
   */
  async handleUpdateMessage(data) {
    try {
      const messageId = new mongoose.Types.ObjectId(data._id);
      
      const updateResult = await Message.updateOne(
        { _id: messageId },
        { $set: data.updateData }
      );

      if (updateResult.matchedCount === 0) {
        console.warn(`[MongoSyncWorker] Message ${messageId} not found for update`);
      } else {
        console.log(`[MongoSyncWorker] Message ${messageId} updated in MongoDB`);
      }

    } catch (error) {
      console.error(`[MongoSyncWorker] Failed to update message ${data._id}:`, error);
      throw error;
    }
  }

  /**
   * 읽음 상태 처리
   */
  async handleMarkAsRead(data) {
    try {
      const messageId = new mongoose.Types.ObjectId(data.messageId);
      const userId = new mongoose.Types.ObjectId(data.userId);
      const readAt = new Date(data.readAt);

      const updateResult = await Message.updateOne(
        {
          _id: messageId,
          'readers.userId': { $ne: userId }
        },
        {
          $push: {
            readers: {
              userId: userId,
              readAt: readAt
            }
          }
        }
      );

      if (updateResult.matchedCount > 0) {
        console.log(`[MongoSyncWorker] Message ${messageId} marked as read by user ${userId}`);
      } else {
        console.log(`[MongoSyncWorker] Message ${messageId} already read by user ${userId} or not found`);
      }

    } catch (error) {
      console.error(`[MongoSyncWorker] Failed to mark message as read:`, error);
      throw error;
    }
  }

  /**
   * 리액션 추가 처리
   */
  async handleAddReaction(data) {
    try {
      const messageId = new mongoose.Types.ObjectId(data.messageId);
      const userId = new mongoose.Types.ObjectId(data.userId);
      const emoji = data.emoji;

      // MongoDB에서 메시지 조회 및 리액션 추가
      const message = await Message.findById(messageId);
      if (!message) {
        console.warn(`[MongoSyncWorker] Message ${messageId} not found for reaction add`);
        return;
      }

      await message.addReaction(emoji, userId.toString());
      console.log(`[MongoSyncWorker] Reaction ${emoji} added to message ${messageId} by user ${userId}`);

    } catch (error) {
      console.error(`[MongoSyncWorker] Failed to add reaction:`, error);
      throw error;
    }
  }

  /**
   * 리액션 제거 처리
   */
  async handleRemoveReaction(data) {
    try {
      const messageId = new mongoose.Types.ObjectId(data.messageId);
      const userId = new mongoose.Types.ObjectId(data.userId);
      const emoji = data.emoji;

      // MongoDB에서 메시지 조회 및 리액션 제거
      const message = await Message.findById(messageId);
      if (!message) {
        console.warn(`[MongoSyncWorker] Message ${messageId} not found for reaction remove`);
        return;
      }

      await message.removeReaction(emoji, userId.toString());
      console.log(`[MongoSyncWorker] Reaction ${emoji} removed from message ${messageId} by user ${userId}`);

    } catch (error) {
      console.error(`[MongoSyncWorker] Failed to remove reaction:`, error);
      throw error;
    }
  }

  /**
   * 메시지 삭제 처리 (소프트 삭제)
   */
  async handleDeleteMessage(data) {
    try {
      const messageId = new mongoose.Types.ObjectId(data.messageId);
      const deletedAt = new Date(data.deletedAt);

      const updateResult = await Message.updateOne(
        { _id: messageId },
        { 
          $set: { 
            isDeleted: true,
            deletedAt: deletedAt
          }
        }
      );

      if (updateResult.matchedCount > 0) {
        console.log(`[MongoSyncWorker] Message ${messageId} marked as deleted`);
      } else {
        console.warn(`[MongoSyncWorker] Message ${messageId} not found for deletion`);
      }

    } catch (error) {
      console.error(`[MongoSyncWorker] Failed to delete message:`, error);
      throw error;
    }
  }

  /**
   * 워커 상태 조회
   */
  getStatus() {
    const uptime = this.startTime ? Date.now() - this.startTime.getTime() : 0;
    
    return {
      isRunning: this.isRunning,
      startTime: this.startTime,
      uptime: uptime,
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      stats: this.stats,
      performance: {
        messagesPerSecond: uptime > 0 ? (this.processedCount / (uptime / 1000)).toFixed(2) : 0,
        errorRate: this.processedCount > 0 ? ((this.errorCount / this.processedCount) * 100).toFixed(2) : 0
      }
    };
  }

  /**
   * 통계 로그 출력
   */
  logStats() {
    const status = this.getStatus();
    console.log('[MongoSyncWorker] Final Statistics:', {
      uptime: `${Math.round(status.uptime / 1000)}s`,
      processed: status.processedCount,
      errors: status.errorCount,
      performance: status.performance,
      operations: status.stats.operations
    });
  }

  /**
   * 상태 초기화
   */
  resetStats() {
    this.processedCount = 0;
    this.errorCount = 0;
    this.stats = {
      processed: 0,
      errors: 0,
      operations: {
        CREATE_MESSAGE: 0,
        UPDATE_MESSAGE: 0,
        MARK_AS_READ: 0,
        ADD_REACTION: 0,
        REMOVE_REACTION: 0,
        DELETE_MESSAGE: 0
      }
    };
    console.log('[MongoSyncWorker] Statistics reset');
  }
}

module.exports = new MongoSyncWorker();