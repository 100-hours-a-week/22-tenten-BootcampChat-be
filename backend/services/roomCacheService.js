// backend/services/roomCacheService.js
const redisClient = require('../utils/redisClient');
const Room = require('../models/Room');
const User = require('../models/User');
const { CHAT_ROOMS_INDEX } = require('../scripts/setupRedisIndex');

/**
 * Redis 기반 채팅방 캐시 서비스
 * Read-Through와 Write-Through 전략 구현
 */
class RoomCacheService {
  constructor() {
    this.CACHE_PREFIX = 'chat_room:';
    this.INDEX_NAME = CHAT_ROOMS_INDEX;
  }

  /**
   * MongoDB Room 문서를 Redis JSON 형식으로 변환
   */
  transformToRedisFormat(room) {
    const participants = Array.isArray(room.participants) ? room.participants : [];
    
    return {
      _id: room._id.toString(),
      name: room.name || '제목 없음',
      password: room.password || '',
      hasPassword: !!room.hasPassword,
      creator: {
        _id: room.creator._id ? room.creator._id.toString() : room.creator.toString(),
        name: room.creator.name || '알 수 없음',
        email: room.creator.email || ''
      },
      participants: participants.map(p => ({
        _id: p._id ? p._id.toString() : p.toString(),
        name: p.name || '알 수 없음',
        email: p.email || ''
      })),
      participantsCount: participants.length,
      createdAt: new Date(room.createdAt).getTime() // timestamp로 변환
    };
  }

  /**
   * Redis 캐시 키 생성
   */
  getCacheKey(roomId) {
    return `${this.CACHE_PREFIX}${roomId}`;
  }

  /**
   * Read-Through: Redis 우선 조회, Cache Miss 시 MongoDB fallback
   */
  async getRooms(query = {}) {
    try {
      // Redis에서 RedisSearch 쿼리 구성
      const searchQuery = this.buildSearchQuery(query);
      const searchOptions = this.buildSearchOptions(query);

      console.log(`[RoomCache] Searching with query: ${searchQuery}`, searchOptions);

      // Redis Slave에서 검색 실행
      const searchResult = await redisClient.ftSearch(this.INDEX_NAME, searchQuery, searchOptions);
      
      if (searchResult && searchResult.documents.length > 0) {
        console.log(`[RoomCache] Cache HIT: Found ${searchResult.documents.length} rooms in Redis`);
        
        // Redis 결과를 API 응답 형식으로 변환
        const rooms = await this.parseRedisSearchResults(searchResult.documents, query.userId);
        
        return {
          success: true,
          data: rooms,
          metadata: {
            total: searchResult.total,
            page: query.page || 0,
            pageSize: query.pageSize || 10,
            totalPages: Math.ceil(searchResult.total / (query.pageSize || 10)),
            hasMore: (query.page || 0) * (query.pageSize || 10) + rooms.length < searchResult.total,
            currentCount: rooms.length,
            sort: {
              field: query.sortField || 'createdAt',
              order: query.sortOrder || 'desc'
            },
            source: 'redis'
          }
        };
      }

      // Cache Miss: MongoDB fallback
      console.log('[RoomCache] Cache MISS: Falling back to MongoDB');
      return await this.getRoomsFromMongoDB(query);

    } catch (error) {
      console.error('[RoomCache] Redis search error:', error);
      // Redis 실패 시 MongoDB fallback
      return await this.getRoomsFromMongoDB(query);
    }
  }

