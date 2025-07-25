// backend/services/messageCacheService.js
const redisClient = require('../utils/redisClient');
const syncQueueService = require('./syncQueueService');
const crossInstanceRedisService = require('./crossInstanceRedisService');
const distributedLockService = require('./distributedLockService');
const Message = require('../models/Message');
const User = require('../models/User');
const { CHAT_MESSAGES_INDEX } = require('../scripts/setupRedisIndex');

/**
 * Redis 기반 메시지 캐시 서비스
 * Write-Back 전략 (Redis 우선 → MongoDB 비동기 동기화)
 */
class MessageCacheService {
  constructor() {
    this.CACHE_PREFIX = 'message:';
    this.INDEX_NAME = CHAT_MESSAGES_INDEX;
    this.participantsCache = new Map(); // 인메모리 참여자 캐시
  }

  /**
   * MongoDB Message 문서를 Redis JSON 형식으로 변환
   */
  transformToRedisFormat(message) {
    const senderInfo = message.sender || {};
    const fileInfo = message.file || null;
    const reactions = message.reactions instanceof Map 
      ? Object.fromEntries(message.reactions) 
      : (message.reactions || {});

    return {
      _id: message._id.toString(),
      room: message.room.toString(),
      content: message.content || '',
      sender: {
        _id: senderInfo._id ? senderInfo._id.toString() : message.sender.toString(),
        name: senderInfo.name || '알 수 없음',
        email: senderInfo.email || '',
        profileImage: senderInfo.profileImage || ''
      },
      type: message.type || 'text',
      file: fileInfo ? {
        _id: fileInfo._id || message._id.toString(),
        filename: fileInfo.filename || '',
        originalname: fileInfo.originalname || '',
        mimetype: fileInfo.mimetype || '',
        size: fileInfo.size || 0,
        s3Key: fileInfo.s3Key || '',
        s3Bucket: fileInfo.s3Bucket || '',
        s3Url: fileInfo.s3Url || ''
      } : null,
      aiType: message.aiType || null,
      mentions: Array.isArray(message.mentions) ? message.mentions : [],
      timestamp: new Date(message.timestamp || message.createdAt).getTime(),
      readers: (message.readers || []).map(reader => ({
        userId: reader.userId ? reader.userId.toString() : reader.toString(),
        readAt: new Date(reader.readAt).toISOString()
      })),
      reactions,
      metadata: message.metadata instanceof Map 
        ? Object.fromEntries(message.metadata) 
        : (message.metadata || {}),
      isDeleted: !!message.isDeleted
    };
  }

  /**
   * Redis 캐시 키 생성
   */
  getCacheKey(messageId) {
    return `${this.CACHE_PREFIX}${messageId}`;
  }

  /**
   * 참여자 정보를 인메모리에 캐싱
   */
  async cacheParticipants(roomId, participants) {
    const participantsMap = new Map();
    
    for (const participant of participants) {
      const userId = participant._id ? participant._id.toString() : participant.toString();
      participantsMap.set(userId, {
        _id: userId,
        name: participant.name || '알 수 없음',
        email: participant.email || '',
        profileImage: participant.profileImage || ''
      });
    }
    
    this.participantsCache.set(roomId.toString(), {
      data: participantsMap,
      timestamp: Date.now(),
      ttl: 300000 // 5분 TTL
    });

    console.log(`[MessageCache] Cached ${participants.length} participants for room ${roomId}`);
  }

  /**
   * 인메모리에서 참여자 정보 조회
   */
  getCachedParticipants(roomId) {
    const cached = this.participantsCache.get(roomId.toString());
    
    if (!cached) return null;
    
    // TTL 확인
    if (Date.now() - cached.timestamp > cached.ttl) {
      this.participantsCache.delete(roomId.toString());
      return null;
    }
    
    return cached.data;
  }

