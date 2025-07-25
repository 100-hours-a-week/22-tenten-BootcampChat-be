#!/bin/bash

# Instance 2 중지 스크립트
echo "🛑 Stopping BootcampChat Instance 2"
echo "=================================="

# 색상 코드
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 1. Backend Instance 2 중지
echo -e "${YELLOW}🛑 Stopping Backend Instance 2...${NC}"
if [ -f /tmp/instance2.pid ]; then
    INSTANCE2_PID=$(cat /tmp/instance2.pid)
    if kill -0 $INSTANCE2_PID 2>/dev/null; then
        kill $INSTANCE2_PID
        echo -e "${GREEN}✅ Backend Instance 2 stopped (PID: $INSTANCE2_PID)${NC}"
    else
        echo -e "${YELLOW}⚠️  Backend Instance 2 was not running${NC}"
    fi
    rm -f /tmp/instance2.pid
else
    echo -e "${YELLOW}⚠️  No PID file found for Backend Instance 2${NC}"
    # 포트 기반으로 프로세스 찾아서 종료
    PORT_PID=$(lsof -ti:5002)
    if [ ! -z "$PORT_PID" ]; then
        kill $PORT_PID
        echo -e "${GREEN}✅ Process on port 5002 stopped${NC}"
    fi
fi

# 2. MongoDB Instance 2 중지
echo -e "${YELLOW}🗄️  Stopping MongoDB Instance 2...${NC}"
MONGO_PID=$(ps aux | grep "mongod --port 27018" | grep -v grep | awk '{print $2}')
if [ ! -z "$MONGO_PID" ]; then
    kill $MONGO_PID
    echo -e "${GREEN}✅ MongoDB Instance 2 stopped (PID: $MONGO_PID)${NC}"
else
    echo -e "${YELLOW}⚠️  MongoDB Instance 2 was not running${NC}"
fi

# 3. Redis Instance 2 중지
echo -e "${YELLOW}🔧 Stopping Redis Instance 2...${NC}"

# Redis Master 중지
redis-cli -p 6380 shutdown 2>/dev/null
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Redis Master (6380) stopped${NC}"
else
    echo -e "${YELLOW}⚠️  Redis Master (6380) was not running${NC}"
fi

# Redis Slave 중지
redis-cli -p 16380 shutdown 2>/dev/null
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Redis Slave (16380) stopped${NC}"
else
    echo -e "${YELLOW}⚠️  Redis Slave (16380) was not running${NC}"
fi

# 4. 임시 파일 정리
echo -e "${YELLOW}🧹 Cleaning up temporary files...${NC}"
rm -f /tmp/redis-instance2-master.log
rm -f /tmp/redis-instance2-slave.log
rm -f /tmp/mongodb-instance2.log
rm -f /tmp/instance2.log
rm -rf /tmp/redis-instance2-master
rm -rf /tmp/redis-instance2-slave
echo -e "${GREEN}✅ Temporary files cleaned up${NC}"

# 5. 상태 확인
echo ""
echo -e "${BLUE}🎯 Cleanup Complete!${NC}"
echo "===================="

# 포트 사용 상태 확인
echo -e "${GREEN}📊 Port Status Check:${NC}"
for port in 5002 6380 16380 27018; do
    if lsof -ti:$port > /dev/null 2>&1; then
        echo -e "${RED}  ❌ Port $port is still in use${NC}"
    else
        echo -e "${GREEN}  ✅ Port $port is available${NC}"
    fi
done

echo ""
echo -e "${GREEN}✨ Instance 2 has been completely stopped${NC}"