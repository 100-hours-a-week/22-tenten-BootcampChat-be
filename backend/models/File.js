const mongoose = require('mongoose');
const { FileTypeValidator } = require('../../shared/fileTypeConfig');

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
    required: true,
    index: true
  },
  size: { 
    type: Number,
    required: true,
    min: 0
  },
  
  // Enhanced file categorization
  category: {
    type: String,
    enum: ['image', 'video', 'audio', 'document', 'archive', 'other'],
    required: true,
    index: true,
    default: function() {
      // Auto-determine category from MIME type
      const validation = FileTypeValidator.validateFile(this.mimetype, this.size, this.originalname);
      return validation.category || 'other';
    }
  },
  
  subtype: {
    type: String,
    // Examples: 'photo', 'animation' for images; 'movie', 'clip' for videos
    // 'music', 'voice' for audio; 'pdf', 'text', 'presentation' for documents
    default: function() {
      const validation = FileTypeValidator.validateFile(this.mimetype, this.size, this.originalname);
      return validation.subtype || null;
    }
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
    required: false, // 로컬 업로드시 필요없음
    index: true
  },
  s3Bucket: {
    type: String,
    required: false
  },
  uploadMethod: {
    type: String,
    enum: ['local', 's3_presigned'],
    default: 's3_presigned' // Default to S3 for new uploads
  },
  
  // Enhanced metadata
  metadata: {
    // Image metadata
    dimensions: {
      width: { type: Number, min: 0 },
      height: { type: Number, min: 0 }
    },
    
    // Video/Audio metadata
    duration: { type: Number, min: 0 }, // in seconds
    bitrate: { type: Number, min: 0 },
    
    // Video specific
    framerate: { type: Number, min: 0 },
    resolution: String, // '1080p', '720p', etc.
    
    // Audio specific
    sampleRate: { type: Number, min: 0 },
    channels: { type: Number, min: 1 },
    
    // Document metadata
    pageCount: { type: Number, min: 0 },
    
    // General metadata
    encoding: String,
    compression: String,
    colorProfile: String,
    
    // File hash for integrity checking
    hash: {
      algorithm: {
        type: String,
        enum: ['md5', 'sha256'],
        default: 'sha256'
      },
      value: String
    }
  },
  
  // Processing status
  processing: {
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'completed'
    },
    thumbnail: {
      generated: { type: Boolean, default: false },
      s3Key: String,
      size: { type: Number, min: 0 }
    },
    // For future features like virus scanning, content analysis
    scanned: { type: Boolean, default: false },
    scanResult: String,
    processedAt: Date
  },
  
  // Access and usage tracking
  access: {
    downloadCount: { type: Number, default: 0, min: 0 },
    viewCount: { type: Number, default: 0, min: 0 },
    lastAccessed: Date,
    sharedWith: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      permission: { 
        type: String, 
        enum: ['view', 'download'], 
        default: 'view' 
      },
      sharedAt: { type: Date, default: Date.now }
    }]
  },
  
  uploadDate: { 
    type: Date, 
    default: Date.now,
    index: true
  },
  
  // File lifecycle
  expiresAt: Date, // For temporary files
  archivedAt: Date // For archived files
}, {
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true }
});

// 복합 인덱스
FileSchema.index({ filename: 1, user: 1 }, { unique: true });
FileSchema.index({ user: 1, category: 1, uploadDate: -1 }); // 사용자별 카테고리 파일 조회
FileSchema.index({ user: 1, uploadMethod: 1, uploadDate: -1 }); // 사용자별 업로드 방식 조회
FileSchema.index({ category: 1, mimetype: 1 }); // 카테고리별 MIME 타입 조회
FileSchema.index({ 'processing.status': 1, uploadDate: -1 }); // 처리 상태별 조회
FileSchema.index({ expiresAt: 1 }, { sparse: true }); // 만료 파일 정리용

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

// Enhanced file categorization methods
FileSchema.methods.getFileCategory = function() {
  return this.category || 'other';
};

FileSchema.methods.getFileSubtype = function() {
  return this.subtype || null;
};

FileSchema.methods.isMediaFile = function() {
  return ['image', 'video', 'audio'].includes(this.category);
};

// Enhanced preview capability check
FileSchema.methods.isPreviewable = function() {
  // Use shared validation to determine if file is previewable
  return FileTypeValidator.isPreviewable(this.mimetype);
};

// File metadata methods
FileSchema.methods.hasMetadata = function() {
  return !!(this.metadata && Object.keys(this.metadata).length > 0);
};

FileSchema.methods.getDimensions = function() {
  return this.metadata?.dimensions || null;
};

FileSchema.methods.getDuration = function() {
  return this.metadata?.duration || null;
};

FileSchema.methods.getFormattedDuration = function() {
  const duration = this.getDuration();
  if (!duration) return null;
  
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = Math.floor(duration % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// Access tracking methods
FileSchema.methods.incrementDownloadCount = function() {
  this.access.downloadCount = (this.access.downloadCount || 0) + 1;
  this.access.lastAccessed = new Date();
  return this.save();
};

FileSchema.methods.incrementViewCount = function() {
  this.access.viewCount = (this.access.viewCount || 0) + 1;
  this.access.lastAccessed = new Date();
  return this.save();
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