  /**
   * Read-Through: 메시지 조회 (Redis 우선 → MongoDB fallback)
   */
  async getMessagesByRoom(roomId, beforeTimestamp = null, limit = 30) {
    try {
      console.log(`[MessageCache] Fetching messages for room ${roomId}, before: ${beforeTimestamp}, limit: ${limit}`);

      // RedisSearch 쿼리 구성
      const searchQuery = this.buildMessageSearchQuery(roomId, beforeTimestamp);
      const searchOptions = this.buildMessageSearchOptions(beforeTimestamp, limit);

      // Redis Slave에서 검색 실행
      const searchResult = await redisClient.ftSearch(this.INDEX_NAME, searchQuery, searchOptions);
      
      if (searchResult && searchResult.documents && searchResult.documents.length > 0) {
        console.log(`[MessageCache] Cache HIT: Found ${searchResult.documents.length} messages in Redis`);
        
        // Redis 결과를 메시지 형태로 변환
        const messages = await this.parseRedisMessageResults(searchResult.documents);
        
        const hasMore = searchResult.documents.length >= limit;
        const oldestTimestamp = messages.length > 0 ? messages[0].timestamp : null;
        
        return {
          messages: messages.reverse(), // 시간순 정렬 (오래된 것부터)
          hasMore,
          oldestTimestamp,
          source: 'redis'
        };
      }

      // Cache Miss: MongoDB fallback
      console.log('[MessageCache] Cache MISS: Falling back to MongoDB');
      return await this.getMessagesFromMongoDB(roomId, beforeTimestamp, limit);

    } catch (error) {
      console.error('[MessageCache] Redis search error:', error);
      // Redis 실패 시 MongoDB fallback
      return await this.getMessagesFromMongoDB(roomId, beforeTimestamp, limit);
    }
  }

  /**
   * MongoDB에서 직접 메시지 조회 (Fallback)
   */
  async getMessagesFromMongoDB(roomId, beforeTimestamp = null, limit = 30) {
    try {
      const query = { 
        room: roomId,
        isDeleted: false
      };
      
      if (beforeTimestamp) {
        query.timestamp = { $lt: new Date(beforeTimestamp) };
      }

      const messages = await Message.find(query)
        .populate('sender', 'name email profileImage')
        .sort({ timestamp: -1 })
        .limit(limit + 1)  // 1개 더 조회해서 hasMore 판단
        .lean();

      const hasMore = messages.length > limit;
      const resultMessages = messages.slice(0, limit);
      const sortedMessages = resultMessages.sort((a, b) => 
        new Date(a.timestamp) - new Date(b.timestamp)
      );

      // MongoDB에서 조회한 메시지들을 Redis에 캐싱
      for (const message of sortedMessages) {
        try {
          const redisData = this.transformToRedisFormat(message);
          const cacheKey = this.getCacheKey(message._id);
          await redisClient.jsonSet(cacheKey, '$', redisData);
        } catch (cacheError) {
          console.error(`[MessageCache] Failed to cache message ${message._id}:`, cacheError);
        }
      }

      return {
        messages: sortedMessages,
        hasMore,
        oldestTimestamp: sortedMessages[0]?.timestamp || null,
        source: 'mongodb'
      };

    } catch (error) {
      console.error('[MessageCache] MongoDB fallback error:', error);
      throw error;
    }
  }

  /**
   * RedisSearch 쿼리 문자열 구성
   */
  buildMessageSearchQuery(roomId, beforeTimestamp) {
    const conditions = [`@room:{${roomId}}`, '@isDeleted:{false}'];
    
    if (beforeTimestamp) {
      const timestamp = new Date(beforeTimestamp).getTime();
      conditions.push(`@timestamp:[0 ${timestamp}]`);
    }
    
    return conditions.join(' ');
  }

  /**
   * RedisSearch 옵션 구성
   */
  buildMessageSearchOptions(beforeTimestamp, limit) {
    return {
      sortBy: 'timestamp',
      sortOrder: 'DESC',
      limit: limit,
      offset: 0,
      return: ['_id'] // 일단 ID만 가져와서 JSON.GET으로 전체 데이터 조회
    };
  }

  /**
   * RedisSearch 결과를 메시지 형식으로 파싱
   */
  async parseRedisMessageResults(documents) {
    const messages = [];

    for (const doc of documents) {
      try {
        // Redis 문서에서 전체 JSON 데이터 조회
        const messageData = await redisClient.jsonGet(doc.key);
        
        if (messageData && messageData.length > 0) {
          const message = messageData[0]; // RedisJSON GET 결과는 배열
          
          messages.push({
            _id: message._id,
            room: message.room,
            content: message.content,
            sender: message.sender,
            type: message.type,
            file: message.file,
            aiType: message.aiType,
            mentions: message.mentions,
            timestamp: new Date(message.timestamp),
            readers: message.readers.map(reader => ({
              userId: reader.userId,
              readAt: new Date(reader.readAt)
            })),
            reactions: message.reactions,
            metadata: message.metadata,
            isDeleted: message.isDeleted
          });
        }
      } catch (error) {
        console.error(`[MessageCache] Error parsing document ${doc.key}:`, error);
      }
    }

    return messages;
  }

