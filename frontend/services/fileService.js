import axios, { isCancel, CancelToken } from 'axios';
import authService from './authService';
import { Toast } from '../components/Toast';

// Import shared file type configuration
// Note: In browser environment, this would be loaded via script tag or bundled
let ALLOWED_FILE_TYPES, FileTypeValidator;

if (typeof window !== 'undefined' && window.ALLOWED_FILE_TYPES) {
  // 브라우저 환경
  ALLOWED_FILE_TYPES = window.ALLOWED_FILE_TYPES;
  FileTypeValidator = window.FileTypeValidator;
} else {
  // 서버 환경
  // 서버에서도 쓸 수 있는 파일 타입 정의를 import 하거나 직접 선언
  const shared = require('../../shared/fileTypeConfig');
  ALLOWED_FILE_TYPES = shared.ALLOWED_FILE_TYPES;
  FileTypeValidator = shared.FileTypeValidator;
}
class FileService {
  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_API_URL;
    this.uploadLimit = 100 * 1024 * 1024; // 100MB (increased for video/archive files)
    this.retryAttempts = 3;
    this.retryDelay = 1000;
    this.activeUploads = new Map();
  }

  async validateFile(file) {
    if (!file) {
      const message = '파일이 선택되지 않았습니다.';
      Toast.error(message);
      return { success: false, message };
    }

    if (file.size > this.uploadLimit) {
      const message = `파일 크기는 ${FileTypeValidator.formatFileSize(
        this.uploadLimit
      )}를 초과할 수 없습니다.`;
      Toast.error(message);
      return { success: false, message };
    }

    // Use shared validation
    const validation = FileTypeValidator.validateFile(
      file.type,
      file.size,
      file.name
    );

    if (!validation.valid) {
      Toast.error(validation.error);
      return {
        success: false,
        message: validation.error,
        category: validation.category,
      };
    }

    return {
      success: true,
      category: validation.category,
      subtype: validation.subtype,
      previewable: validation.previewable,
    };
  }

  async uploadFile(file, onProgress) {
    const validationResult = await this.validateFile(file);
    if (!validationResult.success) {
      return validationResult;
    }

    // S3 Presigned URL 방식 사용
    return this.uploadFileViaS3(file, onProgress);
  }

  async uploadFileViaS3(file, onProgress) {
    try {
      const user = authService.getCurrentUser();
      if (!user?.token || !user?.sessionId) {
        return {
          success: false,
          message: '인증 정보가 없습니다.',
        };
      }

      // 1. Presigned URL 요청
      const presignedResponse = await this.getPresignedUploadUrl(file);
      if (!presignedResponse.success) {
        return presignedResponse;
      }

      const { uploadUrl, s3Key } = presignedResponse.data;
      const source = CancelToken.source();
      this.activeUploads.set(file.name, source);

      // 2. S3에 직접 업로드
      const s3UploadResponse = await this.uploadToS3(
        uploadUrl,
        file,
        onProgress,
        source.token
      );
      if (!s3UploadResponse.success) {
        this.activeUploads.delete(file.name);
        return s3UploadResponse;
      }

      // 3. 백엔드에 업로드 완료 알림
      const completionResponse = await this.notifyUploadComplete(file, s3Key);
      this.activeUploads.delete(file.name);

      if (!completionResponse.success) {
        return completionResponse;
      }

      const fileData = completionResponse.data;
      return {
        success: true,
        data: {
          ...fileData,
          url: this.getFileUrl(fileData.filename, true),
        },
      };
    } catch (error) {
      this.activeUploads.delete(file.name);

      if (isCancel(error)) {
        return {
          success: false,
          message: '업로드가 취소되었습니다.',
        };
      }

      if (error.response?.status === 401) {
        try {
          const refreshed = await authService.refreshToken();
          if (refreshed) {
            return this.uploadFileViaS3(file, onProgress);
          }
          return {
            success: false,
            message: '인증이 만료되었습니다. 다시 로그인해주세요.',
          };
        } catch (refreshError) {
          return {
            success: false,
            message: '인증이 만료되었습니다. 다시 로그인해주세요.',
          };
        }
      }

      return this.handleUploadError(error);
    }
  }

  // 멀티파트 업로드 함수 제거됨 - S3 전용 아키텍처
  async downloadFile(filename, originalname, file = null) {
    try {
      // S3 전용 아키텍처: S3 URL 직접 사용
      if (file && file.s3Url) {
        // S3 URL로 직접 다운로드
        window.open(file.s3Url, '_blank');
        return { success: true };
      }

      // S3 URL이 없으면 에러 반환
      return {
        success: false,
        message: 'S3 URL이 없습니다. 로컬 파일은 더 이상 지원하지 않습니다.',
      };
    } catch (error) {
      return this.handleDownloadError(error);
    }
  }

  // 로컬 파일 다운로드 함수 제거됨 - S3 전용 아키텍처

  getFileUrl(filename, forPreview = false) {
    if (!filename) return '';

    const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
    const endpoint = forPreview ? 'view' : 'download';
    return `${baseUrl}/api/files/${endpoint}/${filename}`;
  }

  getPreviewUrl(file, withAuth = true) {
    if (!file?.filename) return '';

    // S3 전용 아키텍처: S3 URL 직접 사용
    if (file.s3Url) {
      return file.s3Url;
    }

    // S3 URL이 없으면 에러 로그 출력 후 빈 문자열 반환
    console.error('File without S3 URL - local files are no longer supported:', file);
    return '';
  }

  // S3 미리보기 URL 생성 함수 제거됨 - 직접 S3 URL 사용

  // S3 다운로드 URL 생성
  async getS3DownloadUrl(filename) {
    try {
      const user = authService.getCurrentUser();
      if (!user?.token || !user?.sessionId) {
        return { success: false, message: '인증 정보가 없습니다.' };
      }

      const requestUrl = this.baseUrl
        ? `${this.baseUrl}/api/files/s3-url/download/${filename}`
        : `/api/files/s3-url/download/${filename}`;

      const response = await axios.get(requestUrl, {
        headers: {
          'x-auth-token': user.token,
          'x-session-id': user.sessionId,
        },
        withCredentials: true,
      });

      if (response.data.success) {
        return {
          success: true,
          downloadUrl: response.data.downloadUrl,
          expires: response.data.expires,
        };
      }

      return {
        success: false,
        message: response.data.message || '다운로드 URL 생성에 실패했습니다.',
      };
    } catch (error) {
      console.error('S3 download URL generation error:', error);
      return {
        success: false,
        message:
          error.response?.data?.message ||
          '다운로드 URL 생성 중 오류가 발생했습니다.',
      };
    }
  }

  getFileType(filename) {
    if (!filename) return 'unknown';
    const ext = FileTypeValidator.getFileExtension(filename);
    const possibleTypes = FileTypeValidator.getMimeTypesByExtension(ext);
    return possibleTypes.length > 0 ? possibleTypes[0].category : 'unknown';
  }

  getFileExtension(filename) {
    return FileTypeValidator.getFileExtension(filename);
  }

  formatFileSize(bytes) {
    return FileTypeValidator.formatFileSize(bytes);
  }

  getHeaders() {
    const user = authService.getCurrentUser();
    if (!user?.token || !user?.sessionId) {
      return {};
    }
    return {
      'x-auth-token': user.token,
      'x-session-id': user.sessionId,
      Accept: 'application/json, */*',
    };
  }

  handleUploadError(error) {
    console.error('Upload error:', error);

    if (error.code === 'ECONNABORTED') {
      return {
        success: false,
        message: '파일 업로드 시간이 초과되었습니다.',
      };
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.message;

      switch (status) {
        case 400:
          return {
            success: false,
            message: message || '잘못된 요청입니다.',
          };
        case 401:
          return {
            success: false,
            message: '인증이 필요합니다.',
          };
        case 413:
          return {
            success: false,
            message: '파일이 너무 큽니다.',
          };
        case 415:
          return {
            success: false,
            message: '지원하지 않는 파일 형식입니다.',
          };
        case 500:
          return {
            success: false,
            message: '서버 오류가 발생했습니다.',
          };
        default:
          return {
            success: false,
            message: message || '파일 업로드에 실패했습니다.',
          };
      }
    }

    return {
      success: false,
      message: error.message || '알 수 없는 오류가 발생했습니다.',
      error,
    };
  }

  handleDownloadError(error) {
    console.error('Download error:', error);

    if (error.code === 'ECONNABORTED') {
      return {
        success: false,
        message: '파일 다운로드 시간이 초과되었습니다.',
      };
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.message;

      switch (status) {
        case 404:
          return {
            success: false,
            message: '파일을 찾을 수 없습니다.',
          };
        case 403:
          return {
            success: false,
            message: '파일에 접근할 권한이 없습니다.',
          };
        case 400:
          return {
            success: false,
            message: message || '잘못된 요청입니다.',
          };
        case 500:
          return {
            success: false,
            message: '서버 오류가 발생했습니다.',
          };
        default:
          return {
            success: false,
            message: message || '파일 다운로드에 실패했습니다.',
          };
      }
    }

    return {
      success: false,
      message: error.message || '알 수 없는 오류가 발생했습니다.',
      error,
    };
  }

  cancelUpload(filename) {
    const source = this.activeUploads.get(filename);
    if (source) {
      source.cancel('Upload canceled by user');
      this.activeUploads.delete(filename);
      return {
        success: true,
        message: '업로드가 취소되었습니다.',
      };
    }
    return {
      success: false,
      message: '취소할 업로드를 찾을 수 없습니다.',
    };
  }

  cancelAllUploads() {
    let canceledCount = 0;
    for (const [filename, source] of this.activeUploads) {
      source.cancel('All uploads canceled');
      this.activeUploads.delete(filename);
      canceledCount++;
    }

    return {
      success: true,
      message: `${canceledCount}개의 업로드가 취소되었습니다.`,
      canceledCount,
    };
  }

  getErrorMessage(status) {
    switch (status) {
      case 400:
        return '잘못된 요청입니다.';
      case 401:
        return '인증이 필요합니다.';
      case 403:
        return '파일에 접근할 권한이 없습니다.';
      case 404:
        return '파일을 찾을 수 없습니다.';
      case 413:
        return '파일이 너무 큽니다.';
      case 415:
        return '지원하지 않는 파일 형식입니다.';
      case 500:
        return '서버 오류가 발생했습니다.';
      case 503:
        return '서비스를 일시적으로 사용할 수 없습니다.';
      default:
        return '알 수 없는 오류가 발생했습니다.';
    }
  }

  // Presigned URL 요청
  async getPresignedUploadUrl(file) {
    try {
      const user = authService.getCurrentUser();
      if (!user?.token || !user?.sessionId) {
        return {
          success: false,
          message: '인증 정보가 없습니다.',
        };
      }

      const requestUrl = this.baseUrl
        ? `${this.baseUrl}/api/files/presigned-url`
        : '/api/files/presigned-url';

      const response = await axios.post(
        requestUrl,
        {
          filename: file.name,
          mimetype: file.type,
          size: file.size,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-auth-token': user.token,
            'x-session-id': user.sessionId,
          },
          withCredentials: true,
        }
      );

      if (!response.data.success) {
        return {
          success: false,
          message:
            response.data.message || 'Presigned URL 생성에 실패했습니다.',
        };
      }

      return {
        success: true,
        data: response.data.data,
      };
    } catch (error) {
      console.error('Presigned URL request error:', error);
      return {
        success: false,
        message:
          error.response?.data?.message ||
          'Presigned URL 요청 중 오류가 발생했습니다.',
      };
    }
  }

  // S3에 직접 업로드
  async uploadToS3(uploadUrl, file, onProgress, cancelToken) {
    try {
      await axios.put(uploadUrl, file, {
        headers: {
          'Content-Type': file.type,
        },
        cancelToken: cancelToken,
        onUploadProgress: (progressEvent) => {
          if (onProgress) {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            onProgress(percentCompleted);
          }
        },
      });

      return { success: true };
    } catch (error) {
      console.error('S3 upload error:', error);
      return {
        success: false,
        message:
          error.response?.data?.message || 'S3 업로드 중 오류가 발생했습니다.',
      };
    }
  }

  // 업로드 완료 알림
  async notifyUploadComplete(file, s3Key) {
    try {
      const user = authService.getCurrentUser();
      if (!user?.token || !user?.sessionId) {
        return {
          success: false,
          message: '인증 정보가 없습니다.',
        };
      }

      const requestUrl = this.baseUrl
        ? `${this.baseUrl}/api/files/upload-complete`
        : '/api/files/upload-complete';

      const response = await axios.post(
        requestUrl,
        {
          s3Key: s3Key,
          filename: s3Key.split('/').pop(), // s3Key에서 파일명 추출
          originalname: file.name,
          mimetype: file.type,
          size: file.size,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-auth-token': user.token,
            'x-session-id': user.sessionId,
          },
          withCredentials: true,
        }
      );

      if (!response.data.success) {
        return {
          success: false,
          message: response.data.message || '업로드 완료 처리에 실패했습니다.',
        };
      }

      return response.data;
    } catch (error) {
      console.error('Upload completion notification error:', error);
      return {
        success: false,
        message:
          error.response?.data?.message ||
          '업로드 완료 알림 중 오류가 발생했습니다.',
      };
    }
  }

  isRetryableError(error) {
    if (!error.response) {
      return true; // 네트워크 오류는 재시도 가능
    }

    const status = error.response.status;
    return [408, 429, 500, 502, 503, 504].includes(status);
  }
}

export default new FileService();
