// backend/utils/redisClusterClient.js
const Redis = require('redis');

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

class RedisClusterClient {
  constructor(config = {}) {
    // 환경변수에서 설정 로드
    this.config = {
      clusterEnabled: config.clusterEnabled || process.env.REDIS_CLUSTER_ENABLED === 'true',
      
      // Master 설정 (쓰기 전용)
      masterHost: config.masterHost || process.env.REDIS_MASTER_HOST || process.env.REDIS_HOST || 'localhost',
      masterPort: config.masterPort || parseInt(process.env.REDIS_MASTER_PORT) || parseInt(process.env.REDIS_PORT) || 6379,
      
      // Slave 설정 (읽기 전용)
      slaveHost: config.slaveHost || process.env.REDIS_SLAVE_HOST || process.env.REDIS_HOST || 'localhost',
      slavePort: config.slavePort || parseInt(process.env.REDIS_SLAVE_PORT) || 16379,
      
      // 연결 설정
      connectTimeout: config.connectTimeout || parseInt(process.env.REDIS_CONNECT_TIMEOUT) || 5000,
      maxRetries: config.maxRetries || parseInt(process.env.REDIS_MAX_RETRIES) || 5,
      retryDelay: config.retryDelay || parseInt(process.env.REDIS_RETRY_DELAY) || 5000,
      failoverTimeout: config.failoverTimeout || parseInt(process.env.REDIS_FAILOVER_TIMEOUT) || 5000
    };

    // 클라이언트 상태
    this.masterClient = null;
    this.slaveClient = null;
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.useMock = false;
    this.mockClient = null;

    // 통계
    this.stats = {
      readOperations: 0,
      writeOperations: 0,
      masterFailures: 0,
      slaveFailures: 0,
      fallbackToMaster: 0
    };

    console.log('RedisClusterClient initialized:', {
      clusterEnabled: this.config.clusterEnabled,
      master: `${this.config.masterHost}:${this.config.masterPort}`,
      slave: `${this.config.slaveHost}:${this.config.slavePort}`
    });
  }

  async connect() {
    if (this.isConnected && (this.masterClient || this.mockClient)) {
      return this.config.clusterEnabled ? { master: this.masterClient, slave: this.slaveClient } : this.masterClient;
    }

    // 설정이 없으면 Mock 클라이언트 사용
    if (!this.config.masterHost || !this.config.masterPort) {
      console.log('Redis configuration not found, using in-memory mock');
      this.mockClient = new MockRedisClient();
      this.isConnected = true;
      this.useMock = true;
      return this.mockClient;
    }

    try {
      if (this.config.clusterEnabled) {
        await this.connectCluster();
      } else {
        await this.connectSingle();
      }
      
      this.isConnected = true;
      this.connectionAttempts = 0;
      console.log('Redis connection established successfully');
      
      return this.config.clusterEnabled ? { master: this.masterClient, slave: this.slaveClient } : this.masterClient;

    } catch (error) {
      console.error('Redis connection failed:', error.message);
      console.log('Switching to in-memory mock Redis');
      
      this.mockClient = new MockRedisClient();
      this.isConnected = true;
      this.useMock = true;
      return this.mockClient;
    }
  }

