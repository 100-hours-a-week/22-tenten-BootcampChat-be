// backend/controllers/messageController.js
const Room = require('../models/Room');
const messageCacheService = require('../services/messageCacheService');

/**
 * 메시지 API 컨트롤러
 * messageCacheService를 통한 Redis 우선 조회 구현
 */

/**
 * 채팅방의 메시지 목록 조회 (캐시 우선)
 * GET /api/rooms/:roomId/messages
 */
const loadMessages = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { before, limit = 30 } = req.query;
    const userId = req.user.id;

    console.log(`[MessageAPI] Loading messages for room ${roomId}, user ${userId}`);

    // 권한 확인: 사용자가 해당 채팅방의 참여자인지 확인
    const room = await Room.findOne({
      _id: roomId,
      participants: userId
    }).select('_id participants').lean();

    if (!room) {
      return res.status(403).json({
        success: false,
        message: '채팅방에 접근할 권한이 없습니다.',
        code: 'ACCESS_DENIED'
      });
    }

    // messageCacheService를 통해 메시지 조회 (Redis 우선 → MongoDB fallback)
    const result = await messageCacheService.getMessagesByRoom(
      roomId, 
      before ? new Date(before) : null, 
      Math.min(parseInt(limit) || 30, 100) // 최대 100개 제한
    );

    // 읽음 처리: 조회된 메시지를 읽음으로 표시 (비동기)
    if (result.messages.length > 0) {
      const messageIds = result.messages.map(msg => msg._id.toString());
      messageCacheService.markAsRead(messageIds, userId).catch(error => {
        console.error('[MessageAPI] Auto-read marking error:', error);
      });
    }

    // 캐시 헤더 설정
    const cacheMaxAge = result.source === 'redis' ? 30 : 10;
    res.set({
      'Cache-Control': `private, max-age=${cacheMaxAge}`,
      'Last-Modified': new Date().toUTCString(),
      'X-Cache-Source': result.source,
      'X-Message-Count': result.messages.length.toString()
    });

    // 응답 반환
    res.json({
      success: true,
      data: {
        messages: result.messages,
        hasMore: result.hasMore,
        oldestTimestamp: result.oldestTimestamp,
        metadata: {
          source: result.source,
          roomId,
          requestedLimit: limit,
          actualCount: result.messages.length,
          timestamp: new Date().toISOString()
        }
      },
      pagination: {
        hasMore: result.hasMore,
        before: result.oldestTimestamp,
        limit: parseInt(limit) || 30
      }
    });

    console.log(`[MessageAPI] Messages loaded successfully:`, {
      roomId,
      source: result.source,
      messageCount: result.messages.length,
      hasMore: result.hasMore
    });

  } catch (error) {
    console.error('[MessageAPI] Load messages error:', error);
    
    const errorResponse = {
      success: false,
      message: '메시지를 불러오는데 실패했습니다.',
      code: 'MESSAGE_LOAD_ERROR',
      timestamp: new Date().toISOString()
    };

    // 개발 환경에서 상세 에러 정보 제공
    if (process.env.NODE_ENV === 'development') {
      errorResponse.error = {
        message: error.message,
        stack: error.stack
      };
    }

    res.status(500).json(errorResponse);
  }
};

/**
 * 메시지 검색 (추후 구현 예정)
 * GET /api/rooms/:roomId/messages/search
 */
const searchMessages = async (req, res) => {
  try {
    // Redis Search를 활용한 메시지 검색 구현 예정
    res.status(501).json({
      success: false,
      message: '메시지 검색 기능은 아직 구현되지 않았습니다.',
      code: 'NOT_IMPLEMENTED'
    });
  } catch (error) {
    console.error('[MessageAPI] Search messages error:', error);
    res.status(500).json({
      success: false,
      message: '메시지 검색 중 오류가 발생했습니다.',
      code: 'SEARCH_ERROR'
    });
  }
};

/**
 * 메시지 상태 조회 (읽음/안읽음 통계)
 * GET /api/rooms/:roomId/messages/stats
 */
const getMessageStats = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;

    // 권한 확인
    const room = await Room.findOne({
      _id: roomId,
      participants: userId
    }).select('_id').lean();

    if (!room) {
      return res.status(403).json({
        success: false,
        message: '채팅방에 접근할 권한이 없습니다.',
        code: 'ACCESS_DENIED'
      });
    }

    // 캐시 상태 조회 (개발/디버깅용)
    const cacheStatus = await messageCacheService.getCacheStatus();

    res.json({
      success: true,
      data: {
        roomId,
        cache: cacheStatus,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('[MessageAPI] Get message stats error:', error);
    res.status(500).json({
      success: false,
      message: '메시지 상태 조회 중 오류가 발생했습니다.',
      code: 'STATS_ERROR'
    });
  }
};

module.exports = {
  loadMessages,
  searchMessages,
  getMessageStats
};