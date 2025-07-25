# Stage 1: 빌드용
FROM node:18-alpine AS build

WORKDIR /app

# package.json만 먼저 복사하여 캐시 활용
COPY package*.json ./
RUN npm ci --omit=dev

# 앱 소스 복사 및 .env 포함
COPY . .

# Stage 2: 실행용 - 더 작고 빠르게 실행 (멀티스테이지 빌드)
FROM node:18-alpine

WORKDIR /app

# build 스테이지에서 설치한 의존성 복사
COPY --from=build /app /app

# 환경 변수 설정 (선택)
ENV PORT=5001

# .env 파일 포함
COPY .env .env

EXPOSE 5001

CMD ["npm", "start"]