  /**
   * MongoDB에서 직접 조회 (Fallback)
   */
  async getRoomsFromMongoDB(query = {}) {
    try {
      const page = Math.max(0, parseInt(query.page) || 0);
      const pageSize = Math.min(Math.max(1, parseInt(query.pageSize) || 10), 50);
      const skip = page * pageSize;

      const allowedSortFields = ['createdAt', 'name', 'participantsCount'];
      const sortField = allowedSortFields.includes(query.sortField) 
        ? query.sortField 
        : 'createdAt';
      const sortOrder = ['asc', 'desc'].includes(query.sortOrder)
        ? query.sortOrder
        : 'desc';

      // 검색 필터 구성
      const filter = {};
      if (query.search) {
        filter.name = { $regex: query.search, $options: 'i' };
      }

      const totalCount = await Room.countDocuments(filter);

      const rooms = await Room.find(filter)
        .populate('creator', 'name email')
        .populate('participants', 'name email')
        .sort({ [sortField]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(pageSize)
        .lean();

      const safeRooms = rooms.map(room => {
        if (!room) return null;

        const creator = room.creator || { _id: 'unknown', name: '알 수 없음', email: '' };
        const participants = Array.isArray(room.participants) ? room.participants : [];

        return {
          _id: room._id?.toString() || 'unknown',
          name: room.name || '제목 없음',
          hasPassword: !!room.hasPassword,
          creator: {
            _id: creator._id?.toString() || 'unknown',
            name: creator.name || '알 수 없음',
            email: creator.email || ''
          },
          participants: participants.filter(p => p && p._id).map(p => ({
            _id: p._id.toString(),
            name: p.name || '알 수 없음',
            email: p.email || ''
          })),
          participantsCount: participants.length,
          createdAt: room.createdAt || new Date(),
          isCreator: creator._id?.toString() === query.userId,
        };
      }).filter(room => room !== null);

      const totalPages = Math.ceil(totalCount / pageSize);
      const hasMore = skip + rooms.length < totalCount;

      return {
        success: true,
        data: safeRooms,
        metadata: {
          total: totalCount,
          page,
          pageSize,
          totalPages,
          hasMore,
          currentCount: safeRooms.length,
          sort: { field: sortField, order: sortOrder },
          source: 'mongodb'
        }
      };

    } catch (error) {
      console.error('[RoomCache] MongoDB fallback error:', error);
      throw error;
    }
  }

  /**
   * RedisSearch 쿼리 문자열 구성
   */
  buildSearchQuery(query) {
    const conditions = [];

    // 이름 검색
    if (query.search) {
      conditions.push(`@name:${query.search}*`);
    }

    // 비밀번호 필터
    if (query.hasPassword !== undefined) {
      conditions.push(`@hasPassword:{${query.hasPassword}}`);
    }

    // 기본 쿼리 (모든 문서)
    return conditions.length > 0 ? conditions.join(' ') : '*';
  }

  /**
   * RedisSearch 옵션 구성
   */
  buildSearchOptions(query) {
    const options = {};

    // 페이지네이션
    const page = Math.max(0, parseInt(query.page) || 0);
    const pageSize = Math.min(Math.max(1, parseInt(query.pageSize) || 10), 50);
    
    options.limit = pageSize;
    options.offset = page * pageSize;

    // 정렬
    const allowedSortFields = ['createdAt', 'name', 'participantsCount'];
    const sortField = allowedSortFields.includes(query.sortField) 
      ? query.sortField 
      : 'createdAt';
    const sortOrder = ['asc', 'desc'].includes(query.sortOrder)
      ? query.sortOrder.toUpperCase()
      : 'DESC';

    options.sortBy = sortField;
    options.sortOrder = sortOrder;

    // 반환 필드
    options.return = [
      '_id', 'name', 'hasPassword', 'creator_id', 'creator_name', 
      'participantsCount', 'createdAt'
    ];

    return options;
  }

  /**
   * RedisSearch 결과를 API 형식으로 파싱
   */
  async parseRedisSearchResults(documents, userId) {
    const rooms = [];

    for (const doc of documents) {
      try {
        // Redis 문서에서 전체 JSON 데이터 조회
        const roomData = await redisClient.jsonGet(doc.key);
        
        if (roomData && roomData.length > 0) {
          const room = roomData[0]; // RedisJSON GET 결과는 배열
          
          rooms.push({
            _id: room._id,
            name: room.name,
            hasPassword: room.hasPassword,
            creator: room.creator,
            participants: room.participants,
            participantsCount: room.participantsCount,
            createdAt: new Date(room.createdAt),
            isCreator: room.creator._id === userId
          });
        }
      } catch (error) {
        console.error(`[RoomCache] Error parsing document ${doc.key}:`, error);
      }
    }

    return rooms;
  }

  /**
   * Write-Through: 채팅방 생성
   */
  async createRoom(data) {
    try {
      console.log('[RoomCache] Creating new room:', data.name);

      // MongoDB에 생성
      const newRoom = new Room({
        name: data.name.trim(),
        creator: data.creator,
        participants: [data.creator],
        password: data.password
      });

      const savedRoom = await newRoom.save();
      const populatedRoom = await Room.findById(savedRoom._id)
        .populate('creator', 'name email')
        .populate('participants', 'name email');

      // Redis에 캐시
      const redisData = this.transformToRedisFormat(populatedRoom);
      const cacheKey = this.getCacheKey(populatedRoom._id);
      
      await redisClient.jsonSet(cacheKey, '$', redisData);
      console.log(`[RoomCache] Room cached: ${cacheKey}`);

      return {
        success: true,
        data: {
          ...populatedRoom.toObject(),
          password: undefined
        }
      };

    } catch (error) {
      console.error('[RoomCache] Create room error:', error);
      throw error;
    }
  }

  /**
   * Write-Through: 채팅방 참여
   */
  async joinRoom(roomId, userId, password) {
    try {
      console.log(`[RoomCache] User ${userId} joining room ${roomId}`);

      // MongoDB에서 조회 및 업데이트
      const room = await Room.findById(roomId).select('+password');
      
      if (!room) {
        return { success: false, message: '채팅방을 찾을 수 없습니다.' };
      }

      // 비밀번호 확인
      if (room.hasPassword) {
        const isPasswordValid = await room.checkPassword(password);
        if (!isPasswordValid) {
          return { success: false, message: '비밀번호가 일치하지 않습니다.' };
        }
      }

      // 참여자 추가
      if (!room.participants.includes(userId)) {
        room.participants.push(userId);
        await room.save();
      }

      const populatedRoom = await room.populate('creator', 'name email');
      await populatedRoom.populate('participants', 'name email');

      // Redis 캐시 업데이트
      const redisData = this.transformToRedisFormat(populatedRoom);
      const cacheKey = this.getCacheKey(roomId);
      
      await redisClient.jsonSet(cacheKey, '$', redisData);
      console.log(`[RoomCache] Room updated in cache: ${cacheKey}`);

      return {
        success: true,
        data: {
          ...populatedRoom.toObject(),
          password: undefined
        }
      };

    } catch (error) {
      console.error('[RoomCache] Join room error:', error);
      throw error;
    }
  }

  /**
   * Write-Through: 채팅방 삭제
   */
  async deleteRoom(roomId) {
    try {
      console.log(`[RoomCache] Deleting room ${roomId}`);

      // MongoDB에서 삭제
      const result = await Room.findByIdAndDelete(roomId);
      
      if (!result) {
        return { success: false, message: '채팅방을 찾을 수 없습니다.' };
      }

      // Redis 캐시에서 삭제
      const cacheKey = this.getCacheKey(roomId);
      await redisClient.jsonDel(cacheKey);
      console.log(`[RoomCache] Room removed from cache: ${cacheKey}`);

      return { success: true, message: '채팅방이 삭제되었습니다.' };

    } catch (error) {
      console.error('[RoomCache] Delete room error:', error);
      throw error;
    }
  }

  /**
   * 특정 채팅방 조회
   */
  async getRoom(roomId) {
    try {
      // Redis에서 먼저 조회
      const cacheKey = this.getCacheKey(roomId);
      const cachedRoom = await redisClient.jsonGet(cacheKey);

      if (cachedRoom && cachedRoom.length > 0) {
        console.log(`[RoomCache] Room found in cache: ${roomId}`);
        const room = cachedRoom[0];
        
        return {
          success: true,
          data: {
            ...room,
            createdAt: new Date(room.createdAt),
            password: undefined
          }
        };
      }

      // Cache Miss: MongoDB에서 조회
      console.log(`[RoomCache] Room not in cache, fetching from MongoDB: ${roomId}`);
      const room = await Room.findById(roomId)
        .populate('creator', 'name email')
        .populate('participants', 'name email');

      if (!room) {
        return { success: false, message: '채팅방을 찾을 수 없습니다.' };
      }

      // Redis에 캐시
      const redisData = this.transformToRedisFormat(room);
      await redisClient.jsonSet(cacheKey, '$', redisData);

      return {
        success: true,
        data: {
          ...room.toObject(),
          password: undefined
        }
      };

    } catch (error) {
      console.error('[RoomCache] Get room error:', error);
      throw error;
    }
  }

  /**
   * Cache Warming: MongoDB의 모든 채팅방 데이터를 Redis로 로드
   */
  async warmCache() {
    try {
      console.log('[RoomCache] Starting cache warming...');

      const rooms = await Room.find({})
        .populate('creator', 'name email')
        .populate('participants', 'name email')
        .lean();

      let cachedCount = 0;
      
      for (const room of rooms) {
        try {
          const redisData = this.transformToRedisFormat(room);
          const cacheKey = this.getCacheKey(room._id);
          
          await redisClient.jsonSet(cacheKey, '$', redisData);
          cachedCount++;
          
          if (cachedCount % 10 === 0) {
            console.log(`[RoomCache] Cached ${cachedCount}/${rooms.length} rooms`);
          }
        } catch (error) {
          console.error(`[RoomCache] Failed to cache room ${room._id}:`, error);
        }
      }

      console.log(`[RoomCache] Cache warming completed: ${cachedCount}/${rooms.length} rooms cached`);
      return { success: true, cached: cachedCount, total: rooms.length };

    } catch (error) {
      console.error('[RoomCache] Cache warming error:', error);
      throw error;
    }
  }
}

module.exports = new RoomCacheService();