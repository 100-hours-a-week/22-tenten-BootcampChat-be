// backend/config/keys.js
require('dotenv').config();

// 기본 키와 솔트 (개발 환경용)
const DEFAULT_ENCRYPTION_KEY = 'a'.repeat(64); // 32바이트를 hex로 표현
const DEFAULT_PASSWORD_SALT = 'b'.repeat(32); // 16바이트를 hex로 표현

module.exports = {
  mongoURI: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  encryptionKey: process.env.ENCRYPTION_KEY || DEFAULT_ENCRYPTION_KEY,
  passwordSalt: process.env.PASSWORD_SALT || DEFAULT_PASSWORD_SALT,
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT,
  
  // Redis Cluster Configuration
  redisClusterEnabled: process.env.REDIS_CLUSTER_ENABLED === 'true',
  redisMasterHost: process.env.REDIS_MASTER_HOST || process.env.REDIS_HOST,
  redisMasterPort: process.env.REDIS_MASTER_PORT || process.env.REDIS_PORT,
  redisSlaveHost: process.env.REDIS_SLAVE_HOST || process.env.REDIS_HOST,
  redisSlavePort: process.env.REDIS_SLAVE_PORT || '16379',
  
  // Redis Connection Settings
  redisConnectTimeout: process.env.REDIS_CONNECT_TIMEOUT || '5000',
  redisMaxRetries: process.env.REDIS_MAX_RETRIES || '5',
  redisRetryDelay: process.env.REDIS_RETRY_DELAY || '5000',
  redisFailoverTimeout: process.env.REDIS_FAILOVER_TIMEOUT || '5000',
  openaiApiKey: process.env.OPENAI_API_KEY,
  vectorDbEndpoint: process.env.VECTOR_DB_ENDPOINT,
};