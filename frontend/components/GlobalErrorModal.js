import React, { useEffect, useState } from 'react';
import { ErrorCircleIcon } from '@vapor-ui/icons';
import { Text } from '@vapor-ui/core';
import { Flex } from './ui/Layout';

/**
 * 전역 에러 모달 컴포넌트
 * .alert-danger 스타일을 적용하고 1초 후 자동으로 닫힘
 */
const GlobalErrorModal = ({ isOpen, onClose, message, errorInfo }) => {
  const [timeLeft, setTimeLeft] = useState(1);

  useEffect(() => {
    if (!isOpen) {
      setTimeLeft(1);
      return;
    }

    // 1초 카운트다운 및 자동 닫힘
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, onClose]);

  // ESC 키로 모달 닫기
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    
    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }
    
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1060, // 다른 모달보다 위에 표시
        padding: 'var(--vapor-space-200)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="alert-danger"
        style={{
          backgroundColor: 'rgba(223, 51, 55, 0.1)',
          borderColor: 'rgba(223, 51, 55, 0.2)',
          color: 'var(--vapor-color-danger)',
          border: '2px solid rgba(223, 51, 55, 0.3)',
          borderRadius: 'var(--vapor-radius-lg)',
          boxShadow: '0 10px 25px rgba(223, 51, 55, 0.2)',
          maxWidth: '500px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: 'var(--vapor-space-400)',
          position: 'relative',
          animation: 'globalErrorSlideIn 0.3s ease-out'
        }}
      >
        {/* 카운트다운 표시 */}
        <div
          style={{
            position: 'absolute',
            top: 'var(--vapor-space-200)',
            right: 'var(--vapor-space-200)',
            backgroundColor: 'rgba(223, 51, 55, 0.2)',
            borderRadius: '50%',
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            fontWeight: 'bold',
            color: 'var(--vapor-color-danger)'
          }}
        >
          {timeLeft}
        </div>

        <Flex align="flex-start" gap="300">
          {/* 에러 아이콘 */}
          <div style={{ flexShrink: 0, marginTop: '2px' }}>
            <ErrorCircleIcon 
              size={24} 
              style={{ 
                color: 'var(--vapor-color-danger)',
                filter: 'drop-shadow(0 2px 4px rgba(223, 51, 55, 0.3))'
              }} 
            />
          </div>

          {/* 에러 메시지 */}
          <div style={{ flex: 1 }}>
            <Text 
              typography="subtitle2" 
              style={{ 
                fontWeight: 600, 
                marginBottom: 'var(--vapor-space-100)',
                color: 'var(--vapor-color-danger)'
              }}
            >
              오류 발생
            </Text>
            
            <Text 
              typography="body2" 
              style={{ 
                lineHeight: 1.5,
                color: 'var(--vapor-color-danger)',
                wordBreak: 'break-word'
              }}
            >
              {message || '알 수 없는 오류가 발생했습니다.'}
            </Text>

            {/* 개발 모드에서 추가 정보 표시 */}
            {process.env.NODE_ENV === 'development' && errorInfo && (
              <div style={{ marginTop: 'var(--vapor-space-200)' }}>
                <Text 
                  typography="body3" 
                  style={{ 
                    fontSize: '11px',
                    opacity: 0.8,
                    fontFamily: 'monospace',
                    color: 'var(--vapor-color-danger)'
                  }}
                >
                  타입: {errorInfo.type} | 시간: {new Date(errorInfo.timestamp).toLocaleTimeString()}
                </Text>
              </div>
            )}
          </div>
        </Flex>

        {/* 클릭해서 닫기 안내 */}
        <div style={{ 
          marginTop: 'var(--vapor-space-300)',
          textAlign: 'center'
        }}>
          <Text 
            typography="body3" 
            style={{ 
              fontSize: '11px',
              opacity: 0.7,
              color: 'var(--vapor-color-danger)'
            }}
          >
            클릭하거나 ESC를 눌러 닫기
          </Text>
        </div>
      </div>

      {/* 애니메이션 스타일 추가 */}
      <style jsx>{`
        @keyframes globalErrorSlideIn {
          from {
            opacity: 0;
            transform: scale(0.9) translateY(-20px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

export default GlobalErrorModal;