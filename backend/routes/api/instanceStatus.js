// backend/routes/api/instanceStatus.js
const express = require('express');
const router = express.Router();
const redisClient = require('../../utils/redisClient');
const crossInstanceRedisService = require('../../services/crossInstanceRedisService');
const mongoReplicationService = require('../../services/mongoReplicationService');
const distributedLockService = require('../../services/distributedLockService');
const mongoose = require('mongoose');

/**
 * 인스턴스 상태 관리 API
 * 로드 밸런싱 및 헬스 체크용 엔드포인트 제공
 */

/**
 * GET /api/instance-status/health
 * 기본 헬스 체크 엔드포인트
 */
router.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      instanceId: process.env.INSTANCE_ID || 'instance-1',
      port: process.env.PORT || 5001,
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development'
    };

    // 기본 서비스 상태 확인
    const checks = await Promise.allSettled([
      checkRedisHealth(),
      checkMongoHealth(),
      checkMemoryUsage()
    ]);

    health.services = {
      redis: checks[0].status === 'fulfilled' ? checks[0].value : { status: 'unhealthy', error: checks[0].reason?.message },
      mongodb: checks[1].status === 'fulfilled' ? checks[1].value : { status: 'unhealthy', error: checks[1].reason?.message },
      memory: checks[2].status === 'fulfilled' ? checks[2].value : { status: 'unknown' }
    };

    // 전체 상태 결정
    const allHealthy = Object.values(health.services).every(service => service.status === 'healthy');
    health.status = allHealthy ? 'healthy' : 'degraded';

    const statusCode = allHealthy ? 200 : 503;
    res.status(statusCode).json(health);

  } catch (error) {
    console.error('[InstanceStatus] Health check failed:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/instance-status/detailed
 * 상세 인스턴스 상태 정보
 */
router.get('/detailed', async (req, res) => {
  try {
    const detailed = {
      instanceId: process.env.INSTANCE_ID || 'instance-1',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      
      // 시스템 리소스
      system: {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        platform: process.platform,
        nodeVersion: process.version
      },

      // 네트워크 설정
      network: {
        port: process.env.PORT || 5001,
        mongoUri: process.env.MONGO_URI?.replace(/\/\/.*:.*@/, '//***:***@') || 'Not configured',
        redisHost: process.env.REDIS_HOST || 'localhost',
        redisPort: process.env.REDIS_PORT || 6379
      },

      // Cross-Instance 상태
      crossInstance: crossInstanceRedisService.getStatus(),
      
      // MongoDB 복제 상태
      mongoReplication: mongoReplicationService.getReplicationStatus(),
      
      // 분산 락 상태
      distributedLocks: {
        activeLocks: distributedLockService.getActiveLocks(),
        totalLocks: distributedLockService.getActiveLocks().length
      }
    };

    res.json(detailed);

  } catch (error) {
    console.error('[InstanceStatus] Detailed status failed:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/instance-status/load-metrics
 * 부하 분산용 메트릭 정보
 */
router.get('/load-metrics', async (req, res) => {
  try {
    const metrics = {
      instanceId: process.env.INSTANCE_ID || 'instance-1',
      timestamp: new Date().toISOString(),
      
      // 성능 메트릭
      performance: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        loadAverage: require('os').loadavg()
      },

      // 연결 상태
      connections: {
        activeSocketConnections: global.activeSocketConnections || 0,
        activeLocks: distributedLockService.getActiveLocks().length,
        crossInstancePeers: crossInstanceRedisService.getStatus().connectedPeers?.length || 0
      },

      // 처리 중인 작업
      workload: {
        messagesProcessed: global.messagesProcessed || 0,
        cacheHitRate: global.cacheHitRate || 0,
        avgResponseTime: global.avgResponseTime || 0
      },

      // 가용성 점수 계산 (0-100)
      availabilityScore: calculateAvailabilityScore()
    };

    res.json(metrics);

  } catch (error) {
    console.error('[InstanceStatus] Load metrics failed:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/instance-status/drain
 * 인스턴스 드레인 모드 (새 연결 거부, 기존 연결 완료 대기)
 */
router.post('/drain', async (req, res) => {
  try {
    global.instanceDraining = true;
    
    console.log('[InstanceStatus] Instance entering drain mode');
    
    // 새로운 Socket.IO 연결 거부 설정
    global.rejectNewConnections = true;
    
    // 현재 활성 연결 수 조회
    const activeConnections = global.activeSocketConnections || 0;
    
    res.json({
      message: 'Instance entering drain mode',
      activeConnections,
      timestamp: new Date().toISOString(),
      estimated_drain_time: Math.max(30, activeConnections * 2) // 예상 드레인 시간(초)
    });

  } catch (error) {
    console.error('[InstanceStatus] Drain mode failed:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/instance-status/peers
 * 다른 인스턴스들의 상태 조회
 */
router.get('/peers', async (req, res) => {
  try {
    const peers = [];
    const peerInstances = (process.env.PEER_INSTANCES || '').split(',').filter(Boolean);
    
    for (const peerUrl of peerInstances) {
      try {
        const peerHealth = await fetchPeerHealth(peerUrl);
        peers.push({
          url: peerUrl,
          ...peerHealth,
          lastChecked: new Date().toISOString()
        });
      } catch (error) {
        peers.push({
          url: peerUrl,
          status: 'unreachable',
          error: error.message,
          lastChecked: new Date().toISOString()
        });
      }
    }

    res.json({
      instanceId: process.env.INSTANCE_ID || 'instance-1',
      peers,
      totalPeers: peers.length,
      healthyPeers: peers.filter(p => p.status === 'healthy').length
    });

  } catch (error) {
    console.error('[InstanceStatus] Peers status failed:', error);
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Redis 상태 확인
 */
async function checkRedisHealth() {
  try {
    await redisClient.ping();
    return {
      status: 'healthy',
      responseTime: Date.now(), // 실제로는 ping 응답시간 측정
      connection: 'established'
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}

/**
 * MongoDB 상태 확인
 */
async function checkMongoHealth() {
  try {
    const state = mongoose.connection.readyState;
    const stateNames = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    
    return {
      status: state === 1 ? 'healthy' : 'unhealthy',
      state: stateNames[state],
      host: mongoose.connection.host,
      name: mongoose.connection.name
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}

/**
 * 메모리 사용량 확인
 */
async function checkMemoryUsage() {
  const usage = process.memoryUsage();
  const totalMB = Math.round(usage.heapTotal / 1024 / 1024);
  const usedMB = Math.round(usage.heapUsed / 1024 / 1024);
  const usagePercent = Math.round((usage.heapUsed / usage.heapTotal) * 100);
  
  return {
    status: usagePercent < 90 ? 'healthy' : 'warning',
    totalMB,
    usedMB,
    usagePercent
  };
}

/**
 * 가용성 점수 계산
 */
function calculateAvailabilityScore() {
  let score = 100;
  
  // 메모리 사용률 기반 점수 차감
  const memUsage = process.memoryUsage();
  const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  if (memPercent > 80) score -= (memPercent - 80) * 2;
  
  // 업타임 기반 보너스
  const uptimeHours = process.uptime() / 3600;
  if (uptimeHours > 1) score += Math.min(10, uptimeHours);
  
  // 활성 락 수 기반 점수 차감
  const activeLocks = distributedLockService.getActiveLocks().length;
  if (activeLocks > 10) score -= activeLocks;
  
  // Cross-instance 연결 상태 기반
  const crossInstanceStatus = crossInstanceRedisService.getStatus();
  if (!crossInstanceStatus.isInitialized) score -= 20;
  
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Peer 인스턴스 헬스 체크
 */
async function fetchPeerHealth(peerUrl) {
  const fetch = require('node-fetch');
  const response = await fetch(`${peerUrl}/api/instance-status/health`, {
    timeout: 5000,
    headers: { 'Content-Type': 'application/json' }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  return await response.json();
}

module.exports = router;