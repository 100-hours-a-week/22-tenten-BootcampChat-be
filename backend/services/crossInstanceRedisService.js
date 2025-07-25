// backend/services/crossInstanceRedisService.js
const redisClient = require('../utils/redisClient');
const RedisClusterClient = require('../utils/redisClusterClient');

/**
 * Cross-Instance Redis 동기화 서비스
 * 여러 인스턴스 간 Redis 데이터 동기화 및 이벤트 브로드캐스팅 담당
 */
class CrossInstanceRedisService {
  constructor() {
    this.instanceId = process.env.INSTANCE_ID || 'instance-1';
    this.peerInstances = (process.env.REDIS_PEER_INSTANCES || '').split(',').filter(Boolean);
    this.crossReplicationEnabled = process.env.REDIS_CROSS_REPLICATION_ENABLED === 'true';
    
    // Cross-instance communication channels
    this.CHANNELS = {
      MESSAGE_SYNC: 'cross_instance:message_sync',
      CACHE_INVALIDATION: 'cross_instance:cache_invalidation',
      HEALTH_CHECK: 'cross_instance:health_check',
      INSTANCE_DISCOVERY: 'cross_instance:instance_discovery'
    };

    // Peer Redis connections
    this.peerConnections = new Map();
    this.subscribers = new Map();
    this.isInitialized = false;
    
    console.log(`[CrossInstanceRedis] Initializing for instance: ${this.instanceId}`);
    console.log(`[CrossInstanceRedis] Peer instances: ${this.peerInstances.join(', ')}`);
  }

