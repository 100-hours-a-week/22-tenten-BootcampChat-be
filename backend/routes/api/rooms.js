const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const Room = require('../../models/Room');
const User = require('../../models/User');
const roomCacheService = require('../../services/roomCacheService');
const { rateLimit } = require('express-rate-limit');
let io;

// 속도 제한 설정
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 60, // IP당 최대 요청 수
  message: {
    success: false,
    error: {
      message: '너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.',
      code: 'TOO_MANY_REQUESTS'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Socket.IO 초기화 함수
const initializeSocket = (socketIO) => {
  io = socketIO;
};

// 서버 상태 확인
router.get('/health', async (req, res) => {
  try {
    const isMongoConnected = require('mongoose').connection.readyState === 1;
    const recentRoom = await Room.findOne()
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean();

    const start = process.hrtime();
    await Room.findOne().select('_id').lean();
    const [seconds, nanoseconds] = process.hrtime(start);
    const latency = Math.round((seconds * 1000) + (nanoseconds / 1000000));

    const status = {
      success: true,
      timestamp: new Date().toISOString(),
      services: {
        database: {
          connected: isMongoConnected,
          latency
        }
      },
      lastActivity: recentRoom?.createdAt
    };

    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    res.status(isMongoConnected ? 200 : 503).json(status);

  } catch (error) {
    console.error('Health check error:', error);
    res.status(503).json({
      success: false,
      error: {
        message: '서비스 상태 확인에 실패했습니다.',
        code: 'HEALTH_CHECK_FAILED'
      }
    });
  }
});

// 채팅방 목록 조회 (Redis 캐시 우선)
router.get('/', [limiter, auth], async (req, res) => {
  try {
    console.log('[RoomAPI] Fetching rooms list with cache');
    
    // 쿼리 파라미터 구성
    const query = {
      page: Math.max(0, parseInt(req.query.page) || 0),
      pageSize: Math.min(Math.max(1, parseInt(req.query.pageSize) || 10), 50),
      sortField: req.query.sortField,
      sortOrder: req.query.sortOrder,
      search: req.query.search,
      hasPassword: req.query.hasPassword ? req.query.hasPassword === 'true' : undefined,
      userId: req.user.id
    };

    // roomCacheService를 통해 조회 (Redis 우선, MongoDB fallback)
    const result = await roomCacheService.getRooms(query);

    // 캐시 설정 (Redis 캐시인 경우 더 긴 캐시 시간)
    const cacheMaxAge = result.metadata.source === 'redis' ? 30 : 10;
    res.set({
      'Cache-Control': `private, max-age=${cacheMaxAge}`,
      'Last-Modified': new Date().toUTCString(),
      'X-Cache-Source': result.metadata.source
    });

    // 응답 전송
    res.json(result);

  } catch (error) {
    console.error('[RoomAPI] 방 목록 조회 에러:', error);
    const errorResponse = {
      success: false,
      error: {
        message: '채팅방 목록을 불러오는데 실패했습니다.',
        code: 'ROOMS_FETCH_ERROR'
      }
    };

    if (process.env.NODE_ENV === 'development') {
      errorResponse.error.details = error.message;
      errorResponse.error.stack = error.stack;
    }

    res.status(500).json(errorResponse);
  }
});

// 채팅방 생성 (Redis 캐시 적용)
router.post('/', auth, async (req, res) => {
  try {
    console.log('[RoomAPI] Creating new room with cache');
    
    const { name, password } = req.body;
    
    if (!name?.trim()) {
      return res.status(400).json({ 
        success: false,
        message: '방 이름은 필수입니다.' 
      });
    }

    // roomCacheService를 통해 생성 (MongoDB + Redis 동기화)
    const result = await roomCacheService.createRoom({
      name: name.trim(),
      creator: req.user.id,
      password: password
    });

    if (!result.success) {
      return res.status(400).json(result);
    }
    
    // Socket.IO를 통해 새 채팅방 생성 알림
    if (io) {
      io.to('room-list').emit('roomCreated', result.data);
    }
    
    res.status(201).json(result);
    
  } catch (error) {
    console.error('[RoomAPI] 방 생성 에러:', error);
    res.status(500).json({ 
      success: false,
      message: '서버 에러가 발생했습니다.',
      error: error.message 
    });
  }
});

// 특정 채팅방 조회 (Redis 캐시 우선)
router.get('/:roomId', auth, async (req, res) => {
  try {
    console.log(`[RoomAPI] Fetching room ${req.params.roomId} with cache`);
    
    // roomCacheService를 통해 조회 (Redis 우선, MongoDB fallback)
    const result = await roomCacheService.getRoom(req.params.roomId);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: result.message || '채팅방을 찾을 수 없습니다.'
      });
    }

    res.json(result);
    
  } catch (error) {
    console.error('[RoomAPI] Room fetch error:', error);
    res.status(500).json({
      success: false,
      message: '채팅방 정보를 불러오는데 실패했습니다.'
    });
  }
});

// 채팅방 입장 (Redis 캐시 적용)
router.post('/:roomId/join', auth, async (req, res) => {
  try {
    console.log(`[RoomAPI] User ${req.user.id} joining room ${req.params.roomId} with cache`);
    
    const { password } = req.body;
    
    // roomCacheService를 통해 입장 (MongoDB + Redis 동기화)
    const result = await roomCacheService.joinRoom(req.params.roomId, req.user.id, password);

    if (!result.success) {
      const statusCode = result.message === '비밀번호가 일치하지 않습니다.' ? 401 : 404;
      return res.status(statusCode).json({
        success: false,
        message: result.message
      });
    }

    // Socket.IO를 통해 참여자 업데이트 알림
    if (io) {
      io.to(req.params.roomId).emit('roomUpdate', result.data);
    }

    res.json(result);
    
  } catch (error) {
    console.error('[RoomAPI] 방 입장 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 에러가 발생했습니다.',
      error: error.message
    });
  }
});

module.exports = {
  router,
  initializeSocket
};