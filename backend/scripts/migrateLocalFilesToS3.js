const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs').promises;
const File = require('../models/File');
const s3Service = require('../services/s3Service');
require('dotenv').config();

class LocalToS3Migration {
  constructor() {
    this.uploadDir = path.join(__dirname, '../uploads');
    this.batchSize = 10; // 동시 업로드 제한
    this.migrationStats = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };
  }

  async connectDB() {
    try {
      await mongoose.connect(process.env.MONGO_URI);
      console.log('MongoDB connected successfully');
    } catch (error) {
      console.error('MongoDB connection error:', error);
      throw error;
    }
  }

  async disconnectDB() {
    try {
      await mongoose.disconnect();
      console.log('MongoDB disconnected');
    } catch (error) {
      console.error('MongoDB disconnection error:', error);
    }
  }

  async validateS3Configuration() {
    try {
      await s3Service.validateConfiguration();
      console.log('S3 configuration validated successfully');
    } catch (error) {
      console.error('S3 configuration validation failed:', error);
      throw error;
    }
  }

  async getLocalFiles() {
    try {
      const files = await File.find({ 
        uploadMethod: 'local',
        path: { $exists: true },
        s3Key: { $exists: false }
      }).sort({ uploadDate: 1 });

      console.log(`Found ${files.length} local files to migrate`);
      return files;
    } catch (error) {
      console.error('Error fetching local files:', error);
      throw error;
    }
  }

  async checkLocalFileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  async readFileBuffer(filePath) {
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      throw error;
    }
  }

  async uploadFileToS3(file, fileBuffer) {
    try {
      // S3 키 생성
      const s3Key = s3Service.generateS3Key(file.originalname, file.user);
      
      // AWS SDK를 사용하여 직접 업로드
      const uploadParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: file.mimetype,
        ContentLength: file.size
      };

      await s3Service.s3.upload(uploadParams).promise();
      
      return s3Key;
    } catch (error) {
      console.error(`S3 upload error for file ${file.filename}:`, error);
      throw error;
    }
  }

  async updateFileRecord(file, s3Key) {
    try {
      await File.findByIdAndUpdate(file._id, {
        s3Key: s3Key,
        s3Bucket: process.env.S3_BUCKET_NAME,
        uploadMethod: 's3_presigned'
        // path는 백업용으로 유지
      });
    } catch (error) {
      console.error(`Database update error for file ${file.filename}:`, error);
      throw error;
    }
  }

  async migrateFile(file) {
    try {
      const localFilePath = file.path;
      
      // 로컬 파일 존재 확인
      if (!await this.checkLocalFileExists(localFilePath)) {
        console.warn(`Local file not found: ${localFilePath}`);
        this.migrationStats.skipped++;
        return { success: false, reason: 'Local file not found' };
      }

      // 파일 크기 검증
      const stats = await fs.stat(localFilePath);
      if (stats.size !== file.size) {
        console.warn(`File size mismatch for ${file.filename}: expected ${file.size}, got ${stats.size}`);
      }

      // S3에 이미 업로드된 파일인지 확인
      if (file.s3Key && await s3Service.checkFileExists(file.s3Key)) {
        console.log(`File already exists in S3: ${file.filename}`);
        this.migrationStats.skipped++;
        return { success: true, reason: 'Already migrated' };
      }

      // 파일 읽기
      const fileBuffer = await this.readFileBuffer(localFilePath);

      // S3에 업로드
      const s3Key = await this.uploadFileToS3(file, fileBuffer);

      // S3 업로드 검증
      const verification = await s3Service.verifyUploadComplete(s3Key, file.size, file.mimetype);
      if (!verification.verified) {
        throw new Error('S3 upload verification failed');
      }

      // 데이터베이스 업데이트
      await this.updateFileRecord(file, s3Key);

      console.log(`Successfully migrated: ${file.filename} -> ${s3Key}`);
      this.migrationStats.success++;
      
      return { 
        success: true, 
        s3Key,
        originalSize: file.size,
        actualSize: verification.actualSize
      };

    } catch (error) {
      console.error(`Migration failed for file ${file.filename}:`, error);
      this.migrationStats.failed++;
      this.migrationStats.errors.push({
        filename: file.filename,
        error: error.message
      });
      
      return { success: false, error: error.message };
    }
  }

  async migrateInBatches(files) {
    console.log(`Starting migration of ${files.length} files in batches of ${this.batchSize}`);
    
    for (let i = 0; i < files.length; i += this.batchSize) {
      const batch = files.slice(i, i + this.batchSize);
      console.log(`\nProcessing batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(files.length / this.batchSize)}`);
      
      const promises = batch.map(file => this.migrateFile(file));
      await Promise.all(promises);
      
      // 진행률 출력
      const completed = Math.min(i + this.batchSize, files.length);
      const progress = ((completed / files.length) * 100).toFixed(1);
      console.log(`Progress: ${completed}/${files.length} (${progress}%)`);
      
      // 배치 간 대기 (S3 요청 제한 고려)
      if (i + this.batchSize < files.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async generateMigrationReport() {
    const report = {
      timestamp: new Date().toISOString(),
      stats: this.migrationStats,
      summary: {
        totalFiles: this.migrationStats.total,
        successfulMigrations: this.migrationStats.success,
        failedMigrations: this.migrationStats.failed,
        skippedFiles: this.migrationStats.skipped,
        successRate: this.migrationStats.total > 0 ? 
          ((this.migrationStats.success / this.migrationStats.total) * 100).toFixed(2) + '%' : '0%'
      }
    };

    console.log('\n=== MIGRATION REPORT ===');
    console.log(JSON.stringify(report, null, 2));

    // 에러가 있는 경우 상세 출력
    if (this.migrationStats.errors.length > 0) {
      console.log('\n=== FAILED MIGRATIONS ===');
      this.migrationStats.errors.forEach(error => {
        console.log(`${error.filename}: ${error.error}`);
      });
    }

    return report;
  }

  async run() {
    try {
      console.log('=== Starting Local to S3 Migration ===\n');

      // MongoDB 연결
      await this.connectDB();

      // S3 설정 검증
      await this.validateS3Configuration();

      // 마이그레이션할 파일 조회
      const localFiles = await this.getLocalFiles();
      this.migrationStats.total = localFiles.length;

      if (localFiles.length === 0) {
        console.log('No local files found to migrate');
        return;
      }

      // 배치 단위로 마이그레이션 실행
      await this.migrateInBatches(localFiles);

      // 결과 리포트 생성
      const report = await this.generateMigrationReport();

      console.log('\n=== Migration Completed ===');
      
      return report;

    } catch (error) {
      console.error('Migration process failed:', error);
      throw error;
    } finally {
      await this.disconnectDB();
    }
  }
}

// 스크립트 실행
if (require.main === module) {
  const migration = new LocalToS3Migration();
  
  migration.run()
    .then(report => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = LocalToS3Migration;