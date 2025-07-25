/**
 * 전역 에러 서비스
 * 코드 어디서든 에러 모달을 띄울 수 있는 API 제공
 */

import globalErrorHandler from './globalErrorHandler';

class ErrorService {
  constructor() {
    this.recentErrors = new Map(); // 중복 에러 방지를 위한 캐시
    this.duplicateThreshold = 2000; // 2초 내 중복 에러 방지
    this.globalModeEnabled = true; // 전역 모달 모드 활성화
  }

  /**
   * 에러 모달 표시 (메인 API)
   * @param {string} message - 에러 메시지
   * @param {string} type - 에러 타입 (manual, api, network, validation 등)
   * @param {Object} options - 추가 옵션
   */
  showError(message, type = 'manual', options = {}) {
    // 빈 메시지 처리
    if (!message || typeof message !== 'string') {
      message = '알 수 없는 오류가 발생했습니다.';
    }

    // 중복 에러 체크
    if (this.isDuplicateError(message)) {
      console.log('Duplicate error prevented:', message);
      return;
    }

    // 에러 기록
    this.recordError(message);

    // 전역 에러 핸들러를 통해 에러 표시
    globalErrorHandler.handleError({
      type,
      message: this.formatMessage(message, type),
      source: options.source || 'ErrorService',
      ...options
    });
  }

  /**
   * API 에러 전용 메서드
   * @param {Object} error - axios 에러 객체 또는 에러 메시지
   * @param {string} operation - 수행 중이던 작업명
   */
  showApiError(error, operation = '요청') {
    let message = `${operation} 처리 중 오류가 발생했습니다.`;
    
    if (error?.response) {
      const { status, data } = error.response;
      
      switch (status) {
        case 400:
          message = data?.message || '잘못된 요청입니다.';
          break;
        case 401:
          message = '인증이 필요합니다. 다시 로그인해주세요.';
          break;
        case 403:
          message = '접근 권한이 없습니다.';
          break;
        case 404:
          message = '요청한 리소스를 찾을 수 없습니다.';
          break;
        case 408:
          message = '요청 시간이 초과되었습니다.';
          break;
        case 429:
          message = '너무 많은 요청입니다. 잠시 후 다시 시도해주세요.';
          break;
        case 500:
          message = '서버 내부 오류가 발생했습니다.';
          break;
        case 502:
          message = '서버 연결에 문제가 있습니다.';
          break;
        case 503:
          message = '서비스를 일시적으로 사용할 수 없습니다.';
          break;
        default:
          message = data?.message || `서버 오류가 발생했습니다. (${status})`;
      }
    } else if (error?.code === 'ECONNABORTED') {
      message = '요청 시간이 초과되었습니다.';
    } else if (error?.code === 'NETWORK_ERROR') {
      message = '네트워크 연결을 확인해주세요.';
    } else if (error?.message) {
      message = error.message;
    }

    this.showError(message, 'api', { 
      source: 'API',
      operation,
      statusCode: error?.response?.status,
      errorCode: error?.code
    });
  }

  /**
   * 네트워크 에러 전용 메서드
   * @param {string} operation - 수행 중이던 작업명
   */
  showNetworkError(operation = '네트워크 작업') {
    this.showError(
      `${operation} 중 네트워크 연결 문제가 발생했습니다. 인터넷 연결을 확인해주세요.`,
      'network',
      { source: 'Network' }
    );
  }

  /**
   * 검증 에러 전용 메서드
   * @param {string|Array} validationErrors - 검증 에러 메시지들
   */
  showValidationError(validationErrors) {
    let message = '입력값을 확인해주세요.';
    
    if (Array.isArray(validationErrors)) {
      message = validationErrors.join('\n');
    } else if (typeof validationErrors === 'string') {
      message = validationErrors;
    }

    this.showError(message, 'validation', { source: 'Validation' });
  }

  /**
   * 파일 처리 에러 전용 메서드
   * @param {string} message - 에러 메시지
   * @param {string} fileName - 파일명
   */
  showFileError(message, fileName = '') {
    const fullMessage = fileName 
      ? `파일 "${fileName}" 처리 중 오류: ${message}`
      : `파일 처리 중 오류: ${message}`;
      
    this.showError(fullMessage, 'file', { 
      source: 'File',
      fileName 
    });
  }

  /**
   * 메시지 포맷팅
   * @param {string} message - 원본 메시지
   * @param {string} type - 에러 타입
   */
  formatMessage(message, type) {
    // 메시지 길이 제한
    if (message.length > 150) {
      message = message.substring(0, 147) + '...';
    }

    // 타입별 접두사 추가 (개발 모드에서만)
    if (process.env.NODE_ENV === 'development') {
      const prefixes = {
        api: '[API]',
        network: '[네트워크]',
        validation: '[검증]',
        file: '[파일]',
        runtime: '[런타임]',
        promise: '[Promise]'
      };
      
      const prefix = prefixes[type];
      if (prefix && !message.startsWith(prefix)) {
        message = `${prefix} ${message}`;
      }
    }

    return message;
  }

  /**
   * 중복 에러 체크
   * @param {string} message - 에러 메시지
   */
  isDuplicateError(message) {
    const now = Date.now();
    const lastOccurrence = this.recentErrors.get(message);
    
    return lastOccurrence && (now - lastOccurrence) < this.duplicateThreshold;
  }

  /**
   * 에러 기록
   * @param {string} message - 에러 메시지
   */
  recordError(message) {
    this.recentErrors.set(message, Date.now());
    
    // 오래된 에러 기록 정리 (메모리 누수 방지)
    if (this.recentErrors.size > 50) {
      const oldestTime = Date.now() - this.duplicateThreshold * 2;
      for (const [msg, time] of this.recentErrors.entries()) {
        if (time < oldestTime) {
          this.recentErrors.delete(msg);
        }
      }
    }
  }

  /**
   * 모든 에러 기록 초기화
   */
  clearErrorHistory() {
    this.recentErrors.clear();
  }

  /**
   * 전역 모드 활성화/비활성화
   * @param {boolean} enabled - 전역 모드 활성화 여부
   */
  setGlobalMode(enabled) {
    this.globalModeEnabled = enabled;
  }

  /**
   * 전역 모드 상태 확인
   */
  isGlobalModeEnabled() {
    return this.globalModeEnabled;
  }

  /**
   * 에러 통계 조회 (개발 모드 전용)
   */
  getErrorStats() {
    if (process.env.NODE_ENV !== 'development') {
      return null;
    }

    return {
      totalErrors: this.recentErrors.size,
      globalModeEnabled: this.globalModeEnabled,
      recentErrors: Array.from(this.recentErrors.entries())
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([message, timestamp]) => ({
          message,
          timestamp,
          timeAgo: Date.now() - timestamp
        }))
    };
  }
}

// 싱글톤 인스턴스 생성
const errorService = new ErrorService();

export default errorService;
export { ErrorService };