  async connectSingle() {
    console.log('Connecting to single Redis instance...');
    
    this.masterClient = Redis.createClient({
      url: `redis://${this.config.masterHost}:${this.config.masterPort}`,
      socket: {
        host: this.config.masterHost,
        port: this.config.masterPort,
        connectTimeout: this.config.connectTimeout,
        reconnectStrategy: (retries) => {
          if (retries > this.config.maxRetries) {
            console.log('Max Redis reconnection attempts reached, switching to mock');
            return false;
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    this.setupClientEvents(this.masterClient, 'Master');
    await this.masterClient.connect();
  }

  async connectCluster() {
    console.log('Connecting to Redis Master-Slave cluster...');

    // Master 연결
    this.masterClient = Redis.createClient({
      url: `redis://${this.config.masterHost}:${this.config.masterPort}`,
      socket: {
        host: this.config.masterHost,
        port: this.config.masterPort,
        connectTimeout: this.config.connectTimeout,
        reconnectStrategy: (retries) => {
          if (retries > this.config.maxRetries) {
            console.log('Master Redis max reconnection attempts reached');
            return false;
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    // Slave 연결
    this.slaveClient = Redis.createClient({
      url: `redis://${this.config.slaveHost}:${this.config.slavePort}`,
      socket: {
        host: this.config.slaveHost,
        port: this.config.slavePort,
        connectTimeout: this.config.connectTimeout,
        reconnectStrategy: (retries) => {
          if (retries > this.config.maxRetries) {
            console.log('Slave Redis max reconnection attempts reached');
            return false;
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    this.setupClientEvents(this.masterClient, 'Master');
    this.setupClientEvents(this.slaveClient, 'Slave');

    // 동시 연결
    await Promise.all([
      this.masterClient.connect(),
      this.slaveClient.connect()
    ]);
  }

  setupClientEvents(client, type) {
    client.on('connect', () => {
      console.log(`Redis ${type} Client Connected`);
    });

    client.on('error', (err) => {
      console.error(`Redis ${type} Client Error:`, err.message);
      if (type === 'Master') {
        this.stats.masterFailures++;
      } else {
        this.stats.slaveFailures++;
      }
    });

    client.on('reconnecting', () => {
      console.log(`Redis ${type} Client Reconnecting...`);
    });
  }

  async getReadClient() {
    if (this.useMock) {
      return this.mockClient;
    }

    if (!this.isConnected) {
      await this.connect();
    }

    // 클러스터 모드가 아니거나 Slave가 없으면 Master 사용
    if (!this.config.clusterEnabled || !this.slaveClient) {
      return this.masterClient;
    }

    // Slave 클라이언트가 연결되어 있으면 사용
    if (this.slaveClient && this.slaveClient.isReady) {
      return this.slaveClient;
    }

    // Slave 실패 시 Master로 fallback
    console.warn('Slave Redis not available, falling back to Master for read operation');
    this.stats.fallbackToMaster++;
    return this.masterClient;
  }

  async getWriteClient() {
    if (this.useMock) {
      return this.mockClient;
    }

    if (!this.isConnected) {
      await this.connect();
    }

    return this.masterClient;
  }

  // 읽기 작업 (Slave 우선)
  async get(key) {
    try {
      const client = await this.getReadClient();
      this.stats.readOperations++;

      if (this.useMock) {
        return await client.get(key);
      }

      const value = await client.get(key);
      if (!value) return null;

      try {
        return JSON.parse(value);
      } catch (parseError) {
        return value;
      }
    } catch (error) {
      console.error('Redis get error:', error);
      throw error;
    }
  }

  // 쓰기 작업 (Master 전용)
  async set(key, value, options = {}) {
    try {
      const client = await this.getWriteClient();
      this.stats.writeOperations++;

      if (this.useMock) {
        return await client.set(key, value, options);
      }

      let stringValue;
      if (typeof value === 'object') {
        stringValue = JSON.stringify(value);
      } else {
        stringValue = String(value);
      }

      if (options.ttl) {
        return await client.setEx(key, options.ttl, stringValue);
      }
      return await client.set(key, stringValue);
    } catch (error) {
      console.error('Redis set error:', error);
      throw error;
    }
  }

  async setEx(key, seconds, value) {
    try {
      const client = await this.getWriteClient();
      this.stats.writeOperations++;

      if (this.useMock) {
        return await client.setEx(key, seconds, value);
      }

      let stringValue;
      if (typeof value === 'object') {
        stringValue = JSON.stringify(value);
      } else {
        stringValue = String(value);
      }

      return await client.setEx(key, seconds, stringValue);
    } catch (error) {
      console.error('Redis setEx error:', error);
      throw error;
    }
  }

  async del(key) {
    try {
      const client = await this.getWriteClient();
      this.stats.writeOperations++;
      return await client.del(key);
    } catch (error) {
      console.error('Redis del error:', error);
      throw error;
    }
  }

  async expire(key, seconds) {
    try {
      const client = await this.getWriteClient();
      this.stats.writeOperations++;
      return await client.expire(key, seconds);
    } catch (error) {
      console.error('Redis expire error:', error);
      throw error;
    }
  }

  // 클러스터 상태 확인
  async getClusterStatus() {
    const status = {
      clusterEnabled: this.config.clusterEnabled,
      useMock: this.useMock,
      masterConnected: this.masterClient ? this.masterClient.isReady : false,
      slaveConnected: this.slaveClient ? this.slaveClient.isReady : false,
      stats: { ...this.stats }
    };

    // 연결 상태 테스트
    if (!this.useMock) {
      try {
        if (this.masterClient) {
          await this.masterClient.ping();
          status.masterPing = true;
        }
        if (this.slaveClient) {
          await this.slaveClient.ping();
          status.slavePing = true;
        }
      } catch (error) {
        status.pingError = error.message;
      }
    }

    return status;
  }

  // 통계 리셋
  resetStats() {
    this.stats = {
      readOperations: 0,
      writeOperations: 0,
      masterFailures: 0,
      slaveFailures: 0,
      fallbackToMaster: 0
    };
  }

  // RedisJSON 메서드들
  async jsonSet(key, path, value) {
    if (this.useMock) {
      // Mock 환경에서는 일반 set으로 대체
      return await this.set(key, value);
    }

    this.stats.writeOperations++;
    const client = await this.getWriteClient();
    
    try {
      return await client.sendCommand(['JSON.SET', key, path, JSON.stringify(value)]);
    } catch (error) {
      this.stats.masterFailures++;
      console.error('RedisJSON SET error:', error);
      throw error;
    }
  }

  async jsonGet(key, path = '$') {
    if (this.useMock) {
      // Mock 환경에서는 일반 get으로 대체
      const result = await this.get(key);
      return result ? [result] : null; // RedisJSON은 배열로 반환
    }

    this.stats.readOperations++;
    const client = await this.getReadClient();
    
    try {
      const result = await client.sendCommand(['JSON.GET', key, path]);
      return result ? JSON.parse(result) : null;
    } catch (error) {
      this.stats.slaveFailures++;
      console.error('RedisJSON GET error:', error);
      
      // Slave 실패 시 Master로 fallback
      if (this.config.clusterEnabled && client !== this.masterClient) {
        this.stats.fallbackToMaster++;
        try {
          const masterResult = await this.masterClient.sendCommand(['JSON.GET', key, path]);
          return masterResult ? JSON.parse(masterResult) : null;
        } catch (masterError) {
          this.stats.masterFailures++;
          throw masterError;
        }
      }
      throw error;
    }
  }

  async jsonDel(key, path = '$') {
    if (this.useMock) {
      // Mock 환경에서는 일반 del로 대체
      return await this.del(key);
    }

    this.stats.writeOperations++;
    const client = await this.getWriteClient();
    
    try {
      return await client.sendCommand(['JSON.DEL', key, path]);
    } catch (error) {
      this.stats.masterFailures++;
      console.error('RedisJSON DEL error:', error);
      throw error;
    }
  }

  // RedisSearch 메서드들
  async ftCreate(indexName, schema) {
    if (this.useMock) {
      console.log('FT.CREATE command not supported in mock mode');
      return 'OK';
    }

    const client = await this.getWriteClient();
    
    try {
      return await client.sendCommand(['FT.CREATE', indexName, ...schema]);
    } catch (error) {
      this.stats.masterFailures++;
      // 인덱스가 이미 존재하는 경우 무시
      if (error.message.includes('Index already exists')) {
        console.log(`Index ${indexName} already exists, skipping creation`);
        return 'OK';
      }
      console.error('RedisSearch FT.CREATE error:', error);
      throw error;
    }
  }

  async ftSearch(indexName, query, options = {}) {
    if (this.useMock) {
      console.log('FT.SEARCH command not supported in mock mode');
      return { total: 0, documents: [] };
    }

    this.stats.readOperations++;
    const client = await this.getReadClient();
    
    try {
      const args = ['FT.SEARCH', indexName, query];
      
      if (options.limit) {
        args.push('LIMIT', options.offset || 0, options.limit);
      }
      
      if (options.sortBy) {
        args.push('SORTBY', options.sortBy, options.sortOrder || 'ASC');
      }
      
      if (options.return) {
        args.push('RETURN', options.return.length, ...options.return);
      }

      const result = await client.sendCommand(args);
      
      // RedisSearch 결과 파싱
      if (!Array.isArray(result) || result.length === 0) {
        return { total: 0, documents: [] };
      }

      const total = result[0];
      const documents = [];
      
      for (let i = 1; i < result.length; i += 2) {
        if (i + 1 < result.length) {
          const key = result[i];
          const fields = result[i + 1];
          documents.push({ key, fields });
        }
      }

      return { total, documents };
    } catch (error) {
      this.stats.slaveFailures++;
      console.error('RedisSearch FT.SEARCH error:', error);
      
      // Slave 실패 시 Master로 fallback
      if (this.config.clusterEnabled && client !== this.masterClient) {
        this.stats.fallbackToMaster++;
        try {
          return await this.masterClient.sendCommand(['FT.SEARCH', indexName, query, ...Object.values(options)]);
        } catch (masterError) {
          this.stats.masterFailures++;
          throw masterError;
        }
      }
      throw error;
    }
  }

  async ftInfo(indexName) {
    if (this.useMock) {
      console.log('FT.INFO command not supported in mock mode');
      return [];
    }

    const client = await this.getReadClient();
    
    try {
      return await client.sendCommand(['FT.INFO', indexName]);
    } catch (error) {
      console.error('RedisSearch FT.INFO error:', error);
      throw error;
    }
  }

  async ftDropIndex(indexName) {
    if (this.useMock) {
      console.log('FT.DROPINDEX command not supported in mock mode');
      return 'OK';
    }

    const client = await this.getWriteClient();
    
    try {
      return await client.sendCommand(['FT.DROPINDEX', indexName]);
    } catch (error) {
      console.error('RedisSearch FT.DROPINDEX error:', error);
      throw error;
    }
  }

  async quit() {
    const promises = [];
    
    if (this.masterClient) {
      promises.push(this.masterClient.quit().catch(err => console.error('Master quit error:', err)));
    }
    
    if (this.slaveClient) {
      promises.push(this.slaveClient.quit().catch(err => console.error('Slave quit error:', err)));
    }

    if (this.mockClient) {
      promises.push(this.mockClient.quit().catch(err => console.error('Mock quit error:', err)));
    }

    await Promise.all(promises);
    
    this.masterClient = null;
    this.slaveClient = null;
    this.mockClient = null;
    this.isConnected = false;
    
    console.log('Redis cluster connection closed successfully');
  }
}

module.exports = RedisClusterClient;