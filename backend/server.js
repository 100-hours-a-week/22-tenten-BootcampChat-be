require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const { router: roomsRouter, initializeSocket } = require('./routes/api/rooms');
const routes = require('./routes');
const redisClient = require('./utils/redisClient');
const { setupAllIndexes } = require('./scripts/setupRedisIndex');
const roomCacheService = require('./services/roomCacheService');
const { initializeMessageCache } = require('./scripts/initializeMessageCache');
const mongoSyncWorker = require('./services/mongoSyncWorker');
const crossInstanceRedisService = require('./services/crossInstanceRedisService');
const mongoReplicationService = require('./services/mongoReplicationService');
const distributedLockService = require('./services/distributedLockService');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5001;

// trust proxy 설정 추가
app.set('trust proxy', 1);

// CORS 설정
const corsOptions = {
  origin: [
    'https://bootcampchat-fe.run.goorm.site',
    'https://bootcampchat-hgxbv.dev-k8s.arkain.io',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'https://localhost:3000',
    'https://localhost:3001',
    'https://localhost:3002',
    'http://0.0.0.0:3000',
    'https://0.0.0.0:3000',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-auth-token',
    'x-session-id',
    'Cache-Control',
    'Pragma',
  ],
  exposedHeaders: ['x-auth-token', 'x-session-id'],
};

// 기본 미들웨어
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// OPTIONS 요청에 대한 처리
app.options('*', cors(corsOptions));

// 정적 파일 제공
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 요청 로깅
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`
    );
    next();
  });
}

// 기본 상태 체크
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

// API 라우트 마운트
app.use('/api', routes);

// Socket.IO 설정
const io = socketIO(server, { cors: corsOptions });
require('./sockets/chat')(io);

// Socket.IO 객체 전달
initializeSocket(io);

// 404 에러 핸들러
app.use((req, res) => {
  console.log('404 Error:', req.originalUrl);
  res.status(404).json({
    success: false,
    message: '요청하신 리소스를 찾을 수 없습니다.',
    path: req.originalUrl,
  });
});

// 글로벌 에러 핸들러
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || '서버 에러가 발생했습니다.',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

/**
 * Redis 및 캐시 시스템 초기화
 */
async function initializeCacheSystem() {
  try {
    console.log('\n🔄 Initializing Cache System...');
    
    // 1. Redis 연결
    await redisClient.connect();
    console.log('✅ Redis connection established');
    
    // 2. RedisSearch 인덱스 생성 (채팅방 + 메시지)
    await setupAllIndexes();
    console.log('✅ RedisSearch indexes created');
    
    // 3. 채팅방 캐시 워밍
    console.log('🔥 Starting room cache warming...');
    const roomWarmResult = await roomCacheService.warmCache();
    console.log(`✅ Room cache warming: ${roomWarmResult.cached}/${roomWarmResult.total} rooms cached`);
    
    // 4. 메시지 캐시 시스템 초기화 (비동기로 실행, 실패해도 계속)
    initializeMessageCache().then(result => {
      console.log('✅ Message cache system initialized:', result.message);
    }).catch(error => {
      console.warn('⚠️ Message cache system initialization failed:', error.message);
      console.log('💡 Message cache will be populated on-demand');
    });
    
    return true;
  } catch (error) {
    console.error('❌ Cache system initialization failed:', error);
    console.log('⚠️  Server will continue with MongoDB fallback');
    return false;
  }
}

/**
 * Cross-Instance 서비스 초기화
 */
async function initializeCrossInstanceServices() {
  try {
    console.log('\n🔄 Initializing Cross-Instance Services...');
    
    // Cross-Instance Redis 서비스 초기화
    await crossInstanceRedisService.initialize();
    console.log('✅ Cross-Instance Redis service initialized');
    
    // MongoDB 복제 서비스 초기화
    await mongoReplicationService.initialize();
    console.log('✅ MongoDB replication service initialized');
    
    // 분산 락 서비스 초기화
    distributedLockService.startPeriodicCleanup();
    console.log('✅ Distributed lock service initialized');
    
    console.log('\n🌐 Cross-Instance Configuration:');
    console.log(`   - Instance ID: ${process.env.INSTANCE_ID || 'instance-1'}`);
    console.log(`   - Cross-Replication: ${process.env.REDIS_CROSS_REPLICATION_ENABLED === 'true' ? 'Enabled' : 'Disabled'}`);
    console.log(`   - Peer Instances: ${(process.env.PEER_INSTANCES || 'None').split(',').join(', ')}`);
    console.log('   - Data Consistency: Last-Write-Wins strategy');
    console.log('   - Sync Protocol: Redis Pub/Sub + Change Streams\n');
    
    return true;
  } catch (error) {
    console.error('❌ Cross-instance services initialization failed:', error);
    console.log('⚠️  Instance will run in single-node mode');
    return false;
  }
}

// 서버 시작
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('✅ MongoDB Connected');
    
    // 캐시 시스템 초기화 (비동기, 실패해도 서버 시작)
    initializeCacheSystem().catch(error => {
      console.error('Cache system initialization error during startup:', error);
    });

    // Cross-Instance 서비스 초기화 (비동기)
    initializeCrossInstanceServices().catch(error => {
      console.error('Cross-instance services initialization error:', error);
    });
    
    // 서버 시작
    server.listen(PORT, '0.0.0.0', () => {
      console.log('\n🚀 Server Status:');
      console.log(`   - Running on port ${PORT}`);
      console.log(`   - Environment: ${process.env.NODE_ENV}`);
      console.log(`   - API Base URL: http://0.0.0.0:${PORT}/api`);
      console.log(`   - MongoDB: Connected`);
      console.log(`   - Redis: Initializing...`);
      console.log('\n📊 Cache Strategy:');
      console.log('   - Rooms: Read-Through (Redis → MongoDB fallback)');
      console.log('   - Messages: Write-Back (Redis → MongoDB async sync)');
      console.log('   - RedisSearch: Fast queries & pagination');
      console.log('   - Sync Worker: Redis Streams → MongoDB\n');
    });
  })
  .catch((err) => {
    console.error('❌ Server startup error:', err);
    process.exit(1);
  });

/**
 * Graceful Shutdown 처리
 */
async function gracefulShutdown(signal) {
  console.log(`\n⚠️  Received ${signal}. Starting graceful shutdown...`);
  
  try {
    // 새로운 연결 차단
    server.close(async () => {
      console.log('📡 HTTP server closed');
      
      // MongoDB Sync Worker 정리
      try {
        await mongoSyncWorker.stop();
        console.log('⚙️ MongoDB sync worker stopped');
      } catch (error) {
        console.error('MongoDB sync worker shutdown error:', error);
      }
      
      // Redis 연결 정리
      try {
        await redisClient.quit();
        console.log('📦 Redis connections closed');
      } catch (error) {
        console.error('Redis shutdown error:', error);
      }
      
      // MongoDB 연결 정리
      try {
        await mongoose.connection.close();
        console.log('🗄️  MongoDB connection closed');
      } catch (error) {
        console.error('MongoDB shutdown error:', error);
      }
      
      console.log('✅ Graceful shutdown completed\n');
      process.exit(0);
    });
    
    // 30초 후 강제 종료
    setTimeout(() => {
      console.error('⏱️  Shutdown timeout reached, forcing exit');
      process.exit(1);
    }, 30000);
    
  } catch (error) {
    console.error('❌ Shutdown error:', error);
    process.exit(1);
  }
}

// 프로세스 신호 핸들러
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 예외 처리
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

module.exports = { app, server };
