// backend/services/mongoReplicationService.js
const mongoose = require('mongoose');
const Message = require('../models/Message');
const User = require('../models/User');
const Room = require('../models/Room');

/**
 * MongoDB 인스턴스 간 데이터 복제 서비스
 * Cross-instance 환경에서 MongoDB 데이터 일관성 보장
 */
class MongoReplicationService {
  constructor() {
    this.instanceId = process.env.INSTANCE_ID || 'instance-1';
    this.peerInstances = (process.env.PEER_INSTANCES || '').split(',').filter(Boolean);
    this.replicationEnabled = process.env.MONGO_REPLICATION_ENABLED === 'true';
    
    // 복제 상태 추적
    this.replicationStats = {
      lastSyncTime: null,
      syncedDocuments: 0,
      failedSyncs: 0,
      conflictResolutions: 0
    };

    // 연결된 peer MongoDB 인스턴스들
    this.peerConnections = new Map();
    
    console.log(`[MongoReplication] Initializing for instance: ${this.instanceId}`);
  }

  /**
   * MongoDB 복제 서비스 초기화
   */
  async initialize() {
    try {
      if (!this.replicationEnabled) {
        console.log('[MongoReplication] Replication disabled, skipping initialization');
        return;
      }

      // Peer MongoDB 인스턴스 연결 설정
      await this.setupPeerConnections();
      
      // Change Stream 모니터링 시작
      await this.setupChangeStreams();
      
      // 초기 데이터 동기화
      await this.performInitialSync();
      
      console.log('[MongoReplication] MongoDB replication service initialized');
      
    } catch (error) {
      console.error('[MongoReplication] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Peer MongoDB 인스턴스 연결 설정
   */
  async setupPeerConnections() {
    for (const peerInstance of this.peerInstances) {
      try {
        // HTTP URL에서 MongoDB URI 생성
        const peerUrl = new URL(peerInstance);
        const mongoPort = this.getMongoPortFromHttpPort(peerUrl.port);
        const mongoUri = `mongodb://${peerUrl.hostname}:${mongoPort}/bootcampchat-${this.getInstanceIdFromUrl(peerInstance)}`;
        
        const peerConnection = await mongoose.createConnection(mongoUri, {
          useNewUrlParser: true,
          useUnifiedTopology: true,
          serverSelectionTimeoutMS: 5000
        });

        this.peerConnections.set(peerInstance, peerConnection);
        console.log(`[MongoReplication] Connected to peer MongoDB: ${mongoUri}`);
        
      } catch (error) {
        console.error(`[MongoReplication] Failed to connect to peer ${peerInstance}:`, error);
      }
    }
  }

  /**
   * HTTP 포트에서 MongoDB 포트 매핑
   */
  getMongoPortFromHttpPort(httpPort) {
    const portMapping = {
      '5001': '27017',
      '5002': '27018',
      '5003': '27019'
    };
    return portMapping[httpPort] || '27017';
  }

  /**
   * URL에서 인스턴스 ID 추출
   */
  getInstanceIdFromUrl(url) {
    const urlObj = new URL(url);
    return urlObj.port === '5001' ? 'instance1' : 
           urlObj.port === '5002' ? 'instance2' : 'instance1';
  }

  /**
   * Change Streams 모니터링 설정
   */
  async setupChangeStreams() {
    try {
      // Messages 컬렉션 변경 모니터링
      const messageChangeStream = Message.watch([
        { $match: { 
          'fullDocument.instanceId': { $ne: this.instanceId },
          operationType: { $in: ['insert', 'update', 'replace', 'delete'] }
        }}
      ], { fullDocument: 'updateLookup' });

      messageChangeStream.on('change', (change) => {
        this.handleMessageChange(change);
      });

      // Users 컬렉션 변경 모니터링
      const userChangeStream = User.watch([
        { $match: { 
          'fullDocument.instanceId': { $ne: this.instanceId },
          operationType: { $in: ['insert', 'update', 'replace'] }
        }}
      ], { fullDocument: 'updateLookup' });

      userChangeStream.on('change', (change) => {
        this.handleUserChange(change);
      });

      // Rooms 컬렉션 변경 모니터링
      const roomChangeStream = Room.watch([
        { $match: { 
          'fullDocument.instanceId': { $ne: this.instanceId },
          operationType: { $in: ['insert', 'update', 'replace'] }
        }}
      ], { fullDocument: 'updateLookup' });

      roomChangeStream.on('change', (change) => {
        this.handleRoomChange(change);
      });

      console.log('[MongoReplication] Change streams setup completed');
      
    } catch (error) {
      console.error('[MongoReplication] Failed to setup change streams:', error);
    }
  }

  /**
   * 메시지 변경 처리
   */
  async handleMessageChange(change) {
    try {
      console.log(`[MongoReplication] Message change detected:`, change.operationType);

      switch (change.operationType) {
        case 'insert':
          await this.replicateMessageToAllPeers(change.fullDocument);
          break;
        case 'update':
        case 'replace':
          await this.updateMessageInAllPeers(change.fullDocument);
          break;
        case 'delete':
          await this.deleteMessageFromAllPeers(change.documentKey._id);
          break;
      }

      this.replicationStats.syncedDocuments++;
      
    } catch (error) {
      console.error('[MongoReplication] Error handling message change:', error);
      this.replicationStats.failedSyncs++;
    }
  }

  /**
   * 사용자 변경 처리
   */
  async handleUserChange(change) {
    try {
      console.log(`[MongoReplication] User change detected:`, change.operationType);

      if (change.operationType === 'insert') {
        await this.replicateUserToAllPeers(change.fullDocument);
      } else {
        await this.updateUserInAllPeers(change.fullDocument);
      }

      this.replicationStats.syncedDocuments++;
      
    } catch (error) {
      console.error('[MongoReplication] Error handling user change:', error);
      this.replicationStats.failedSyncs++;
    }
  }

  /**
   * 방 변경 처리
   */
  async handleRoomChange(change) {
    try {
      console.log(`[MongoReplication] Room change detected:`, change.operationType);

      if (change.operationType === 'insert') {
        await this.replicateRoomToAllPeers(change.fullDocument);
      } else {
        await this.updateRoomInAllPeers(change.fullDocument);
      }

      this.replicationStats.syncedDocuments++;
      
    } catch (error) {
      console.error('[MongoReplication] Error handling room change:', error);
      this.replicationStats.failedSyncs++;
    }
  }

  /**
   * 메시지를 모든 Peer 인스턴스에 복제
   */
  async replicateMessageToAllPeers(messageData) {
    const replicationPromises = [];

    for (const [peerInstance, peerConnection] of this.peerConnections) {
      replicationPromises.push(
        this.replicateMessageToPeer(peerConnection, messageData, peerInstance)
      );
    }

    await Promise.allSettled(replicationPromises);
  }

  /**
   * 특정 Peer 인스턴스에 메시지 복제
   */
  async replicateMessageToPeer(peerConnection, messageData, peerInstance) {
    try {
      const PeerMessage = peerConnection.model('Message', Message.schema);
      
      // 중복 방지를 위해 upsert 사용
      const filter = { _id: messageData._id };
      const update = {
        ...messageData,
        instanceId: this.instanceId,
        replicatedFrom: this.instanceId,
        replicatedAt: new Date()
      };

      await PeerMessage.findOneAndUpdate(filter, update, { 
        upsert: true, 
        new: true 
      });

      console.log(`[MongoReplication] Message replicated to ${peerInstance}: ${messageData._id}`);
      
    } catch (error) {
      console.error(`[MongoReplication] Failed to replicate message to ${peerInstance}:`, error);
      throw error;
    }
  }

  /**
   * 메시지를 모든 Peer 인스턴스에서 업데이트
   */
  async updateMessageInAllPeers(messageData) {
    const updatePromises = [];

    for (const [peerInstance, peerConnection] of this.peerConnections) {
      updatePromises.push(
        this.updateMessageInPeer(peerConnection, messageData, peerInstance)
      );
    }

    await Promise.allSettled(updatePromises);
  }

  /**
   * 특정 Peer 인스턴스에서 메시지 업데이트
   */
  async updateMessageInPeer(peerConnection, messageData, peerInstance) {
    try {
      const PeerMessage = peerConnection.model('Message', Message.schema);
      
      const filter = { _id: messageData._id };
      const update = {
        ...messageData,
        lastModifiedBy: this.instanceId,
        lastModifiedAt: new Date()
      };

      const result = await PeerMessage.findOneAndUpdate(filter, update, { new: true });
      
      if (result) {
        console.log(`[MongoReplication] Message updated in ${peerInstance}: ${messageData._id}`);
      }
      
    } catch (error) {
      console.error(`[MongoReplication] Failed to update message in ${peerInstance}:`, error);
      throw error;
    }
  }

  /**
   * 초기 데이터 동기화
   */
  async performInitialSync() {
    try {
      console.log('[MongoReplication] Starting initial data synchronization...');

      // 최근 24시간 메시지만 동기화 (너무 많은 데이터 방지)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentMessages = await Message.find({
        createdAt: { $gte: oneDayAgo },
        instanceId: { $ne: this.instanceId }
      }).populate('sender', 'name email profileImage');

      console.log(`[MongoReplication] Found ${recentMessages.length} recent messages to sync`);

      for (const message of recentMessages) {
        await this.replicateMessageToAllPeers(message.toObject());
      }

      this.replicationStats.lastSyncTime = new Date();
      console.log('[MongoReplication] Initial data synchronization completed');
      
    } catch (error) {
      console.error('[MongoReplication] Initial sync failed:', error);
    }
  }

  /**
   * Conflict Resolution - Last Write Wins 전략
   */
  async resolveConflict(localDoc, remoteDoc, collection) {
    try {
      console.log(`[MongoReplication] Resolving conflict for ${collection}:`, localDoc._id);

      // Last-Write-Wins: 더 최근에 수정된 문서가 우선
      const localTime = new Date(localDoc.updatedAt || localDoc.createdAt);
      const remoteTime = new Date(remoteDoc.updatedAt || remoteDoc.createdAt);

      if (remoteTime > localTime) {
        // Remote 문서가 더 최신이므로 local 문서를 업데이트
        await this.updateLocalDocument(collection, remoteDoc);
        console.log(`[MongoReplication] Conflict resolved: Remote document wins`);
      } else {
        // Local 문서가 더 최신이므로 remote에 전파
        await this.replicateToAllPeers(collection, localDoc);
        console.log(`[MongoReplication] Conflict resolved: Local document wins`);
      }

      this.replicationStats.conflictResolutions++;
      
    } catch (error) {
      console.error('[MongoReplication] Conflict resolution failed:', error);
    }
  }

  /**
   * 복제 상태 조회
   */
  getReplicationStatus() {
    return {
      instanceId: this.instanceId,
      replicationEnabled: this.replicationEnabled,
      peerInstances: this.peerInstances,
      connectedPeers: Array.from(this.peerConnections.keys()),
      stats: {
        ...this.replicationStats,
        uptime: process.uptime()
      }
    };
  }

  /**
   * 서비스 종료
   */
  async shutdown() {
    try {
      console.log('[MongoReplication] Shutting down MongoDB replication service');
      
      // Peer 연결 종료
      for (const [key, peerConnection] of this.peerConnections) {
        await peerConnection.close();
      }
      this.peerConnections.clear();

      console.log('[MongoReplication] MongoDB replication service shut down');
      
    } catch (error) {
      console.error('[MongoReplication] Error during shutdown:', error);
    }
  }
}

module.exports = new MongoReplicationService();