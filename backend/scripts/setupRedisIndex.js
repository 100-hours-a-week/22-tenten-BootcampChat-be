// backend/scripts/setupRedisIndex.js
const redisClient = require('../utils/redisClient');

/**
 * Redis Search 인덱스 설정
 * 채팅방 데이터를 위한 검색 인덱스를 생성합니다.
 */

const CHAT_ROOMS_INDEX = 'idx_chat_rooms';
const CHAT_MESSAGES_INDEX = 'idx_chat_messages';

/**
 * 채팅방 인덱스 스키마 정의
 * 사용자가 제시한 전략에 따른 RedisSearch 인덱스 구조
 */
const CHAT_ROOMS_SCHEMA = [
  'ON', 'JSON',
  'PREFIX', '1', 'chat_room:',
  'SCHEMA',
  '$._id', 'AS', '_id', 'TAG',
  '$.name', 'AS', 'name', 'TEXT', 'WEIGHT', '1.0',
  '$.password', 'AS', 'password', 'TEXT', 'NOINDEX',  // 비밀번호는 검색/정렬에 사용하지 않음
  '$.hasPassword', 'AS', 'hasPassword', 'TAG',
  '$.creator._id', 'AS', 'creator_id', 'TAG',
  '$.creator.name', 'AS', 'creator_name', 'TEXT',
  '$.participants[*]._id', 'AS', 'participant_ids', 'TAG',
  '$.participantsCount', 'AS', 'participantsCount', 'NUMERIC', 'SORTABLE',
  '$.createdAt', 'AS', 'createdAt', 'NUMERIC', 'SORTABLE'  // ISO string을 timestamp로 변환하여 저장
];

/**
 * 채팅 메시지 인덱스 스키마 정의
 * Write-Back 전략에 따른 RedisSearch 인덱스 구조
 */
const CHAT_MESSAGES_SCHEMA = [
  'ON', 'JSON',
  'PREFIX', '1', 'message:',
  'SCHEMA',
  '$._id', 'AS', '_id', 'TAG',
  '$.room', 'AS', 'room', 'TAG',  // 채팅방 ID로 메시지 필터링
  '$.content', 'AS', 'content', 'TEXT', 'WEIGHT', '1.0',  // 메시지 내용 검색
  '$.sender._id', 'AS', 'sender_id', 'TAG',  // 발신자 ID로 메시지 필터링
  '$.sender.name', 'AS', 'sender_name', 'TEXT',  // 발신자 이름으로 검색
  '$.type', 'AS', 'type', 'TAG',  // 메시지 타입으로 필터링 ('text', 'system', 'ai', 'file')
  '$.file._id', 'AS', 'file_id', 'TAG',  // 파일 ID로 메시지 필터링
  '$.aiType', 'AS', 'aiType', 'TAG',  // AI 타입으로 필터링 ('wayneAI', 'consultingAI')
  '$.timestamp', 'AS', 'timestamp', 'NUMERIC', 'SORTABLE',  // 시간순 정렬
  '$.readers[*].userId', 'AS', 'reader_ids', 'TAG',  // 읽은 사용자 ID로 필터링
  '$.isDeleted', 'AS', 'isDeleted', 'TAG'  // 삭제 여부로 필터링
];

/**
 * 채팅 메시지 인덱스 생성
 */
async function createChatMessagesIndex() {
  try {
    console.log('Creating RedisSearch index for chat messages...');
    
    // 기존 인덱스 확인
    try {
      const indexInfo = await redisClient.ftInfo(CHAT_MESSAGES_INDEX);
      if (indexInfo && indexInfo.length > 0) {
        console.log(`Index ${CHAT_MESSAGES_INDEX} already exists, recreating...`);
        await redisClient.ftDropIndex(CHAT_MESSAGES_INDEX);
      }
    } catch (error) {
      // 인덱스가 존재하지 않는 경우 무시
      if (!error.message.includes('Unknown index name')) {
        console.warn('Error checking existing index:', error.message);
      }
    }

    // 새 인덱스 생성
    const result = await redisClient.ftCreate(CHAT_MESSAGES_INDEX, CHAT_MESSAGES_SCHEMA);
    console.log(`✅ RedisSearch index '${CHAT_MESSAGES_INDEX}' created successfully:`, result);
    
    return result;
  } catch (error) {
    console.error(`❌ Failed to create RedisSearch index '${CHAT_MESSAGES_INDEX}':`, error);
    throw error;
  }
}

/**
 * 채팅방 인덱스 생성
 */
