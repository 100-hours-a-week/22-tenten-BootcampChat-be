const mongoose = require('mongoose');
const File = require('../models/File');
const s3Service = require('../services/s3Service');
require('dotenv').config();

class MigrationVerifier {
  constructor() {
    this.verificationStats = {
      totalFiles: 0,
      s3Files: 0,
      localFiles: 0,
      validS3Files: 0,
      invalidS3Files: 0,
      missingLocalFiles: 0,
      sizeMismatches: 0,
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

  async getAllFiles() {
    try {
      const files = await File.find({}).sort({ uploadDate: 1 });
      console.log(`Found ${files.length} total files in database`);
      return files;
    } catch (error) {
      console.error('Error fetching files:', error);
      throw error;
    }
  }

  async verifyS3File(file) {
    try {
      // S3에서 파일 존재 확인
      const exists = await s3Service.checkFileExists(file.s3Key);
      if (!exists) {
        this.verificationStats.invalidS3Files++;
        return {
          valid: false,
          reason: 'File not found in S3'
        };
      }

      // S3에서 메타데이터 조회
      const metadata = await s3Service.getFileMetadata(file.s3Key);
      
      // 파일 크기 검증
      if (Math.abs(metadata.size - file.size) > 1024) { // 1KB 허용 오차
        this.verificationStats.sizeMismatches++;
        console.warn(`Size mismatch for ${file.filename}: DB=${file.size}, S3=${metadata.size}`);
      }

      // MIME 타입 검증
      if (metadata.contentType !== file.mimetype) {
        console.warn(`MIME type mismatch for ${file.filename}: DB=${file.mimetype}, S3=${metadata.contentType}`);
      }

      this.verificationStats.validS3Files++;
      return {
        valid: true,
        s3Size: metadata.size,
        s3ContentType: metadata.contentType,
        lastModified: metadata.lastModified
      };

    } catch (error) {
      console.error(`S3 verification error for ${file.filename}:`, error);
      this.verificationStats.invalidS3Files++;
      this.verificationStats.errors.push({
        filename: file.filename,
        type: 'S3_VERIFICATION_ERROR',
        error: error.message
      });
      
      return {
        valid: false,
        reason: error.message
      };
    }
  }

  async verifyLocalFile(file) {
    try {
      const fs = require('fs').promises;
      
      // 로컬 파일 존재 확인
      try {
        const stats = await fs.stat(file.path);
        
        // 파일 크기 검증
        if (stats.size !== file.size) {
          console.warn(`Local file size mismatch for ${file.filename}: DB=${file.size}, Local=${stats.size}`);
        }
        
        return {
          exists: true,
          localSize: stats.size,
          lastModified: stats.mtime
        };
      } catch (error) {
        if (error.code === 'ENOENT') {
          this.verificationStats.missingLocalFiles++;
          return {
            exists: false,
            reason: 'Local file not found'
          };
        }
        throw error;
      }

    } catch (error) {
      console.error(`Local file verification error for ${file.filename}:`, error);
      this.verificationStats.errors.push({
        filename: file.filename,
        type: 'LOCAL_VERIFICATION_ERROR',
        error: error.message
      });
      
      return {
        exists: false,
        reason: error.message
      };
    }
  }

  async verifyFile(file) {
    const verification = {
      filename: file.filename,
      originalname: file.originalname,
      uploadMethod: file.uploadMethod,
      size: file.size,
      uploadDate: file.uploadDate
    };

    // S3 파일 검증
    if (file.s3Key) {
      const s3Result = await this.verifyS3File(file);
      verification.s3 = s3Result;
    }

    // 로컬 파일 검증
    if (file.path) {
      const localResult = await this.verifyLocalFile(file);
      verification.local = localResult;
    }

    return verification;
  }

  async generateVerificationReport(verifications) {
    const report = {
      timestamp: new Date().toISOString(),
      stats: this.verificationStats,
      summary: {
        totalFiles: this.verificationStats.totalFiles,
        s3Files: this.verificationStats.s3Files,
        localFiles: this.verificationStats.localFiles,
        validS3Files: this.verificationStats.validS3Files,
        invalidS3Files: this.verificationStats.invalidS3Files,
        missingLocalFiles: this.verificationStats.missingLocalFiles,
        sizeMismatches: this.verificationStats.sizeMismatches,
        s3SuccessRate: this.verificationStats.s3Files > 0 ? 
          ((this.verificationStats.validS3Files / this.verificationStats.s3Files) * 100).toFixed(2) + '%' : '0%'
      },
      fileBreakdown: {
        s3Only: verifications.filter(v => v.s3 && !v.local?.exists).length,
        localOnly: verifications.filter(v => !v.s3 && v.local?.exists).length,
        both: verifications.filter(v => v.s3 && v.local?.exists).length,
        neither: verifications.filter(v => !v.s3 && !v.local?.exists).length
      }
    };

    console.log('\n=== VERIFICATION REPORT ===');
    console.log(JSON.stringify(report, null, 2));

    // 문제가 있는 파일들 상세 출력
    const problematicFiles = verifications.filter(v => 
      (v.s3 && !v.s3.valid) || 
      (v.local && !v.local.exists) ||
      (!v.s3 && !v.local?.exists)
    );

    if (problematicFiles.length > 0) {
      console.log('\n=== PROBLEMATIC FILES ===');
      problematicFiles.forEach(file => {
        console.log(`${file.filename}:`);
        if (file.s3 && !file.s3.valid) {
          console.log(`  S3: ${file.s3.reason}`);
        }
        if (file.local && !file.local.exists) {
          console.log(`  Local: ${file.local.reason}`);
        }
        if (!file.s3 && !file.local?.exists) {
          console.log(`  Status: No valid storage location found`);
        }
      });
    }

    // 에러 상세 출력
    if (this.verificationStats.errors.length > 0) {
      console.log('\n=== VERIFICATION ERRORS ===');
      this.verificationStats.errors.forEach(error => {
        console.log(`${error.filename} (${error.type}): ${error.error}`);
      });
    }

    return report;
  }

  async run() {
    try {
      console.log('=== Starting Migration Verification ===\n');

      // MongoDB 연결
      await this.connectDB();

      // 모든 파일 조회
      const files = await this.getAllFiles();
      this.verificationStats.totalFiles = files.length;

      if (files.length === 0) {
        console.log('No files found in database');
        return;
      }

      // 파일 분류
      files.forEach(file => {
        if (file.s3Key) this.verificationStats.s3Files++;
        if (file.path) this.verificationStats.localFiles++;
      });

      console.log(`Files breakdown: S3=${this.verificationStats.s3Files}, Local=${this.verificationStats.localFiles}`);

      // 각 파일 검증
      console.log('\nVerifying files...');
      const verifications = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const verification = await this.verifyFile(file);
        verifications.push(verification);
        
        if ((i + 1) % 50 === 0) {
          console.log(`Verified ${i + 1}/${files.length} files`);
        }
      }

      // 결과 리포트 생성
      const report = await this.generateVerificationReport(verifications);

      console.log('\n=== Verification Completed ===');
      
      return report;

    } catch (error) {
      console.error('Verification process failed:', error);
      throw error;
    } finally {
      await this.disconnectDB();
    }
  }
}

// 스크립트 실행
if (require.main === module) {
  const verifier = new MigrationVerifier();
  
  verifier.run()
    .then(report => {
      console.log('Verification completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Verification failed:', error);
      process.exit(1);
    });
}

module.exports = MigrationVerifier;