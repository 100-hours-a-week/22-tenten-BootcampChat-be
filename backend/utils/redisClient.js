// backend/utils/redisClient.js
const RedisClusterClient = require('./redisClusterClient');
const { 
  redisHost, 
  redisPort,
  redisClusterEnabled,
  redisMasterHost,
  redisMasterPort,
  redisSlaveHost,
  redisSlavePort,
  redisConnectTimeout,
  redisMaxRetries,
  redisRetryDelay,
  redisFailoverTimeout
} = require('../config/keys');

class MockRedisClient {
  constructor() {
    this.store = new Map();
    this.isConnected = true;
    console.log('Using in-memory Redis mock (Redis server not available)');
  }

  async connect() {
    return this;
  }

  async set(key, value, options = {}) {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    this.store.set(key, { value: stringValue, expires: options.ttl ? Date.now() + (options.ttl * 1000) : null });
    return 'OK';
  }

  async get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    
    if (item.expires && Date.now() > item.expires) {
      this.store.delete(key);
      return null;
    }
    
    try {
      return JSON.parse(item.value);
    } catch {
      return item.value;
    }
  }

  async setEx(key, seconds, value) {
    return this.set(key, value, { ttl: seconds });
  }

  async del(key) {
    return this.store.delete(key) ? 1 : 0;
  }

  async expire(key, seconds) {
    const item = this.store.get(key);
    if (item) {
      item.expires = Date.now() + (seconds * 1000);
      return 1;
    }
    return 0;
  }

  async quit() {
    this.store.clear();
    console.log('Mock Redis connection closed');
  }
}

class RedisClient {
  constructor() {
    // RedisClusterClient 설정
    const clusterConfig = {
      clusterEnabled: redisClusterEnabled,
      masterHost: redisMasterHost,
      masterPort: parseInt(redisMasterPort) || 6379,
      slaveHost: redisSlaveHost,
      slavePort: parseInt(redisSlavePort) || 16379,
      connectTimeout: parseInt(redisConnectTimeout) || 5000,
      maxRetries: parseInt(redisMaxRetries) || 5,
      retryDelay: parseInt(redisRetryDelay) || 5000,
      failoverTimeout: parseInt(redisFailoverTimeout) || 5000
    };

    this.clusterClient = new RedisClusterClient(clusterConfig);
    this.isConnected = false;

    console.log('RedisClient initialized with cluster support:', {
      clusterEnabled: clusterConfig.clusterEnabled,
      master: `${clusterConfig.masterHost}:${clusterConfig.masterPort}`,
      slave: `${clusterConfig.slaveHost}:${clusterConfig.slavePort}`
    });
  }

  async connect() {
    if (this.isConnected) {
      return this.clusterClient;
    }

    try {
      await this.clusterClient.connect();
      this.isConnected = true;
      return this.clusterClient;
    } catch (error) {
      console.error('Redis cluster connection failed:', error);
      throw error;
    }
  }

  // 기존 API 호환성을 위한 래퍼 메서드들
  async set(key, value, options = {}) {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      return await this.clusterClient.set(key, value, options);
    } catch (error) {
      console.error('Redis set error:', error);
      throw error;
    }
  }

  async get(key) {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      return await this.clusterClient.get(key);
    } catch (error) {
      console.error('Redis get error:', error);
      throw error;
    }
  }

  async setEx(key, seconds, value) {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      return await this.clusterClient.setEx(key, seconds, value);
    } catch (error) {
      console.error('Redis setEx error:', error);
      throw error;
    }
  }

  async del(key) {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      return await this.clusterClient.del(key);
    } catch (error) {
      console.error('Redis del error:', error);
      throw error;
    }
  }

  async expire(key, seconds) {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      return await this.clusterClient.expire(key, seconds);
    } catch (error) {
      console.error('Redis expire error:', error);
      throw error;
    }
  }

  // 클러스터 상태 확인 (새로운 기능)
  async getClusterStatus() {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      return await this.clusterClient.getClusterStatus();
    } catch (error) {
      console.error('Redis cluster status error:', error);
      return { error: error.message };
    }
  }

  // 통계 리셋 (새로운 기능)
  resetStats() {
    if (this.clusterClient) {
      this.clusterClient.resetStats();
    }
  }

  // RedisJSON 메서드들
  async jsonSet(key, path, value) {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      return await this.clusterClient.jsonSet(key, path, value);
    } catch (error) {
      console.error('Redis JSON.SET error:', error);
      throw error;
    }
  }

  async jsonGet(key, path = '$') {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      return await this.clusterClient.jsonGet(key, path);
    } catch (error) {
      console.error('Redis JSON.GET error:', error);
      throw error;
    }
  }

  async jsonDel(key, path = '$') {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      return await this.clusterClient.jsonDel(key, path);
    } catch (error) {
      console.error('Redis JSON.DEL error:', error);
      throw error;
    }
  }

  // RedisSearch 메서드들
  async ftCreate(indexName, schema) {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      return await this.clusterClient.ftCreate(indexName, schema);
    } catch (error) {
      console.error('Redis FT.CREATE error:', error);
      throw error;
    }
  }

  async ftSearch(indexName, query, options = {}) {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      return await this.clusterClient.ftSearch(indexName, query, options);
    } catch (error) {
      console.error('Redis FT.SEARCH error:', error);
      throw error;
    }
  }

  async ftInfo(indexName) {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      return await this.clusterClient.ftInfo(indexName);
    } catch (error) {
      console.error('Redis FT.INFO error:', error);
      throw error;
    }
  }

  async ftDropIndex(indexName) {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      return await this.clusterClient.ftDropIndex(indexName);
    } catch (error) {
      console.error('Redis FT.DROPINDEX error:', error);
      throw error;
    }
  }

  async quit() {
    if (this.clusterClient) {
      try {
        await this.clusterClient.quit();
        this.isConnected = false;
        console.log('Redis cluster connection closed successfully');
      } catch (error) {
        console.error('Redis cluster quit error:', error);
      }
    }
  }
}

const redisClient = new RedisClient();
module.exports = redisClient;