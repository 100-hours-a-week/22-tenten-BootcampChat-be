const mongoose = require('mongoose');

const FileSchema = new mongoose.Schema({
  filename: { 
    type: String, 
    required: true,
    index: true,
    validate: {
      validator: function(v) {
        return /^[0-9]+_[a-f0-9]+\.[a-z0-9]+$/.test(v);
      },
      message: '올바르지 않은 파일명 형식입니다.'
    }
  },
  originalname: { 
    type: String,
    required: true,
    set: function(name) {
      try {
        if (!name) return '';
        
        // 파일명에서 경로 구분자 제거
        const sanitizedName = name.replace(/[\/\\]/g, '');
        
        // 유니코드 정규화 (NFC)
        return sanitizedName.normalize('NFC');
      } catch (error) {
        console.error('Filename sanitization error:', error);
        return name;
      }
    },
    get: function(name) {
      try {
        if (!name) return '';
        
        // 유니코드 정규화된 형태로 반환
        return name.normalize('NFC');
      } catch (error) {
        console.error('Filename retrieval error:', error);
        return name;
      }
    }
  },
  mimetype: { 
    type: String,
    required: true
  },
  size: { 
    type: Number,
    required: true,
    min: 0
  },
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true,
    index: true
  },
  path: { 
    type: String,
    required: false // S3 업로드시 필요없음
  },
  s3Key: {
    type: String,
    required: false // 로컬 업로드시 필요없음
  },
  s3Bucket: {
    type: String,
    required: false
  },
  uploadMethod: {
    type: String,
    enum: ['local', 's3_presigned'],
    default: 'local'
  },
  uploadDate: { 
    type: Date, 
    default: Date.now,
    index: true
  }
}, {
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true }
});

// 복합 인덱스
FileSchema.index({ filename: 1, user: 1 }, { unique: true });

// 파일 삭제 전 처리
FileSchema.pre('remove', async function(next) {
  try {
    const fs = require('fs').promises;
    if (this.path) {
      await fs.unlink(this.path);
    }
    next();
  } catch (error) {
    console.error('File removal error:', error);
    next(error);
  }
});

// URL 안전한 파일명 생성을 위한 유틸리티 메서드
FileSchema.methods.getSafeFilename = function() {
  return this.filename;
};

// Content-Disposition 헤더를 위한 파일명 인코딩 메서드
FileSchema.methods.getEncodedFilename = function() {
  try {
    const filename = this.originalname;
    if (!filename) return '';

    // RFC 5987에 따른 인코딩
    const encodedFilename = encodeURIComponent(filename)
      .replace(/'/g, "%27")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/\*/g, "%2A");

    return {
      legacy: filename.replace(/[^\x20-\x7E]/g, ''), // ASCII only for legacy clients
      encoded: `UTF-8''${encodedFilename}` // RFC 5987 format
    };
  } catch (error) {
    console.error('Filename encoding error:', error);
    return {
      legacy: this.filename,
      encoded: this.filename
    };
  }
};

// 파일 URL 생성을 위한 유틸리티 메서드
FileSchema.methods.getFileUrl = function(type = 'download') {
  if (this.uploadMethod === 's3_presigned' && this.s3Key) {
    // S3 파일의 경우 presigned URL 생성 필요
    return `/api/files/s3-url/${type}/${encodeURIComponent(this.filename)}`;
  }
  // 로컬 파일
  return `/api/files/${type}/${encodeURIComponent(this.filename)}`;
};

// S3 공개 URL 생성 메서드
FileSchema.methods.getS3PublicUrl = function() {
  if (this.uploadMethod === 's3_presigned' && this.s3Key && this.s3Bucket) {
    const region = process.env.AWS_REGION || 'ap-northeast-2';
    return `https://${this.s3Bucket}.s3.${region}.amazonaws.com/${this.s3Key}`;
  }
  return null;
};

// 다운로드용 Content-Disposition 헤더 생성 메서드
FileSchema.methods.getContentDisposition = function(type = 'attachment') {
  const { legacy, encoded } = this.getEncodedFilename();
  return `${type}; filename="${legacy}"; filename*=${encoded}`;
};

// 파일 MIME 타입 검증 메서드
FileSchema.methods.isPreviewable = function() {
  const previewableTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm',
    'audio/mpeg', 'audio/wav',
    'application/pdf'
  ];
  return previewableTypes.includes(this.mimetype);
};

// S3 파일인지 확인하는 메서드
FileSchema.methods.isS3File = function() {
  return this.uploadMethod === 's3_presigned' && !!this.s3Key;
};

// 로컬 파일인지 확인하는 메서드
FileSchema.methods.isLocalFile = function() {
  return this.uploadMethod === 'local' && !!this.path;
};

module.exports = mongoose.model('File', FileSchema);