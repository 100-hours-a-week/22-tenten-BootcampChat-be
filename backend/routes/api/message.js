const express = require('express');
const router = express.Router();
const messageController = require('../../controllers/messageController');
const auth = require('../../middleware/auth');
const { rateLimit } = require('express-rate-limit');

// 메시지 API 속도 제한
const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1분
  max: 100, // IP당 최대 요청 수
  message: {
    success: false,
    message: '너무 많은 메시지 요청이 발생했습니다. 잠시 후 다시 시도해주세요.',
    code: 'TOO_MANY_REQUESTS'
  }
});

// 채팅방의 메시지 목록 조회 (캐시 우선)
router.get('/rooms/:roomId/messages', [messageLimiter, auth], messageController.loadMessages);

// 메시지 검색 (추후 구현)
router.get('/rooms/:roomId/messages/search', [messageLimiter, auth], messageController.searchMessages);

// 메시지 상태 및 캐시 통계 (개발/디버깅용)
router.get('/rooms/:roomId/messages/stats', [auth], messageController.getMessageStats);

module.exports = router;