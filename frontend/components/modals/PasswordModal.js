import React, { useState, useEffect } from 'react';
import { 
  Button, 
  TextInput,
  Text, 
  Card,
  Callout
} from '@vapor-ui/core';
import { 
  UnlockIcon,
  ErrorCircleIcon as AlertCircle
} from '@vapor-ui/icons';
import { Stack, HStack } from '../ui/Layout';

const PasswordModal = ({ 
  isOpen = false, 
  onClose, 
  onSubmit, 
  roomName = '', 
  isLoading = false,
  error = null
}) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [inputError, setInputError] = useState('');

  // 모달이 열릴 때마다 상태 초기화
  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setShowPassword(false);
      setInputError('');
    }
  }, [isOpen]);

  // 에러가 변경될 때 입력 에러 업데이트
  useEffect(() => {
    if (error) {
      setInputError(error);
    } else {
      setInputError('');
    }
  }, [error]);

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // 비밀번호 검증
    if (!password.trim()) {
      setInputError('비밀번호를 입력해주세요.');
      return;
    }

    if (password.length < 1) {
      setInputError('비밀번호가 너무 짧습니다.');
      return;
    }

    // 에러 상태 초기화
    setInputError('');
    
    // 부모 컴포넌트로 비밀번호 전달
    onSubmit(password);
  };

  const handleClose = () => {
    if (!isLoading) {
      setPassword('');
      setInputError('');
      onClose();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !isLoading) {
      handleSubmit(e);
    } else if (e.key === 'Escape' && !isLoading) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999
    }}>
      <Card.Root 
        style={{ 
          maxWidth: '400px', 
          width: '90vw',
          margin: '0 auto'
        }}
      >
        <Card.Header>
          <HStack gap="200" align="center" justify="space-between">
            <HStack gap="200" align="center">
              <UnlockIcon size={20} style={{ color: 'var(--vapor-color-primary)' }} />
              <Text typography="heading4">비밀번호 입력</Text>
            </HStack>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              disabled={isLoading}
              style={{ padding: '4px' }}
            >
              ✕
            </Button>
          </HStack>
        </Card.Header>

        <Card.Body>
          <Stack gap="300">
            <Text typography="body2" style={{ color: 'var(--vapor-color-text-muted)' }}>
              <strong>"{roomName}"</strong> 채팅방은 비밀번호로 보호되어 있습니다.
              입장하려면 비밀번호를 입력해주세요.
            </Text>

            {(inputError || error) && (
              <Callout color="danger">
                <HStack gap="150" align="center">
                  <AlertCircle size={16} />
                  <Text>{inputError || error}</Text>
                </HStack>
              </Callout>
            )}

            <form onSubmit={handleSubmit}>
              <Stack gap="300">
                <div style={{ position: 'relative' }}>
                  <TextInput.Root 
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onValueChange={(value) => {
                      setPassword(value);
                      if (inputError) setInputError('');
                    }}
                    disabled={isLoading}
                    placeholder="채팅방 비밀번호를 입력하세요"
                  >
                    <TextInput.Field
                      onKeyDown={handleKeyDown}
                      autoFocus
                      style={{ paddingRight: '60px' }}
                    />
                  </TextInput.Root>
                  <button
                    type="button"
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--vapor-color-text-muted)',
                      fontSize: '12px',
                      padding: '4px 8px',
                      borderRadius: '4px'
                    }}
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isLoading}
                    tabIndex={0}
                    aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                  >
                    {showPassword ? '숨기기' : '보기'}
                  </button>
                </div>

                <Text typography="caption" style={{ color: 'var(--vapor-color-text-muted)' }}>
                  💡 팁: 비밀번호는 대소문자를 구분합니다.
                </Text>
              </Stack>
            </form>
          </Stack>
        </Card.Body>

        <Card.Footer>
          <HStack gap="200" justify="end">
            <Button 
              variant="outline" 
              onClick={handleClose}
              disabled={isLoading}
              size="md"
            >
              취소
            </Button>
            <Button 
              color="primary"
              onClick={handleSubmit}
              disabled={isLoading || !password.trim()}
              loading={isLoading}
              size="md"
            >
              입장하기
            </Button>
          </HStack>
        </Card.Footer>
      </Card.Root>
    </div>
  );
};

export default PasswordModal;