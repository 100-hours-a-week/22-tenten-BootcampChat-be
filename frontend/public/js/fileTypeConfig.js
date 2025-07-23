/**
 * Client-side file type configuration
 * This is a copy of the shared configuration for browser use
 */

const ALLOWED_FILE_TYPES = {
  image: {
    category: 'image',
    types: {
      'image/jpeg': { 
        extensions: ['.jpg', '.jpeg'], 
        maxSize: 10 * 1024 * 1024, 
        subtype: 'photo',
        previewable: true 
      },
      'image/png': { 
        extensions: ['.png'], 
        maxSize: 10 * 1024 * 1024, 
        subtype: 'photo',
        previewable: true 
      },
      'image/gif': { 
        extensions: ['.gif'], 
        maxSize: 10 * 1024 * 1024, 
        subtype: 'animation',
        previewable: true 
      },
      'image/webp': { 
        extensions: ['.webp'], 
        maxSize: 10 * 1024 * 1024, 
        subtype: 'photo',
        previewable: true 
      },
      'image/svg+xml': { 
        extensions: ['.svg'], 
        maxSize: 5 * 1024 * 1024, 
        subtype: 'vector',
        previewable: true 
      },
      'image/bmp': { 
        extensions: ['.bmp'], 
        maxSize: 15 * 1024 * 1024, 
        subtype: 'photo',
        previewable: true 
      }
    },
    name: '이미지',
    previewable: true
  },
  
  video: {
    category: 'video',
    types: {
      'video/mp4': { 
        extensions: ['.mp4'], 
        maxSize: 100 * 1024 * 1024, 
        subtype: 'movie',
        previewable: true 
      },
      'video/webm': { 
        extensions: ['.webm'], 
        maxSize: 100 * 1024 * 1024, 
        subtype: 'movie',
        previewable: true 
      },
      'video/quicktime': { 
        extensions: ['.mov'], 
        maxSize: 100 * 1024 * 1024, 
        subtype: 'movie',
        previewable: true 
      },
      'video/avi': { 
        extensions: ['.avi'], 
        maxSize: 100 * 1024 * 1024, 
        subtype: 'movie',
        previewable: true 
      },
      'video/x-msvideo': { 
        extensions: ['.avi'], 
        maxSize: 100 * 1024 * 1024, 
        subtype: 'movie',
        previewable: true 
      }
    },
    name: '동영상',
    previewable: true
  },
  
  audio: {
    category: 'audio',
    types: {
      'audio/mpeg': { 
        extensions: ['.mp3'], 
        maxSize: 25 * 1024 * 1024, 
        subtype: 'music',
        previewable: true 
      },
      'audio/wav': { 
        extensions: ['.wav'], 
        maxSize: 25 * 1024 * 1024, 
        subtype: 'music',
        previewable: true 
      },
      'audio/ogg': { 
        extensions: ['.ogg'], 
        maxSize: 25 * 1024 * 1024, 
        subtype: 'music',
        previewable: true 
      },
      'audio/mp4': { 
        extensions: ['.m4a'], 
        maxSize: 25 * 1024 * 1024, 
        subtype: 'music',
        previewable: true 
      },
      'audio/flac': { 
        extensions: ['.flac'], 
        maxSize: 50 * 1024 * 1024, 
        subtype: 'music',
        previewable: true 
      },
      'audio/webm': { 
        extensions: ['.weba'], 
        maxSize: 25 * 1024 * 1024, 
        subtype: 'music',
        previewable: true 
      }
    },
    name: '오디오',
    previewable: true
  },
  
  document: {
    category: 'document',
    types: {
      'application/pdf': { 
        extensions: ['.pdf'], 
        maxSize: 25 * 1024 * 1024, 
        subtype: 'pdf',
        previewable: true 
      },
      'application/msword': { 
        extensions: ['.doc'], 
        maxSize: 25 * 1024 * 1024, 
        subtype: 'text',
        previewable: false 
      },
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { 
        extensions: ['.docx'], 
        maxSize: 25 * 1024 * 1024, 
        subtype: 'text',
        previewable: false 
      },
      'application/vnd.ms-excel': { 
        extensions: ['.xls'], 
        maxSize: 25 * 1024 * 1024, 
        subtype: 'spreadsheet',
        previewable: false 
      },
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { 
        extensions: ['.xlsx'], 
        maxSize: 25 * 1024 * 1024, 
        subtype: 'spreadsheet',
        previewable: false 
      },
      'application/vnd.ms-powerpoint': { 
        extensions: ['.ppt'], 
        maxSize: 50 * 1024 * 1024, 
        subtype: 'presentation',
        previewable: false 
      },
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': { 
        extensions: ['.pptx'], 
        maxSize: 50 * 1024 * 1024, 
        subtype: 'presentation',
        previewable: false 
      },
      'text/plain': { 
        extensions: ['.txt'], 
        maxSize: 5 * 1024 * 1024, 
        subtype: 'text',
        previewable: true 
      },
      'text/markdown': { 
        extensions: ['.md'], 
        maxSize: 5 * 1024 * 1024, 
        subtype: 'text',
        previewable: true 
      },
      'application/rtf': { 
        extensions: ['.rtf'], 
        maxSize: 10 * 1024 * 1024, 
        subtype: 'text',
        previewable: false 
      }
    },
    name: '문서',
    previewable: true
  },
  
  archive: {
    category: 'archive',
    types: {
      'application/zip': { 
        extensions: ['.zip'], 
        maxSize: 100 * 1024 * 1024, 
        subtype: 'compressed',
        previewable: false 
      },
      'application/x-rar-compressed': { 
        extensions: ['.rar'], 
        maxSize: 100 * 1024 * 1024, 
        subtype: 'compressed',
        previewable: false 
      },
      'application/x-7z-compressed': { 
        extensions: ['.7z'], 
        maxSize: 100 * 1024 * 1024, 
        subtype: 'compressed',
        previewable: false 
      },
      'application/gzip': { 
        extensions: ['.gz'], 
        maxSize: 100 * 1024 * 1024, 
        subtype: 'compressed',
        previewable: false 
      },
      'application/x-tar': { 
        extensions: ['.tar'], 
        maxSize: 100 * 1024 * 1024, 
        subtype: 'archive',
        previewable: false 
      }
    },
    name: '압축파일',
    previewable: false
  }
};

