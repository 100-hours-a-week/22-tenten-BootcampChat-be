// backend/scripts/initializeMessageCache.js
const redisClient = require('../utils/redisClient');
const { setupAllIndexes } = require('./setupRedisIndex');
const messageCacheService = require('../services/messageCacheService');
const mongoSyncWorker = require('../services/mongoSyncWorker');

/**
 * 메시지 캐시 시스템 초기화 스크립트
 * - Redis 연결 확인
 * - RedisSearch 인덱스 설정
 * - Cache Warming
 * - MongoDB 동기화 워커 시작
 */

async function initializeMessageCache() {
  console.log('🚀 Initializing Message Cache System...\n');

  try {
    // 1. Redis 연결 확인
    console.log('📡 Checking Redis connection...');
    await redisClient.connect();
    console.log('✅ Redis connection established\n');

    // 2. RedisSearch 인덱스 설정
    console.log('🔍 Setting up RedisSearch indexes...');
    await setupAllIndexes();
    console.log('✅ RedisSearch indexes configured\n');

    // 3. Cache Warming (활성 방들의 최근 메시지 캐싱)
    console.log('🔥 Starting cache warming for active rooms...');
    try {
      const warmingResult = await messageCacheService.warmAllActiveRooms();
      console.log(`✅ Cache warming completed: ${warmingResult.cachedMessages} messages cached across ${warmingResult.totalRooms} rooms\n`);
    } catch (warmingError) {
      console.warn('⚠️ Cache warming failed, but system can continue:', warmingError.message);
      console.log('💡 Cache will be populated on-demand\n');
    }

    // 4. MongoDB 동기화 워커 시작
    console.log('⚙️ Starting MongoDB sync worker...');
    await mongoSyncWorker.start();
    console.log('✅ MongoDB sync worker started\n');

    // 5. 초기화 완료 상태 확인
    const cacheStatus = await messageCacheService.getCacheStatus();
    const workerStatus = mongoSyncWorker.getStatus();

    console.log('📊 System Status:', {
      cache: {
        participantsCacheSize: cacheStatus.participantsCacheSize,
        redis: cacheStatus.redis ? 'Connected' : 'Disconnected'
      },
      worker: {
        isRunning: workerStatus.isRunning,
        uptime: workerStatus.uptime
      },
      timestamp: new Date().toISOString()
    });

    console.log('\n✨ Message Cache System initialization completed successfully!');

    // Graceful shutdown 핸들러 등록
    const gracefulShutdown = async (signal) => {
      console.log(`\n📤 Received ${signal}. Gracefully shutting down...`);
      
      try {
        await mongoSyncWorker.stop();
        await redisClient.disconnect();
        console.log('✅ Message Cache System shut down successfully');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return {
      success: true,
      message: 'Message cache system initialized successfully',
      cache: cacheStatus,
      worker: workerStatus
    };

  } catch (error) {
    console.error('❌ Failed to initialize message cache system:', error);
    throw error;
  }
}

/**
 * 시스템 상태 확인
 */
async function checkSystemHealth() {
  try {
    const cacheStatus = await messageCacheService.getCacheStatus();
    const workerStatus = mongoSyncWorker.getStatus();

    return {
      healthy: true,
      cache: cacheStatus,
      worker: workerStatus,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * 스크립트 직접 실행 시
 */
if (require.main === module) {
  initializeMessageCache()
    .then((result) => {
      console.log('\n🎉 Initialization completed:', result.message);
    })
    .catch((error) => {
      console.error('\n💥 Initialization failed:', error);
      process.exit(1);
    });
}

module.exports = {
  initializeMessageCache,
  checkSystemHealth
};