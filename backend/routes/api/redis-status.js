// backend/routes/api/redis-status.js
const express = require('express');
const router = express.Router();
const redisClient = require('../../utils/redisClient');

/**
 * @route   GET /api/redis-status
 * @desc    Redis 클러스터 상태 확인
 * @access  Private (개발환경에서만 사용)
 */
router.get('/', async (req, res) => {
  try {
    // 프로덕션 환경에서는 접근 제한
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        message: 'Redis status endpoint is not available in production'
      });
    }

    const status = await redisClient.getClusterStatus();
    
    res.json({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        redis: status,
        recommendations: generateRecommendations(status)
      }
    });

  } catch (error) {
    console.error('Redis status check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Redis status',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * @route   POST /api/redis-status/reset-stats
 * @desc    Redis 통계 리셋
 * @access  Private (개발환경에서만 사용)
 */
router.post('/reset-stats', async (req, res) => {
  try {
    // 프로덕션 환경에서는 접근 제한
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        message: 'Redis stats reset is not available in production'
      });
    }

    redisClient.resetStats();
    
    res.json({
      success: true,
      message: 'Redis statistics have been reset',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Redis stats reset error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset Redis stats',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * @route   GET /api/redis-status/health
 * @desc    Redis 헬스체크 (간단한 ping)
 * @access  Public
 */
router.get('/health', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // 간단한 ping 테스트
    await redisClient.set('health_check', 'ok', { ttl: 10 });
    const value = await redisClient.get('health_check');
    await redisClient.del('health_check');
    
    const responseTime = Date.now() - startTime;
    const isHealthy = value === 'ok';

    res.json({
      success: true,
      data: {
        healthy: isHealthy,
        responseTime: `${responseTime}ms`,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
      }
    });

  } catch (error) {
    console.error('Redis health check error:', error);
    res.status(503).json({
      success: false,
      data: {
        healthy: false,
        error: 'Redis connection failed',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Redis 상태에 따른 권장사항 생성
function generateRecommendations(status) {
  const recommendations = [];

  if (!status.clusterEnabled) {
    recommendations.push({
      type: 'info',
      message: 'Single Redis instance mode. Consider enabling cluster mode for production.'
    });
  }

  if (status.useMock) {
    recommendations.push({
      type: 'warning',
      message: 'Using mock Redis client. Check Redis server connection.'
    });
  }

  if (status.stats) {
    const { readOperations, writeOperations, fallbackToMaster } = status.stats;
    const total = readOperations + writeOperations;
    
    if (total > 0) {
      const readRatio = (readOperations / total * 100).toFixed(1);
      const writeRatio = (writeOperations / total * 100).toFixed(1);
      
      recommendations.push({
        type: 'info',
        message: `Operations distribution: ${readRatio}% reads, ${writeRatio}% writes`
      });

      if (fallbackToMaster > 0) {
        const fallbackRatio = (fallbackToMaster / readOperations * 100).toFixed(1);
        recommendations.push({
          type: 'warning',
          message: `${fallbackRatio}% of read operations fell back to master. Check slave connectivity.`
        });
      }
    }
  }

  if (status.clusterEnabled && !status.slaveConnected) {
    recommendations.push({
      type: 'error',
      message: 'Slave Redis is not connected. All operations are using master.'
    });
  }

  if (!status.masterConnected) {
    recommendations.push({
      type: 'error',
      message: 'Master Redis is not connected. Check server status.'
    });
  }

  return recommendations;
}

module.exports = router;