  /**
   * Write-Back: 메시지 생성
   */
  async createMessage(messageData) {
    const roomLockResource = `room_message_create:${messageData.room}`;
    
    try {
      console.log('[MessageCache] Creating new message:', messageData.type);

      // 분산 락 획득 (동일 방에서 동시 메시지 생성 방지)
      const lockAcquired = await distributedLockService.acquireLock(roomLockResource, 5000, 30);
      if (!lockAcquired) {
        throw new Error('Failed to acquire distributed lock for message creation');
      }

      // 고유 ID 생성 (MongoDB ObjectId 형식)
      const mongoose = require('mongoose');
      const messageId = new mongoose.Types.ObjectId();

      // Redis용 메시지 데이터 구성
      const redisMessage = {
        _id: messageId.toString(),
        room: messageData.room.toString(),
        content: messageData.content || '',
        sender: messageData.sender,  // 이미 populate된 형태로 전달됨
        type: messageData.type || 'text',
        file: messageData.file || null,
        aiType: messageData.aiType || null,
        mentions: messageData.mentions || [],
        timestamp: Date.now(),
        readers: [],
        reactions: {},
        metadata: messageData.metadata || {},
        isDeleted: false
      };

      // Redis Master에 저장
      const cacheKey = this.getCacheKey(messageId);
      await redisClient.jsonSet(cacheKey, '$', redisMessage);
      console.log(`[MessageCache] Message cached: ${cacheKey}`);

      // MongoDB 동기화 큐에 추가
      await syncQueueService.enqueueCreateMessage(redisMessage);

      // Cross-instance 동기화 브로드캐스트
      await crossInstanceRedisService.broadcastMessageSync('CREATE_MESSAGE', redisMessage);

      // 분산 락 해제
      await distributedLockService.releaseLock(roomLockResource);

      // 응답용 메시지 형태로 변환
      return {
        _id: messageId,
        room: redisMessage.room,
        content: redisMessage.content,
        sender: redisMessage.sender,
        type: redisMessage.type,
        file: redisMessage.file,
        aiType: redisMessage.aiType,
        mentions: redisMessage.mentions,
        timestamp: new Date(redisMessage.timestamp),
        readers: redisMessage.readers,
        reactions: redisMessage.reactions,
        metadata: redisMessage.metadata
      };

    } catch (error) {
      console.error('[MessageCache] Create message error:', error);
      
      // 에러 발생 시에도 락 해제
      await distributedLockService.releaseLock(roomLockResource);
      throw error;
    }
  }

