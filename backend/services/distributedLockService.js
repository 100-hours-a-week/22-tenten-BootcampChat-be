// backend/services/distributedLockService.js
const redisClient = require('../utils/redisClient');

/**
 * 분산 락 서비스
 * 여러 인스턴스 간 동시성 제어 및 데이터 일관성 보장
 */
class DistributedLockService {
  constructor() {
    this.instanceId = process.env.INSTANCE_ID || 'instance-1';
    this.lockPrefix = 'distributed_lock:';
    this.defaultTTL = 30000; // 30초 기본 TTL
    this.retryDelay = 100; // 100ms 재시도 간격
    this.maxRetries = 50; // 최대 50회 재시도 (5초)
    
    // 현재 인스턴스가 보유한 락들
    this.activeLocks = new Map();
    
    console.log(`[DistributedLock] Service initialized for instance: ${this.instanceId}`);
  }

  /**
   * 분산 락 획득
   * @param {string} resource - 락을 걸 리소스 식별자
   * @param {number} ttl - 락 유지 시간 (밀리초)
   * @param {number} maxRetries - 최대 재시도 횟수
   * @returns {Promise<boolean>} - 락 획득 성공 여부
   */
  async acquireLock(resource, ttl = this.defaultTTL, maxRetries = this.maxRetries) {
    const lockKey = this.getLockKey(resource);
    const lockValue = this.generateLockValue();
    let retries = 0;

    while (retries < maxRetries) {
      try {
        // Redis SET NX EX 명령어로 원자적 락 획득
        const result = await redisClient.set(lockKey, lockValue, 'PX', ttl, 'NX');
        
        if (result === 'OK') {
          // 락 획득 성공
          this.activeLocks.set(lockKey, {
            value: lockValue,
            resource,
            acquiredAt: Date.now(),
            ttl,
            autoRenew: false
          });

          console.log(`[DistributedLock] Lock acquired: ${resource} (${lockKey})`);
          return true;
        }

        // 락을 획득할 수 없으면 재시도
        retries++;
        if (retries < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
        
      } catch (error) {
        console.error(`[DistributedLock] Error acquiring lock for ${resource}:`, error);
        return false;
      }
    }

    console.log(`[DistributedLock] Failed to acquire lock after ${maxRetries} retries: ${resource}`);
    return false;
  }

  /**
   * 분산 락 해제
   * @param {string} resource - 락을 해제할 리소스 식별자
   * @returns {Promise<boolean>} - 락 해제 성공 여부
   */
  async releaseLock(resource) {
    const lockKey = this.getLockKey(resource);
    const lockInfo = this.activeLocks.get(lockKey);

    if (!lockInfo) {
      console.warn(`[DistributedLock] No active lock found for resource: ${resource}`);
      return false;
    }

    try {
      // Lua 스크립트로 원자적 락 해제 (다른 인스턴스의 락을 실수로 해제하는 것 방지)
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;

      const result = await redisClient.eval(luaScript, 1, lockKey, lockInfo.value);
      
      if (result === 1) {
        this.activeLocks.delete(lockKey);
        console.log(`[DistributedLock] Lock released: ${resource} (${lockKey})`);
        return true;
      } else {
        console.warn(`[DistributedLock] Lock was not owned by this instance: ${resource}`);
        return false;
      }
      
    } catch (error) {
      console.error(`[DistributedLock] Error releasing lock for ${resource}:`, error);
      return false;
    }
  }

  /**
   * 락 갱신 (TTL 연장)
   * @param {string} resource - 갱신할 리소스 식별자
   * @param {number} ttl - 새로운 TTL (밀리초)
   * @returns {Promise<boolean>} - 갱신 성공 여부
   */
  async renewLock(resource, ttl = this.defaultTTL) {
    const lockKey = this.getLockKey(resource);
    const lockInfo = this.activeLocks.get(lockKey);

    if (!lockInfo) {
      console.warn(`[DistributedLock] No active lock found for renewal: ${resource}`);
      return false;
    }

    try {
      // Lua 스크립트로 원자적 TTL 갱신
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("pexpire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;

      const result = await redisClient.eval(luaScript, 1, lockKey, lockInfo.value, ttl);
      
      if (result === 1) {
        lockInfo.ttl = ttl;
        console.log(`[DistributedLock] Lock renewed: ${resource} (TTL: ${ttl}ms)`);
        return true;
      } else {
        console.warn(`[DistributedLock] Lock renewal failed - not owned by this instance: ${resource}`);
        return false;
      }
      
    } catch (error) {
      console.error(`[DistributedLock] Error renewing lock for ${resource}:`, error);
      return false;
    }
  }

  /**
   * 자동 갱신 활성화
   * @param {string} resource - 자동 갱신할 리소스 식별자
   * @param {number} renewInterval - 갱신 간격 (밀리초)
   */
  async enableAutoRenewal(resource, renewInterval = 10000) {
    const lockKey = this.getLockKey(resource);
    const lockInfo = this.activeLocks.get(lockKey);

    if (!lockInfo) {
      console.warn(`[DistributedLock] No active lock found for auto-renewal: ${resource}`);
      return false;
    }

    if (lockInfo.autoRenew) {
      console.log(`[DistributedLock] Auto-renewal already enabled for: ${resource}`);
      return true;
    }

    lockInfo.autoRenew = true;
    lockInfo.renewalInterval = setInterval(async () => {
      const success = await this.renewLock(resource, lockInfo.ttl);
      if (!success) {
        // 갱신 실패 시 자동 갱신 중지
        this.disableAutoRenewal(resource);
      }
    }, renewInterval);

    console.log(`[DistributedLock] Auto-renewal enabled for: ${resource} (interval: ${renewInterval}ms)`);
    return true;
  }

  /**
   * 자동 갱신 비활성화
   * @param {string} resource - 자동 갱신을 중지할 리소스 식별자
   */
  disableAutoRenewal(resource) {
    const lockKey = this.getLockKey(resource);
    const lockInfo = this.activeLocks.get(lockKey);

    if (lockInfo && lockInfo.autoRenew && lockInfo.renewalInterval) {
      clearInterval(lockInfo.renewalInterval);
      lockInfo.autoRenew = false;
      delete lockInfo.renewalInterval;
      console.log(`[DistributedLock] Auto-renewal disabled for: ${resource}`);
    }
  }

  /**
   * 락 소유 여부 확인
   * @param {string} resource - 확인할 리소스 식별자
   * @returns {Promise<boolean>} - 락 소유 여부
   */
  async isLockOwner(resource) {
    const lockKey = this.getLockKey(resource);
    const lockInfo = this.activeLocks.get(lockKey);

    if (!lockInfo) {
      return false;
    }

    try {
      const currentValue = await redisClient.get(lockKey);
      return currentValue === lockInfo.value;
    } catch (error) {
      console.error(`[DistributedLock] Error checking lock ownership for ${resource}:`, error);
      return false;
    }
  }

  /**
   * 락 상태 조회
   * @param {string} resource - 조회할 리소스 식별자
   * @returns {Promise<Object|null>} - 락 상태 정보
   */
  async getLockStatus(resource) {
    const lockKey = this.getLockKey(resource);
    
    try {
      const lockValue = await redisClient.get(lockKey);
      const ttl = await redisClient.pttl(lockKey);
      
      if (!lockValue) {
        return null; // 락이 존재하지 않음
      }

      const isOwner = this.activeLocks.has(lockKey);
      
      return {
        resource,
        lockKey,
        value: lockValue,
        ttl: ttl > 0 ? ttl : -1,
        isOwner,
        ownerInstance: isOwner ? this.instanceId : 'unknown'
      };
      
    } catch (error) {
      console.error(`[DistributedLock] Error getting lock status for ${resource}:`, error);
      return null;
    }
  }

  /**
   * 모든 활성 락 정보 조회
   * @returns {Array} - 활성 락 목록
   */
  getActiveLocks() {
    const locks = [];
    
    for (const [lockKey, lockInfo] of this.activeLocks) {
      locks.push({
        lockKey,
        resource: lockInfo.resource,
        acquiredAt: lockInfo.acquiredAt,
        ttl: lockInfo.ttl,
        autoRenew: lockInfo.autoRenew,
        age: Date.now() - lockInfo.acquiredAt
      });
    }
    
    return locks;
  }

  /**
   * 만료된 락 정리
   */
  async cleanupExpiredLocks() {
    const expiredLocks = [];
    
    for (const [lockKey, lockInfo] of this.activeLocks) {
      try {
        const exists = await redisClient.exists(lockKey);
        if (!exists) {
          // Redis에서 락이 만료됨
          expiredLocks.push(lockKey);
        }
      } catch (error) {
        console.error(`[DistributedLock] Error checking lock existence: ${lockKey}`, error);
      }
    }

    // 만료된 락들을 로컬 캐시에서 제거
    for (const lockKey of expiredLocks) {
      const lockInfo = this.activeLocks.get(lockKey);
      this.disableAutoRenewal(lockInfo.resource);
      this.activeLocks.delete(lockKey);
      console.log(`[DistributedLock] Cleaned up expired lock: ${lockInfo.resource}`);
    }

    return expiredLocks.length;
  }

  /**
   * 락 키 생성
   * @param {string} resource - 리소스 식별자
   * @returns {string} - Redis 락 키
   */
  getLockKey(resource) {
    return `${this.lockPrefix}${resource}`;
  }

  /**
   * 고유한 락 값 생성
   * @returns {string} - 락 값
   */
  generateLockValue() {
    return `${this.instanceId}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 정기적 정리 작업 시작
   */
  startPeriodicCleanup(interval = 60000) {
    setInterval(async () => {
      const cleanedCount = await this.cleanupExpiredLocks();
      if (cleanedCount > 0) {
        console.log(`[DistributedLock] Periodic cleanup: removed ${cleanedCount} expired locks`);
      }
    }, interval);
    
    console.log(`[DistributedLock] Periodic cleanup started (interval: ${interval}ms)`);
  }

  /**
   * 서비스 종료 시 모든 락 해제
   */
  async shutdown() {
    console.log('[DistributedLock] Releasing all locks before shutdown...');
    
    const resources = Array.from(this.activeLocks.values()).map(lock => lock.resource);
    
    for (const resource of resources) {
      await this.releaseLock(resource);
    }
    
    console.log(`[DistributedLock] Released ${resources.length} locks during shutdown`);
  }
}

module.exports = new DistributedLockService();