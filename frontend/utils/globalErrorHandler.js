/**
 * 전역 에러 핸들러
 * JavaScript 런타임 에러, Promise rejection, 수동 에러 등을 통합 처리
 */

class GlobalErrorHandler {
  constructor() {
    this.isInitialized = false;
    this.lastErrorTime = 0;
    this.lastErrorMessage = '';
    this.duplicateThreshold = 1000; // 1초 내 같은 에러 중복 방지
  }

  /**
   * 전역 에러 핸들러 초기화
   */
  init() {
    if (this.isInitialized) return;

    // JavaScript 런타임 에러 처리
    window.onerror = (message, source, lineno, colno, error) => {
      console.error('Runtime Error:', { message, source, lineno, colno, error });
      
      this.handleError({
        type: 'runtime',
        message: this.formatRuntimeError(message, source, lineno),
        source,
        lineno,
        colno,
        error
      });
      
      return false; // 기본 에러 처리도 계속 실행
    };

    // Promise rejection 에러 처리  
    window.addEventListener('unhandledrejection', (event) => {
      console.error('Unhandled Promise Rejection:', event.reason);
      
      this.handleError({
        type: 'promise',
        message: this.formatPromiseError(event.reason),
        reason: event.reason
      });
      
      // Promise rejection을 처리했다고 표시하지 않음 (다른 핸들러도 실행되도록)
    });

    // 리소스 로딩 에러 처리 (이미지, 스크립트 등)
    window.addEventListener('error', (event) => {
      if (event.target !== window) {
        console.error('Resource Error:', event);
        
        this.handleError({
          type: 'resource',
          message: `리소스 로딩 실패: ${event.target.tagName}`,
          target: event.target,
          source: event.target.src || event.target.href
        });
      }
    }, true);

    this.isInitialized = true;
    console.log('Global Error Handler initialized');
  }

  /**
   * 에러 처리 핵심 메서드
   */
  handleError(errorInfo) {
    const now = Date.now();
    const errorMessage = errorInfo.message;

    // 중복 에러 방지 (1초 내 같은 메시지)
    if (now - this.lastErrorTime < this.duplicateThreshold && 
        this.lastErrorMessage === errorMessage) {
      return;
    }

    this.lastErrorTime = now;
    this.lastErrorMessage = errorMessage;

    // 에러 타입별 메시지 정제
    const finalMessage = this.refineErrorMessage(errorInfo);

    // 전역 에러 이벤트 발생
    this.dispatchGlobalError(finalMessage, errorInfo);
  }

  /**
   * 런타임 에러 메시지 포맷팅
   */
  formatRuntimeError(message, source, lineno) {
    if (message.includes('Script error')) {
      return '스크립트 실행 중 오류가 발생했습니다.';
    }
    
    if (message.includes('TypeError')) {
      return '데이터 처리 중 오류가 발생했습니다.';
    }
    
    if (message.includes('ReferenceError')) {
      return '필요한 데이터를 찾을 수 없습니다.';
    }
    
    if (message.includes('SyntaxError')) {
      return '데이터 형식 오류가 발생했습니다.';
    }

    return '예상치 못한 오류가 발생했습니다.';
  }

  /**
   * Promise rejection 에러 메시지 포맷팅
   */
  formatPromiseError(reason) {
    if (typeof reason === 'string') {
      return reason;
    }
    
    if (reason && reason.message) {
      if (reason.message.includes('Network')) {
        return '네트워크 연결을 확인해주세요.';
      }
      
      if (reason.message.includes('timeout')) {
        return '요청 시간이 초과되었습니다.';
      }
      
      return reason.message;
    }
    
    if (reason && reason.response) {
      return '서버 요청 처리 중 오류가 발생했습니다.';
    }

    return '비동기 작업 중 오류가 발생했습니다.';
  }

  /**
   * 에러 메시지 정제
   */
  refineErrorMessage(errorInfo) {
    const { type, message } = errorInfo;
    
    // 메시지가 너무 길면 축약
    if (message.length > 100) {
      return message.substring(0, 97) + '...';
    }
    
    // 기술적 용어를 사용자 친화적으로 변경
    return message
      .replace(/undefined/gi, '정의되지 않은 값')
      .replace(/null/gi, '빈 값')
      .replace(/cannot read property/gi, '속성을 읽을 수 없음')
      .replace(/is not a function/gi, '함수가 아님');
  }

  /**
   * 전역 에러 이벤트 발생
   */
  dispatchGlobalError(message, errorInfo) {
    const event = new CustomEvent('globalError', {
      detail: {
        message,
        type: errorInfo.type,
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
        url: window.location.href,
        errorInfo
      }
    });

    window.dispatchEvent(event);
  }

  /**
   * 수동으로 에러 발생 (코드에서 직접 호출)
   */
  static showError(message, type = 'manual') {
    if (!globalErrorHandler.isInitialized) {
      console.warn('Global Error Handler not initialized');
      return;
    }

    globalErrorHandler.handleError({
      type,
      message: message || '알 수 없는 오류가 발생했습니다.'
    });
  }

  /**
   * 에러 핸들러 종료
   */
  destroy() {
    window.onerror = null;
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
    window.removeEventListener('error', this.handleResourceError, true);
    this.isInitialized = false;
    console.log('Global Error Handler destroyed');
  }
}

// 싱글톤 인스턴스 생성
const globalErrorHandler = new GlobalErrorHandler();

export default globalErrorHandler;
export { GlobalErrorHandler };