  /**
   * Write-Back: 메시지 읽음 처리
   */
  async markAsRead(messageIds, userId) {
    try {
      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        return [];
      }

      console.log(`[MessageCache] Marking ${messageIds.length} messages as read for user ${userId}`);

      const updatedMessages = [];
      const readAt = new Date().toISOString();

      for (const messageId of messageIds) {
        try {
          const cacheKey = this.getCacheKey(messageId);
          
          // Redis에서 현재 메시지 조회
          const messageData = await redisClient.jsonGet(cacheKey);
          
          if (messageData && messageData.length > 0) {
            const message = messageData[0];
            
            // 이미 읽음 처리된 사용자인지 확인
            const alreadyRead = message.readers.some(reader => reader.userId === userId);
            
            if (!alreadyRead) {
              // 읽음 정보 추가
              const newReader = { userId, readAt };
              message.readers.push(newReader);
              
              // Redis 업데이트
              await redisClient.jsonSet(cacheKey, '$.readers', message.readers);
              
              updatedMessages.push(messageId);
              
              // MongoDB 동기화 큐에 추가
              await syncQueueService.enqueueMarkAsRead(messageId, userId, readAt);
            }
          }
        } catch (error) {
          console.error(`[MessageCache] Failed to mark message ${messageId} as read:`, error);
        }
      }

      console.log(`[MessageCache] Successfully marked ${updatedMessages.length} messages as read`);
      return updatedMessages;

    } catch (error) {
      console.error('[MessageCache] Mark as read error:', error);
      throw error;
    }
  }

  /**
   * Write-Back: 리액션 추가
   */
  async addReaction(messageId, emoji, userId) {
    try {
      console.log(`[MessageCache] Adding reaction ${emoji} to message ${messageId} by user ${userId}`);

      const cacheKey = this.getCacheKey(messageId);
      
      // Redis에서 현재 메시지 조회
      const messageData = await redisClient.jsonGet(cacheKey);
      
      if (!messageData || messageData.length === 0) {
        throw new Error('메시지를 찾을 수 없습니다.');
      }

      const message = messageData[0];
      
      // 리액션 업데이트
      if (!message.reactions[emoji]) {
        message.reactions[emoji] = [];
      }
      
      if (!message.reactions[emoji].includes(userId)) {
        message.reactions[emoji].push(userId);
        
        // Redis 업데이트
        await redisClient.jsonSet(cacheKey, '$.reactions', message.reactions);
        
        // MongoDB 동기화 큐에 추가
        await syncQueueService.enqueueAddReaction(messageId, emoji, userId);
        
        console.log(`[MessageCache] Reaction ${emoji} added successfully`);
      }

      return message.reactions[emoji];

    } catch (error) {
      console.error('[MessageCache] Add reaction error:', error);
      throw error;
    }
  }

  /**
   * Write-Back: 리액션 제거
   */
  async removeReaction(messageId, emoji, userId) {
    try {
      console.log(`[MessageCache] Removing reaction ${emoji} from message ${messageId} by user ${userId}`);

      const cacheKey = this.getCacheKey(messageId);
      
      // Redis에서 현재 메시지 조회
      const messageData = await redisClient.jsonGet(cacheKey);
      
      if (!messageData || messageData.length === 0) {
        throw new Error('메시지를 찾을 수 없습니다.');
      }

      const message = messageData[0];
      
      // 리액션 제거
      if (message.reactions[emoji]) {
        message.reactions[emoji] = message.reactions[emoji].filter(id => id !== userId);
        
        if (message.reactions[emoji].length === 0) {
          delete message.reactions[emoji];
        }
        
        // Redis 업데이트
        await redisClient.jsonSet(cacheKey, '$.reactions', message.reactions);
        
        // MongoDB 동기화 큐에 추가
        await syncQueueService.enqueueRemoveReaction(messageId, emoji, userId);
        
        console.log(`[MessageCache] Reaction ${emoji} removed successfully`);
      }

      return message.reactions[emoji] || [];

    } catch (error) {
      console.error('[MessageCache] Remove reaction error:', error);
      throw error;
    }
  }

  /**
   * 특정 방의 최근 메시지를 Redis에 캐싱 (Cache Warming)
   */
  async warmCacheForRoom(roomId, limit = 30) {
    try {
      console.log(`[MessageCache] Warming cache for room ${roomId}...`);

      const messages = await Message.find({ 
        room: roomId, 
        isDeleted: false 
      })
        .populate('sender', 'name email profileImage')
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();

      let cachedCount = 0;
      
      for (const message of messages) {
        try {
          const redisData = this.transformToRedisFormat(message);
          const cacheKey = this.getCacheKey(message._id);
          
          await redisClient.jsonSet(cacheKey, '$', redisData);
          cachedCount++;
        } catch (error) {
          console.error(`[MessageCache] Failed to cache message ${message._id}:`, error);
        }
      }

      console.log(`[MessageCache] Cache warming completed for room ${roomId}: ${cachedCount}/${messages.length} messages cached`);
      return { success: true, cached: cachedCount, total: messages.length };

    } catch (error) {
      console.error(`[MessageCache] Cache warming error for room ${roomId}:`, error);
      throw error;
    }
  }

  /**
   * 전체 활성 방에 대한 Cache Warming
   */
  async warmAllActiveRooms() {
    try {
      console.log('[MessageCache] Starting cache warming for all active rooms...');

      // 활성 방 목록 조회 (최근 24시간 내 메시지가 있는 방)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const activeRooms = await Message.distinct('room', {
        timestamp: { $gte: oneDayAgo },
        isDeleted: false
      });

      let totalCached = 0;
      let totalRooms = 0;
      
      for (const roomId of activeRooms) {
        try {
          const result = await this.warmCacheForRoom(roomId, 30);
          totalCached += result.cached;
          totalRooms++;
        } catch (error) {
          console.error(`[MessageCache] Failed to warm cache for room ${roomId}:`, error);
        }
      }

      console.log(`[MessageCache] Global cache warming completed: ${totalCached} messages cached across ${totalRooms} rooms`);
      return { success: true, cachedMessages: totalCached, totalRooms };

    } catch (error) {
      console.error('[MessageCache] Global cache warming error:', error);
      throw error;
    }
  }

  /**
   * 캐시 상태 조회
   */
  async getCacheStatus() {
    try {
      const status = {
        participantsCacheSize: this.participantsCache.size,
        timestamp: new Date().toISOString()
      };

      // Redis 클러스터 상태 추가
      const redisStatus = await redisClient.getClusterStatus();
      status.redis = redisStatus;

      return status;
    } catch (error) {
      console.error('[MessageCache] Failed to get cache status:', error);
      return { error: error.message, timestamp: new Date().toISOString() };
    }
  }
}

module.exports = new MessageCacheService();