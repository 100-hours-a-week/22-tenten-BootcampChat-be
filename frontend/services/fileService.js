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

      const fileData = completionResponse.file;
      return {
        success: true,
        data: {
          ...completionResponse,
          file: {
            ...fileData,
            url: this.getFileUrl(fileData.filename, true),
          },
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

  // Legacy: 기존 multipart 업로드 방식 (호환성용)
  async uploadFileViaMultipart(file, onProgress) {
    try {
      const user = authService.getCurrentUser();
      if (!user?.token || !user?.sessionId) {
        return {
          success: false,
          message: '인증 정보가 없습니다.',
        };
      }

      const formData = new FormData();
      formData.append('file', file);

      const source = CancelToken.source();
      this.activeUploads.set(file.name, source);

      const uploadUrl = this.baseUrl
        ? `${this.baseUrl}/api/files/upload`
        : '/api/files/upload';

      const response = await axios.post(uploadUrl, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'x-auth-token': user.token,
          'x-session-id': user.sessionId,
        },
        cancelToken: source.token,
        withCredentials: true,
        onUploadProgress: (progressEvent) => {
          if (onProgress) {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            onProgress(percentCompleted);
          }
        },
      });

      this.activeUploads.delete(file.name);

      if (!response.data || !response.data.success) {
        return {
          success: false,
          message: response.data?.message || '파일 업로드에 실패했습니다.',
        };
      }

      const fileData = response.data.file;
      return {
        success: true,
        data: {
          ...response.data,
          file: {
            ...fileData,
            url: this.getFileUrl(fileData.filename, true),
          },
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
            return this.uploadFileViaMultipart(file, onProgress);
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
  async downloadFile(filename, originalname, file = null) {
    try {
      const user = authService.getCurrentUser();
      if (!user?.token || !user?.sessionId) {
        return {
          success: false,
          message: '인증 정보가 없습니다.',
        };
      }

      // S3 파일인 경우 presigned URL 사용
      if (file && (file.uploadMethod === 's3_presigned' || file.s3Key)) {
        const downloadResult = await this.getS3DownloadUrl(filename);
        if (!downloadResult.success) {
          return downloadResult;
        }

        // S3 presigned URL로 직접 다운로드
        window.open(downloadResult.downloadUrl, '_blank');
        return { success: true };
      }

      // 로컬 파일 다운로드 로직
      return this.downloadLocalFile(filename, originalname);
    } catch (error) {
      return this.handleDownloadError(error);
    }
  }

  // 로컬 파일 다운로드 (레거시)
  async downloadLocalFile(filename, originalname) {
    try {
      const user = authService.getCurrentUser();
      if (!user?.token || !user?.sessionId) {
        return {
          success: false,
          message: '인증 정보가 없습니다.',
        };
      }

      // 파일 존재 여부 먼저 확인
      const downloadUrl = this.getFileUrl(filename, false);
      const checkResponse = await axios.head(downloadUrl, {
        headers: {
          'x-auth-token': user.token,
          'x-session-id': user.sessionId,
        },
        validateStatus: (status) => status < 500,
        withCredentials: true,
      });

      if (checkResponse.status === 404) {
        return {
          success: false,
          message: '파일을 찾을 수 없습니다.',
        };
      }

      if (checkResponse.status === 403) {
        return {
          success: false,
          message: '파일에 접근할 권한이 없습니다.',
        };
      }

      if (checkResponse.status !== 200) {
        return {
          success: false,
          message: '파일 다운로드 준비 중 오류가 발생했습니다.',
        };
      }

      const response = await axios({
        method: 'GET',
        url: downloadUrl,
        headers: {
          'x-auth-token': user.token,
          'x-session-id': user.sessionId,
        },
        responseType: 'blob',
        timeout: 30000,
        withCredentials: true,
      });

      const contentType = response.headers['content-type'];
      const contentDisposition = response.headers['content-disposition'];
      let finalFilename = originalname;

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(
          /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/
        );
        if (filenameMatch) {
          finalFilename = decodeURIComponent(
            filenameMatch[1] || filenameMatch[2] || filenameMatch[3]
          );
        }
      }

      const blob = new Blob([response.data], {
        type: contentType || 'application/octet-stream',
      });

      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = finalFilename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setTimeout(() => {
        window.URL.revokeObjectURL(blobUrl);
      }, 100);

      return { success: true };
    } catch (error) {
      if (error.response?.status === 401) {
        try {
          const refreshed = await authService.refreshToken();
          if (refreshed) {
            return this.downloadLocalFile(filename, originalname);
          }
        } catch (refreshError) {
          return {
            success: false,
            message: '인증이 만료되었습니다. 다시 로그인해주세요.',
          };
        }
      }

      return this.handleDownloadError(error);
    }
  }

  getFileUrl(filename, forPreview = false) {
    if (!filename) return '';

    const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
    const endpoint = forPreview ? 'view' : 'download';
    return `${baseUrl}/api/files/${endpoint}/${filename}`;
  }

  getPreviewUrl(file, withAuth = true) {
    if (!file?.filename) return '';

    // S3 파일인 경우 S3 URL 사용
    if (file.uploadMethod === 's3_presigned' || file.s3Key) {
      return this.getS3PreviewUrl(file.filename);
    }

    // 로컬 파일
    const baseUrl = `${process.env.NEXT_PUBLIC_API_URL}/api/files/view/${file.filename}`;

    if (!withAuth) return baseUrl;

    const user = authService.getCurrentUser();
    if (!user?.token || !user?.sessionId) return baseUrl;

    // URL 객체 생성 전 프로토콜 확인
    const url = new URL(baseUrl);
    url.searchParams.append('token', encodeURIComponent(user.token));
    url.searchParams.append('sessionId', encodeURIComponent(user.sessionId));

    return url.toString();
  }

  // S3 미리보기 URL 생성
  async getS3PreviewUrl(filename) {
    try {
      const user = authService.getCurrentUser();
      if (!user?.token || !user?.sessionId) {
        return '';
      }

      const requestUrl = this.baseUrl
        ? `${this.baseUrl}/api/files/s3-url/view/${filename}`
        : `/api/files/s3-url/view/${filename}`;

      const response = await axios.get(requestUrl, {
        headers: {
          'x-auth-token': user.token,
          'x-session-id': user.sessionId,
        },
        withCredentials: true,
      });

      if (response.data.success) {
        return response.data.viewUrl;
      }

      return '';
    } catch (error) {
      console.error('S3 preview URL generation error:', error);
      return '';
    }
  }

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
