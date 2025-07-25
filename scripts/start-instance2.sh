#!/bin/bash

# Instance 2 시작 스크립트
echo "🚀 Starting BootcampChat Instance 2"
echo "=================================="

# 현재 디렉터리 설정
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_ROOT/backend"

# 색상 코드
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}📍 Project Root: $PROJECT_ROOT${NC}"
echo -e "${BLUE}📍 Backend Dir: $BACKEND_DIR${NC}"
echo ""

# 1. 환경 변수 확인
echo -e "${YELLOW}🔍 Checking environment configuration...${NC}"
if [ ! -f "$BACKEND_DIR/.env.instance2" ]; then
    echo -e "${RED}❌ .env.instance2 file not found${NC}"
    echo "Please create .env.instance2 configuration file first"
    exit 1
fi
echo -e "${GREEN}✅ Environment configuration found${NC}"

# 2. Redis Instance 2 시작 (포트 6380, 16380)
echo -e "${YELLOW}🔧 Starting Redis Instance 2...${NC}"

echo "Starting Redis Master on port 6380..."
redis-server --port 6380 --dir /tmp/redis-instance2-master --logfile /tmp/redis-instance2-master.log --daemonize yes --loadmodule /opt/homebrew/lib/redis/modules/rejson.so --loadmodule /opt/homebrew/lib/redis/modules/redisearch.so

echo "Starting Redis Slave on port 16380..."
redis-server --port 16380 --dir /tmp/redis-instance2-slave --logfile /tmp/redis-instance2-slave.log --daemonize yes --slaveof localhost 6380 --loadmodule /opt/homebrew/lib/redis/modules/rejson.so --loadmodule /opt/homebrew/lib/redis/modules/redisearch.so

# Redis 시작 대기
sleep 3

# Redis 연결 확인
if redis-cli -p 6380 ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis Master (6380) started successfully${NC}"
else
    echo -e "${RED}❌ Failed to start Redis Master${NC}"
    exit 1
fi

if redis-cli -p 16380 ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis Slave (16380) started successfully${NC}"
else
    echo -e "${RED}❌ Failed to start Redis Slave${NC}"
    exit 1
fi

# 3. MongoDB Instance 2 시작 (포트 27018)
echo -e "${YELLOW}🗄️  Starting MongoDB Instance 2...${NC}"

# MongoDB 데이터 디렉터리 생성
mkdir -p /tmp/mongodb-instance2

# MongoDB 시작
mongod --port 27018 --dbpath /tmp/mongodb-instance2 --logpath /tmp/mongodb-instance2.log --fork

# MongoDB 연결 확인
sleep 3
if mongo --port 27018 --eval "db.runCommand('ismaster')" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ MongoDB Instance 2 (27018) started successfully${NC}"
else
    echo -e "${RED}❌ Failed to start MongoDB Instance 2${NC}"
    exit 1
fi

# 4. Node.js Backend Instance 2 시작
echo -e "${YELLOW}🚀 Starting Backend Instance 2...${NC}"

cd "$BACKEND_DIR"

# 환경 변수 파일 복사
cp .env.instance2 .env.instance2.active

# npm 의존성 확인
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing npm dependencies...${NC}"
    npm install
fi

# Instance 2 시작
echo -e "${GREEN}🎯 Starting Instance 2 on port 5002...${NC}"
NODE_ENV=development PORT=5002 INSTANCE_ID=instance-2 nohup node server.js --env-file=.env.instance2 > /tmp/instance2.log 2>&1 &

INSTANCE2_PID=$!
echo $INSTANCE2_PID > /tmp/instance2.pid

# 서버 시작 대기
sleep 5

# 서버 상태 확인
if curl -f http://localhost:5002/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend Instance 2 started successfully (PID: $INSTANCE2_PID)${NC}"
else
    echo -e "${RED}❌ Failed to start Backend Instance 2${NC}"
    exit 1
fi

# 5. 상태 정보 출력
echo ""
echo -e "${BLUE}🎉 Instance 2 Setup Complete!${NC}"
echo "================================"
echo -e "${GREEN}📊 Service Status:${NC}"
echo "  • Redis Master:  localhost:6380"
echo "  • Redis Slave:   localhost:16380"
echo "  • MongoDB:       localhost:27018"
echo "  • Backend API:   localhost:5002"
echo ""
echo -e "${GREEN}📋 Process Information:${NC}"
echo "  • Instance 2 PID: $INSTANCE2_PID"
echo "  • Log file: /tmp/instance2.log"
echo ""
echo -e "${GREEN}🔧 Management Commands:${NC}"
echo "  • Check status: curl http://localhost:5002/health"
echo "  • View logs: tail -f /tmp/instance2.log"
echo "  • Stop instance: ./stop-instance2.sh"
echo ""
echo -e "${YELLOW}💡 Next Steps:${NC}"
echo "  1. Verify cross-instance communication"
echo "  2. Test Redis data synchronization"
echo "  3. Monitor MongoDB replica set status"
echo "  4. Run load balancing tests"