async function createChatRoomsIndex() {
  try {
    console.log('Creating RedisSearch index for chat rooms...');
    
    // 기존 인덱스 확인
    try {
      const indexInfo = await redisClient.ftInfo(CHAT_ROOMS_INDEX);
      if (indexInfo && indexInfo.length > 0) {
        console.log(`Index ${CHAT_ROOMS_INDEX} already exists, recreating...`);
        await redisClient.ftDropIndex(CHAT_ROOMS_INDEX);
      }
    } catch (error) {
      // 인덱스가 존재하지 않는 경우 무시
      if (!error.message.includes('Unknown index name')) {
        console.warn('Error checking existing index:', error.message);
      }
    }

    // 새 인덱스 생성
    const result = await redisClient.ftCreate(CHAT_ROOMS_INDEX, CHAT_ROOMS_SCHEMA);
    console.log(`✅ RedisSearch index '${CHAT_ROOMS_INDEX}' created successfully:`, result);
    
    return result;
  } catch (error) {
    console.error(`❌ Failed to create RedisSearch index '${CHAT_ROOMS_INDEX}':`, error);
    throw error;
  }
}

/**
 * 메시지 인덱스 정보 조회
 */
async function getChatMessagesIndexInfo() {
  try {
    const indexInfo = await redisClient.ftInfo(CHAT_MESSAGES_INDEX);
    console.log(`📋 Index '${CHAT_MESSAGES_INDEX}' information:`, indexInfo);
    return indexInfo;
  } catch (error) {
    console.error(`❌ Failed to get index info for '${CHAT_MESSAGES_INDEX}':`, error);
    return null;
  }
}

/**
 * 채팅방 인덱스 정보 조회
 */
async function getChatRoomsIndexInfo() {
  try {
    const indexInfo = await redisClient.ftInfo(CHAT_ROOMS_INDEX);
    console.log(`📋 Index '${CHAT_ROOMS_INDEX}' information:`, indexInfo);
    return indexInfo;
  } catch (error) {
    console.error(`❌ Failed to get index info for '${CHAT_ROOMS_INDEX}':`, error);
    return null;
  }
}

/**
 * 메시지 인덱스 삭제
 */
async function dropChatMessagesIndex() {
  try {
    await redisClient.ftDropIndex(CHAT_MESSAGES_INDEX);
    console.log(`🗑️  Index '${CHAT_MESSAGES_INDEX}' dropped successfully`);
  } catch (error) {
    console.error(`❌ Failed to drop index '${CHAT_MESSAGES_INDEX}':`, error);
    throw error;
  }
}

/**
 * 채팅방 인덱스 삭제
 */
async function dropChatRoomsIndex() {
  try {
    await redisClient.ftDropIndex(CHAT_ROOMS_INDEX);
    console.log(`🗑️  Index '${CHAT_ROOMS_INDEX}' dropped successfully`);
  } catch (error) {
    console.error(`❌ Failed to drop index '${CHAT_ROOMS_INDEX}':`, error);
    throw error;
  }
}

/**
 * 모든 인덱스 설정 실행
 */
async function setupAllIndexes() {
  console.log('🚀 Starting RedisSearch index setup...\n');
  
  try {
    // Redis 연결 확인
    await redisClient.connect();
    console.log('✅ Redis connection established\n');

    // 채팅방 인덱스 생성
    await createChatRoomsIndex();
    
    // 채팅 메시지 인덱스 생성
    await createChatMessagesIndex();
    
    console.log('\n📊 Index setup completed successfully!');
    
    // 인덱스 정보 출력
    await getChatRoomsIndexInfo();
    await getChatMessagesIndexInfo();
    
  } catch (error) {
    console.error('❌ Index setup failed:', error);
    process.exit(1);
  }
}

/**
 * 스크립트 직접 실행 시
 */
if (require.main === module) {
  setupAllIndexes()
    .then(() => {
      console.log('\n✨ RedisSearch index setup completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Setup failed:', error);
      process.exit(1);
    });
}

module.exports = {
  setupAllIndexes,
  createChatRoomsIndex,
  createChatMessagesIndex,
  getChatRoomsIndexInfo,
  getChatMessagesIndexInfo,
  dropChatRoomsIndex,
  dropChatMessagesIndex,
  CHAT_ROOMS_INDEX,
  CHAT_MESSAGES_INDEX,
  CHAT_ROOMS_SCHEMA,
  CHAT_MESSAGES_SCHEMA
};