  /**
   * Cross-instance Redis 서비스 초기화
   */
  async initialize() {
    if (this.isInitialized) {
      console.log('[CrossInstanceRedis] Already initialized');
      return;
    }

    try {
      if (!this.crossReplicationEnabled) {
        console.log('[CrossInstanceRedis] Cross-replication disabled, skipping initialization');
        return;
      }

      // 현재 인스턴스에서 구독 설정
      await this.setupSubscriptions();
      
      // Peer 인스턴스 연결 설정
      await this.setupPeerConnections();
      
      // Health check 시작
      this.startHealthChecking();
      
      // Instance discovery broadcast
      await this.broadcastInstanceDiscovery();
      
      this.isInitialized = true;
      console.log('[CrossInstanceRedis] Cross-instance Redis service initialized');
      
    } catch (error) {
      console.error('[CrossInstanceRedis] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * 현재 인스턴스에서 cross-instance 이벤트 구독 설정
   */
  async setupSubscriptions() {
    try {
      const subscriber = await redisClient.clusterClient.getReadClient();
      
      // 메시지 동기화 이벤트 구독
      await subscriber.subscribe(this.CHANNELS.MESSAGE_SYNC, (message) => {
        this.handleMessageSync(JSON.parse(message));
      });

      // 캐시 무효화 이벤트 구독
      await subscriber.subscribe(this.CHANNELS.CACHE_INVALIDATION, (message) => {
        this.handleCacheInvalidation(JSON.parse(message));
      });

      // Health check 이벤트 구독
      await subscriber.subscribe(this.CHANNELS.HEALTH_CHECK, (message) => {
        this.handleHealthCheck(JSON.parse(message));
      });

      // Instance discovery 이벤트 구독
      await subscriber.subscribe(this.CHANNELS.INSTANCE_DISCOVERY, (message) => {
        this.handleInstanceDiscovery(JSON.parse(message));
      });

      this.subscribers.set('main', subscriber);
      console.log('[CrossInstanceRedis] Subscriptions setup completed');
      
    } catch (error) {
      console.error('[CrossInstanceRedis] Failed to setup subscriptions:', error);
      throw error;
    }
  }

  /**
   * Peer 인스턴스와의 Redis 연결 설정
   */
  async setupPeerConnections() {
    for (const peerInstance of this.peerInstances) {
      try {
        // 현재 인스턴스는 제외
        if (peerInstance.includes(process.env.REDIS_PORT)) {
          continue;
        }

        const [host, port] = peerInstance.split(':');
        const peerClient = new RedisClusterClient({
          masterHost: host,
          masterPort: parseInt(port),
          slaveHost: host,
          slavePort: parseInt(port) + 10000, // 슬레이브 포트 규칙
          clusterEnabled: false
        });

        await peerClient.initialize();
        this.peerConnections.set(peerInstance, peerClient);
        
        console.log(`[CrossInstanceRedis] Connected to peer instance: ${peerInstance}`);
        
      } catch (error) {
        console.error(`[CrossInstanceRedis] Failed to connect to peer ${peerInstance}:`, error);
        // 연결 실패해도 계속 진행 (다른 인스턴스가 아직 시작되지 않았을 수도 있음)
      }
    }
  }

  /**
   * 메시지 동기화 처리
   */
  async handleMessageSync(event) {
    try {
      if (event.sourceInstance === this.instanceId) {
        return; // 자신이 보낸 이벤트는 무시
      }

      console.log(`[CrossInstanceRedis] Handling message sync from ${event.sourceInstance}:`, event.operation);

      switch (event.operation) {
        case 'CREATE_MESSAGE':
          await this.syncCreateMessage(event.data);
          break;
        case 'UPDATE_MESSAGE':
          await this.syncUpdateMessage(event.data);
          break;
        case 'DELETE_MESSAGE':
          await this.syncDeleteMessage(event.data);
          break;
        case 'ADD_REACTION':
          await this.syncAddReaction(event.data);
          break;
        default:
          console.warn(`[CrossInstanceRedis] Unknown sync operation: ${event.operation}`);
      }
      
    } catch (error) {
      console.error('[CrossInstanceRedis] Error handling message sync:', error);
    }
  }

  /**
   * 캐시 무효화 처리
   */
  async handleCacheInvalidation(event) {
    try {
      if (event.sourceInstance === this.instanceId) {
        return;
      }

      console.log(`[CrossInstanceRedis] Handling cache invalidation from ${event.sourceInstance}:`, event.keys);

      for (const key of event.keys) {
        await redisClient.del(key);
      }
      
    } catch (error) {
      console.error('[CrossInstanceRedis] Error handling cache invalidation:', error);
    }
  }

  /**
   * Health check 처리
   */
  async handleHealthCheck(event) {
    if (event.sourceInstance === this.instanceId) {
      return;
    }

    // Health check 응답
    await this.publishHealthResponse(event.sourceInstance);
  }

  /**
   * Instance discovery 처리
   */
  async handleInstanceDiscovery(event) {
    if (event.sourceInstance === this.instanceId) {
      return;
    }

    console.log(`[CrossInstanceRedis] Discovered instance: ${event.sourceInstance}`);
    
    // 새로운 인스턴스와 연결 시도
    if (!this.peerConnections.has(event.instanceEndpoint)) {
      await this.connectToPeerInstance(event.instanceEndpoint);
    }
  }

  /**
   * Cross-instance 메시지 동기화 브로드캐스트
   */
  async broadcastMessageSync(operation, messageData) {
    try {
      if (!this.crossReplicationEnabled) return;

      const event = {
        sourceInstance: this.instanceId,
        operation,
        data: messageData,
        timestamp: new Date().toISOString()
      };

      await redisClient.publish(this.CHANNELS.MESSAGE_SYNC, JSON.stringify(event));
      console.log(`[CrossInstanceRedis] Broadcasted ${operation} for message: ${messageData._id}`);
      
    } catch (error) {
      console.error('[CrossInstanceRedis] Failed to broadcast message sync:', error);
    }
  }

  /**
   * Cross-instance 캐시 무효화 브로드캐스트
   */
  async broadcastCacheInvalidation(keys) {
    try {
      if (!this.crossReplicationEnabled) return;

      const event = {
        sourceInstance: this.instanceId,
        keys: Array.isArray(keys) ? keys : [keys],
        timestamp: new Date().toISOString()
      };

      await redisClient.publish(this.CHANNELS.CACHE_INVALIDATION, JSON.stringify(event));
      console.log(`[CrossInstanceRedis] Broadcasted cache invalidation for keys:`, event.keys);
      
    } catch (error) {
      console.error('[CrossInstanceRedis] Failed to broadcast cache invalidation:', error);
    }
  }

  /**
   * 메시지 생성 동기화
   */
  async syncCreateMessage(messageData) {
    try {
      // 로컬 Redis에 메시지 캐시 (덮어쓰기 방지를 위해 NX 옵션 사용)
      const cacheKey = `message:${messageData._id}`;
      const exists = await redisClient.exists(cacheKey);
      
      if (!exists) {
        await redisClient.jsonSet(cacheKey, '$', messageData);
        console.log(`[CrossInstanceRedis] Synced message creation: ${messageData._id}`);
      }
      
    } catch (error) {
      console.error('[CrossInstanceRedis] Error syncing message creation:', error);
    }
  }

  /**
   * 메시지 업데이트 동기화
   */
  async syncUpdateMessage(updateData) {
    try {
      const cacheKey = `message:${updateData._id}`;
      
      // 기존 메시지가 있는 경우에만 업데이트
      const exists = await redisClient.exists(cacheKey);
      if (exists) {
        await redisClient.jsonSet(cacheKey, '$', updateData);
        console.log(`[CrossInstanceRedis] Synced message update: ${updateData._id}`);
      }
      
    } catch (error) {
      console.error('[CrossInstanceRedis] Error syncing message update:', error);
    }
  }

  /**
   * Health check 시작
   */
  startHealthChecking() {
    const interval = parseInt(process.env.HEALTH_CHECK_INTERVAL) || 10000;
    
    setInterval(async () => {
      try {
        const event = {
          sourceInstance: this.instanceId,
          timestamp: new Date().toISOString(),
          type: 'HEALTH_CHECK'
        };

        await redisClient.publish(this.CHANNELS.HEALTH_CHECK, JSON.stringify(event));
      } catch (error) {
        console.error('[CrossInstanceRedis] Health check failed:', error);
      }
    }, interval);
  }

  /**
   * Instance discovery broadcast
   */
  async broadcastInstanceDiscovery() {
    try {
      const event = {
        sourceInstance: this.instanceId,
        instanceEndpoint: `localhost:${process.env.REDIS_PORT}`,
        serverPort: process.env.PORT,
        timestamp: new Date().toISOString()
      };

      await redisClient.publish(this.CHANNELS.INSTANCE_DISCOVERY, JSON.stringify(event));
      console.log('[CrossInstanceRedis] Broadcasted instance discovery');
      
    } catch (error) {
      console.error('[CrossInstanceRedis] Failed to broadcast instance discovery:', error);
    }
  }

  /**
   * 서비스 상태 조회
   */
  getStatus() {
    return {
      instanceId: this.instanceId,
      crossReplicationEnabled: this.crossReplicationEnabled,
      peerInstances: this.peerInstances,
      connectedPeers: Array.from(this.peerConnections.keys()),
      isInitialized: this.isInitialized,
      subscriptions: Array.from(this.subscribers.keys())
    };
  }

  /**
   * 서비스 종료
   */
  async shutdown() {
    try {
      console.log('[CrossInstanceRedis] Shutting down cross-instance Redis service');
      
      // 구독 해제
      for (const [key, subscriber] of this.subscribers) {
        await subscriber.unsubscribe();
        await subscriber.quit();
      }
      this.subscribers.clear();

      // Peer 연결 종료
      for (const [key, peerClient] of this.peerConnections) {
        await peerClient.shutdown();
      }
      this.peerConnections.clear();

      this.isInitialized = false;
      console.log('[CrossInstanceRedis] Cross-instance Redis service shut down');
      
    } catch (error) {
      console.error('[CrossInstanceRedis] Error during shutdown:', error);
    }
  }
}

module.exports = new CrossInstanceRedisService();