class FileTypeValidator {
  static getFileTypeInfo(mimetype) {
    for (const [categoryKey, categoryConfig] of Object.entries(ALLOWED_FILE_TYPES)) {
      if (categoryConfig.types[mimetype]) {
        return {
          category: categoryKey,
          categoryConfig,
          typeConfig: categoryConfig.types[mimetype],
          name: categoryConfig.name
        };
      }
    }
    return null;
  }

  static getMimeTypesByExtension(extension) {
    const ext = extension.toLowerCase();
    const possibleTypes = [];
    
    for (const [categoryKey, categoryConfig] of Object.entries(ALLOWED_FILE_TYPES)) {
      for (const [mimetype, typeConfig] of Object.entries(categoryConfig.types)) {
        if (typeConfig.extensions.includes(ext)) {
          possibleTypes.push({
            mimetype,
            category: categoryKey,
            typeConfig,
            categoryConfig
          });
        }
      }
    }
    
    return possibleTypes;
  }

  static validateFile(mimetype, fileSize, filename) {
    const typeInfo = this.getFileTypeInfo(mimetype);
    
    if (!typeInfo) {
      return {
        valid: false,
        error: '지원하지 않는 파일 형식입니다.',
        category: 'other'
      };
    }

    const { typeConfig, categoryConfig } = typeInfo;

    if (fileSize > typeConfig.maxSize) {
      const maxSizeMB = Math.floor(typeConfig.maxSize / 1024 / 1024);
      return {
        valid: false,
        error: `${categoryConfig.name} 파일은 ${maxSizeMB}MB를 초과할 수 없습니다.`,
        category: typeInfo.category
      };
    }

    if (filename) {
      const ext = this.getFileExtension(filename);
      if (!typeConfig.extensions.includes(ext.toLowerCase())) {
        return {
          valid: false,
          error: '파일 확장자가 올바르지 않습니다.',
          category: typeInfo.category
        };
      }
    }

    return { 
      valid: true, 
      category: typeInfo.category,
      subtype: typeConfig.subtype,
      previewable: typeConfig.previewable,
      typeConfig,
      categoryConfig
    };
  }

  static getFileExtension(filename) {
    if (!filename) return '';
    const parts = filename.split('.');
    return parts.length > 1 ? `.${parts.pop().toLowerCase()}` : '';
  }

  static getAllowedExtensions(category = null) {
    const extensions = [];
    const categories = category ? [category] : Object.keys(ALLOWED_FILE_TYPES);
    
    categories.forEach(cat => {
      if (ALLOWED_FILE_TYPES[cat]) {
        Object.values(ALLOWED_FILE_TYPES[cat].types).forEach(typeConfig => {
          extensions.push(...typeConfig.extensions);
        });
      }
    });
    
    return [...new Set(extensions)];
  }

  static getAllowedMimeTypes(category = null) {
    const mimeTypes = [];
    const categories = category ? [category] : Object.keys(ALLOWED_FILE_TYPES);
    
    categories.forEach(cat => {
      if (ALLOWED_FILE_TYPES[cat]) {
        mimeTypes.push(...Object.keys(ALLOWED_FILE_TYPES[cat].types));
      }
    });
    
    return mimeTypes;
  }

  static isPreviewable(mimetype) {
    const typeInfo = this.getFileTypeInfo(mimetype);
    return typeInfo ? typeInfo.typeConfig.previewable : false;
  }

  static formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${units[i]}`;
  }
}

// Make available globally
window.ALLOWED_FILE_TYPES = ALLOWED_FILE_TYPES;
window.FileTypeValidator = FileTypeValidator;