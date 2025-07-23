const AWS = require('aws-sdk');
const crypto = require('crypto');
const path = require('path');

class S3Service {
  constructor() {
    // S3 클라이언트 설정
    this.s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'ap-northeast-2'
    });

    this.bucketName = process.env.S3_BUCKET_NAME;
    this.presignedUrlExpiry = parseInt(process.env.S3_PRESIGNED_URL_EXPIRY || '900'); // 15분 기본값
    this.maxFileSize = 50 * 1024 * 1024; // 50MB

    // 허용된 파일 타입 설정
    this.allowedTypes = {
      'image/jpeg': { extensions: ['.jpg', '.jpeg'], maxSize: 10 * 1024 * 1024 },
      'image/png': { extensions: ['.png'], maxSize: 10 * 1024 * 1024 },
      'image/gif': { extensions: ['.gif'], maxSize: 10 * 1024 * 1024 },
      'image/webp': { extensions: ['.webp'], maxSize: 10 * 1024 * 1024 },
      'video/mp4': { extensions: ['.mp4'], maxSize: 50 * 1024 * 1024 },
      'video/webm': { extensions: ['.webm'], maxSize: 50 * 1024 * 1024 },
      'video/quicktime': { extensions: ['.mov'], maxSize: 50 * 1024 * 1024 },
      'audio/mpeg': { extensions: ['.mp3'], maxSize: 20 * 1024 * 1024 },
      'audio/wav': { extensions: ['.wav'], maxSize: 20 * 1024 * 1024 },
      'audio/ogg': { extensions: ['.ogg'], maxSize: 20 * 1024 * 1024 },
      'application/pdf': { extensions: ['.pdf'], maxSize: 20 * 1024 * 1024 },
      'application/msword': { extensions: ['.doc'], maxSize: 20 * 1024 * 1024 },
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extensions: ['.docx'], maxSize: 20 * 1024 * 1024 }
    };
  }

  /**
   * 안전한 S3 키 생성
   */
  generateS3Key(originalFilename, userId) {
    const ext = path.extname(originalFilename).toLowerCase();
    const timestamp = Date.now();
    const randomBytes = crypto.randomBytes(8).toString('hex');
    const userPrefix = userId ? `users/${userId}/` : '';
    
    return `${userPrefix}files/${timestamp}_${randomBytes}${ext}`;
  }

  /**
   * 파일 타입 및 크기 검증
   */
  validateFile(mimetype, fileSize, filename) {
    const typeConfig = this.allowedTypes[mimetype];
    
    if (!typeConfig) {
      return {
        valid: false,
        error: '지원하지 않는 파일 형식입니다.'
      };
    }

    if (fileSize > typeConfig.maxSize) {
      const maxSizeMB = Math.floor(typeConfig.maxSize / 1024 / 1024);
      return {
        valid: false,
        error: `파일 크기는 ${maxSizeMB}MB를 초과할 수 없습니다.`
      };
    }

    const ext = path.extname(filename).toLowerCase();
    if (!typeConfig.extensions.includes(ext)) {
      return {
        valid: false,
        error: '파일 확장자가 올바르지 않습니다.'
      };
    }

    return { valid: true };
  }

  /**
   * Presigned URL 생성 (업로드용)
   */
  async generatePresignedUploadUrl(filename, mimetype, fileSize, userId) {
    try {
      // 파일 검증
      const validation = this.validateFile(mimetype, fileSize, filename);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const s3Key = this.generateS3Key(filename, userId);

      const params = {
        Bucket: this.bucketName,
        Key: s3Key,
        Expires: this.presignedUrlExpiry,
        ContentType: mimetype,
        ContentLength: fileSize,
        Conditions: [
          ['content-length-range', 1, fileSize], // 파일 크기 제한
          ['eq', '$Content-Type', mimetype], // MIME 타입 제한
        ]
      };

      const uploadUrl = await this.s3.getSignedUrlPromise('putObject', params);

      return {
        uploadUrl,
        s3Key,
        bucket: this.bucketName,
        expires: new Date(Date.now() + this.presignedUrlExpiry * 1000)
      };
    } catch (error) {
      console.error('Presigned URL generation error:', error);
      throw new Error(`Presigned URL 생성 실패: ${error.message}`);
    }
  }

  /**
   * Presigned URL 생성 (다운로드용)
   */
  async generatePresignedDownloadUrl(s3Key, filename) {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: s3Key,
        Expires: this.presignedUrlExpiry,
        ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`
      };

      const downloadUrl = await this.s3.getSignedUrlPromise('getObject', params);
      
      return {
        downloadUrl,
        expires: new Date(Date.now() + this.presignedUrlExpiry * 1000)
      };
    } catch (error) {
      console.error('Presigned download URL generation error:', error);
      throw new Error(`다운로드 URL 생성 실패: ${error.message}`);
    }
  }

  /**
   * S3에서 파일 존재 여부 확인
   */
  async checkFileExists(s3Key) {
    try {
      await this.s3.headObject({
        Bucket: this.bucketName,
        Key: s3Key
      }).promise();
      
      return true;
    } catch (error) {
      if (error.code === 'NotFound' || error.code === 'Forbidden') {
        return false;
      }
      throw error;
    }
  }

  /**
   * S3에서 파일 메타데이터 가져오기
   */
  async getFileMetadata(s3Key) {
    try {
      const result = await this.s3.headObject({
        Bucket: this.bucketName,
        Key: s3Key
      }).promise();

      return {
        size: result.ContentLength,
        contentType: result.ContentType,
        lastModified: result.LastModified,
        etag: result.ETag
      };
    } catch (error) {
      console.error('File metadata retrieval error:', error);
      throw new Error(`파일 메타데이터 조회 실패: ${error.message}`);
    }
  }

  /**
   * S3에서 파일 삭제
   */
  async deleteFile(s3Key) {
    try {
      await this.s3.deleteObject({
        Bucket: this.bucketName,
        Key: s3Key
      }).promise();

      return true;
    } catch (error) {
      console.error('File deletion error:', error);
      throw new Error(`파일 삭제 실패: ${error.message}`);
    }
  }

  /**
   * 공개 URL 생성 (공개 버킷용)
   */
  getPublicUrl(s3Key) {
    return `https://${this.bucketName}.s3.${this.s3.config.region}.amazonaws.com/${s3Key}`;
  }

  /**
   * S3 설정 검증
   */
  async validateConfiguration() {
    try {
      if (!this.bucketName) {
        throw new Error('S3_BUCKET_NAME이 설정되지 않았습니다.');
      }

      // 버킷 접근 권한 확인
      await this.s3.headBucket({ Bucket: this.bucketName }).promise();
      
      return true;
    } catch (error) {
      console.error('S3 configuration validation error:', error);
      throw new Error(`S3 설정 검증 실패: ${error.message}`);
    }
  }

  /**
   * 업로드 완료 후 파일 검증
   */
  async verifyUploadComplete(s3Key, expectedSize, expectedMimeType) {
    try {
      const metadata = await this.getFileMetadata(s3Key);
      
      // 파일 크기 검증 (허용 오차 1KB)
      if (Math.abs(metadata.size - expectedSize) > 1024) {
        throw new Error('파일 크기가 일치하지 않습니다.');
      }

      // MIME 타입 검증
      if (metadata.contentType !== expectedMimeType) {
        console.warn(`MIME type mismatch: expected ${expectedMimeType}, got ${metadata.contentType}`);
      }

      return {
        verified: true,
        actualSize: metadata.size,
        actualMimeType: metadata.contentType,
        lastModified: metadata.lastModified
      };
    } catch (error) {
      console.error('Upload verification error:', error);
      throw new Error(`업로드 검증 실패: ${error.message}`);
    }
  }
}

module.exports = new S3Service();