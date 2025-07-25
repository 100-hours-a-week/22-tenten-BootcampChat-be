import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { ThemeProvider } from '@vapor-ui/core';
import { createThemeConfig } from '@vapor-ui/core';
import '@vapor-ui/core/styles.css';
import '../styles/globals.css';
import Navbar from '../components/Navbar';
import DuplicateLoginModal from '../components/DuplicateLoginModal'; // DuplicateLoginModal 임포트
import GlobalErrorModal from '../components/GlobalErrorModal'; // GlobalErrorModal 임포트
import globalErrorHandler from '../utils/globalErrorHandler'; // 전역 에러 핸들러 임포트
import authService from '../services/authService'; // authService 임포트

// Create dark theme configuration
const themeConfig = createThemeConfig({
  appearance: 'dark',
  radius: 'md',
  scaling: 1.0,
  colors: {
    primary: '#3b82f6',
    secondary: '#64748b',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    info: '#06b6d4',
  },
});

function MyApp({ Component, pageProps }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [showDuplicateLoginModal, setShowDuplicateLoginModal] = useState(false);
  const [duplicateLoginInfo, setDuplicateLoginInfo] = useState({});
  
  // 전역 에러 모달 상태
  const [showGlobalErrorModal, setShowGlobalErrorModal] = useState(false);
  const [globalErrorInfo, setGlobalErrorInfo] = useState({});

  useEffect(() => {
    setMounted(true);

    // 전역 에러 핸들러 초기화
    globalErrorHandler.init();

    // 중복 로그인 이벤트 리스너 등록
    const handleDuplicateLogin = (event) => {
      console.log('Duplicate login event received in _app.js:', event.detail);
      setDuplicateLoginInfo(event.detail);
      setShowDuplicateLoginModal(true);
    };

    // 세션 종료 이벤트 리스너 등록
    const handleSessionEnded = () => {
      console.log('Session ended event received in _app.js');
      setShowDuplicateLoginModal(false);
      authService.logout(); // 세션 종료 시 로그아웃 처리
    };

    // 전역 에러 이벤트 리스너 등록
    const handleGlobalError = (event) => {
      console.log('Global error event received in _app.js:', event.detail);
      setGlobalErrorInfo(event.detail);
      setShowGlobalErrorModal(true);
    };

    window.addEventListener('duplicateLogin', handleDuplicateLogin);
    window.addEventListener('session_ended', handleSessionEnded);
    window.addEventListener('globalError', handleGlobalError);

    return () => {
      window.removeEventListener('duplicateLogin', handleDuplicateLogin);
      window.removeEventListener('session_ended', handleSessionEnded);
      window.removeEventListener('globalError', handleGlobalError);
      
      // 전역 에러 핸들러 정리
      globalErrorHandler.destroy();
    };
  }, []);

  if (!mounted) {
    return null;
  }

  const showNavbar = !['/', '/register'].includes(router.pathname);

  return (
    <ThemeProvider config={themeConfig}>
      {showNavbar && <Navbar />}
      <Component {...pageProps} />
      
      {/* 중복 로그인 모달 */}
      <DuplicateLoginModal
        isOpen={showDuplicateLoginModal}
        onClose={() => setShowDuplicateLoginModal(false)}
        deviceInfo={duplicateLoginInfo.deviceInfo}
        ipAddress={duplicateLoginInfo.ipAddress}
        onTimeout={() => {
          // 모달 내의 타이머가 0이 되었을 때 처리
          setShowDuplicateLoginModal(false);
          authService.logout(); // 강제 로그아웃
        }}
      />
      
      {/* 전역 에러 모달 */}
      <GlobalErrorModal
        isOpen={showGlobalErrorModal}
        onClose={() => setShowGlobalErrorModal(false)}
        message={globalErrorInfo.message}
        errorInfo={globalErrorInfo}
      />
    </ThemeProvider>
  );
}

export default MyApp;