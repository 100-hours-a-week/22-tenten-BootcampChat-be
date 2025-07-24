import React, { useState, useEffect } from 'react';
import { 
  PdfIcon as FileText, 
  ImageIcon as Image, 
  MovieIcon as Film, 
  SoundOnIcon as Music, 
  OpenInNewOutlineIcon as ExternalLink, 
  DownloadIcon as Download,
  ErrorCircleIcon as AlertCircle,
  FolderZipIcon as Archive,
  DocumentIcon as Document,
  CodeIcon as Code
} from '@vapor-ui/icons';
import { Button, Text, Callout } from '@vapor-ui/core';
import PersistentAvatar from '../../common/PersistentAvatar';
import MessageContent from './MessageContent';
import MessageActions from './MessageActions';
import ReadStatus from '../ReadStatus';
import fileService from '../../../services/fileService';
import authService from '../../../services/authService';

const FileMessage = ({ 
  msg = {}, 
  isMine = false, 
  currentUser = null,
  onReactionAdd,
  onReactionRemove,
  room = null,
  messageRef,
  socketRef
}) => {
  const [error, setError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    if (msg?.file) {
      // S3 전용 아키텍처: S3 URL 직접 사용
      const url = msg.file.s3Url || '';
      setPreviewUrl(url);
      console.debug('Preview URL generated:', {
        filename: msg.file.filename,
        s3Url: msg.file.s3Url,
        url
      });
      
      if (!msg.file.s3Url) {
        console.error('File without S3 URL - local files are no longer supported:', msg.file);
        setError('파일 URL이 없습니다. S3 업로드를 사용해주세요.');
      }
    }
  }, [msg?.file]);

  if (!msg?.file) {
    console.error('File data is missing:', msg);
    return null;
  }

  const formattedTime = new Date(msg.timestamp).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(/\./g, '년').replace(/\s/g, ' ').replace('일 ', '일 ');

  const getFileIcon = () => {
    const mimetype = msg.file?.mimetype || '';
    const category = msg.file?.category;
    const iconProps = { className: "w-5 h-5 flex-shrink-0" };

    // Use category if available, otherwise fall back to mimetype
    if (category) {
      switch (category) {
        case 'image':
          return <Image {...iconProps} color="#00C853" />;
        case 'video':
          return <Film {...iconProps} color="#2196F3" />;
        case 'audio':
          return <Music {...iconProps} color="#9C27B0" />;
        case 'document':
          if (mimetype === 'application/pdf') {
            return <FileText {...iconProps} color="#F44336" />;
          }
          return <Document {...iconProps} color="#FF9800" />;
        case 'archive':
          return <Archive {...iconProps} color="#795548" />;
        default:
          return <FileText {...iconProps} color="#ffffff" />;
      }
    }

    // Fallback to mimetype-based detection for legacy files
    if (mimetype.startsWith('image/')) return <Image {...iconProps} color="#00C853" />;
    if (mimetype.startsWith('video/')) return <Film {...iconProps} color="#2196F3" />;
    if (mimetype.startsWith('audio/')) return <Music {...iconProps} color="#9C27B0" />;
    if (mimetype === 'application/pdf') return <FileText {...iconProps} color="#F44336" />;
    if (mimetype.startsWith('application/') && mimetype.includes('zip')) {
      return <Archive {...iconProps} color="#795548" />;
    }
    if (mimetype.startsWith('text/')) return <Code {...iconProps} color="#4CAF50" />;
    
    return <FileText {...iconProps} color="#ffffff" />;
  };

  const getDecodedFilename = (encodedFilename) => {
    try {
      if (!encodedFilename) return 'Unknown File';
      
      const base64 = encodedFilename
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      
      const pad = base64.length % 4;
      const paddedBase64 = pad ? base64 + '='.repeat(4 - pad) : base64;
      
      if (paddedBase64.match(/^[A-Za-z0-9+/=]+$/)) {
        return Buffer.from(paddedBase64, 'base64').toString('utf8');
      }

      return decodeURIComponent(encodedFilename);
    } catch (error) {
      console.error('Filename decoding error:', error);
      return encodedFilename;
    }
  };

  const renderAvatar = () => (
    <PersistentAvatar 
      user={isMine ? currentUser : msg.sender}
      size="md"
      className="flex-shrink-0"
      showInitials={true}
    />
  );

  const handleFileDownload = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    
    try {
      if (!msg.file?.s3Url) {
        throw new Error('파일 URL이 없습니다.');
      }

      // S3 전용 아키텍처: S3 URL 직접 사용
      const link = document.createElement('a');
      link.href = msg.file.s3Url;
      link.download = getDecodedFilename(msg.file.originalname);
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (error) {
      console.error('File download error:', error);
      setError(error.message || '파일 다운로드 중 오류가 발생했습니다.');
    }
  };

  const handleViewInNewTab = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setError(null);

    try {
      if (!msg.file?.s3Url) {
        throw new Error('파일 URL이 없습니다.');
      }

      // S3 전용 아키텍처: S3 URL 직접 사용
      const newWindow = window.open(msg.file.s3Url, '_blank');
      if (!newWindow) {
        throw new Error('팝업이 차단되었습니다. 팝업 차단을 해제해주세요.');
      }
      newWindow.opener = null;
    } catch (error) {
      console.error('File view error:', error);
      setError(error.message || '파일 보기 중 오류가 발생했습니다.');
    }
  };

  const renderImagePreview = (originalname) => {
    try {
      if (!msg?.file?.s3Url) {
        console.error('S3 URL missing for image file:', msg?.file);
        return (
          <div className="flex items-center justify-center h-full bg-gray-100">
            <Image className="w-8 h-8 text-gray-400" />
            <span className="ml-2 text-sm text-gray-500">이미지 URL 없음</span>
          </div>
        );
      }

      return (
        <div className="bg-transparent-pattern">
          <img 
            src={msg.file.s3Url}
            alt={originalname}
            className="object-cover rounded-sm"
            onLoad={() => {
              console.debug('Image loaded successfully:', originalname);
            }}
            onError={(e) => {
              console.error('Image load error:', {
                error: e.error,
                originalname,
                src: e.target.src,
                s3Url: msg.file.s3Url
              });
              e.target.onerror = null; 
              e.target.src = '/images/placeholder-image.png';
              setError('이미지를 불러올 수 없습니다.');
            }}
            loading="lazy"
          />
        </div>
      );
    } catch (error) {
      console.error('Image preview error:', error);
      setError(error.message || '이미지 미리보기를 불러올 수 없습니다.');
      return (
        <div className="flex items-center justify-center h-full bg-gray-100">
          <Image className="w-8 h-8 text-gray-400" />
        </div>
      );
    }
  };

  const renderFilePreview = () => {
    const mimetype = msg.file?.mimetype || '';
    const category = msg.file?.category || 'other';
    const originalname = getDecodedFilename(msg.file?.originalname || 'Unknown File');
    const size = fileService.formatFileSize(msg.file?.size || 0);
    const metadata = msg.file?.metadata || {};
    
    // Format additional metadata info
    const getMetadataInfo = () => {
      const info = [];
      
      if (metadata.dimensions?.width && metadata.dimensions?.height) {
        info.push(`${metadata.dimensions.width}×${metadata.dimensions.height}`);
      }
      
      if (metadata.duration) {
        const hours = Math.floor(metadata.duration / 3600);
        const minutes = Math.floor((metadata.duration % 3600) / 60);
        const seconds = Math.floor(metadata.duration % 60);
        
        if (hours > 0) {
          info.push(`${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
        } else {
          info.push(`${minutes}:${seconds.toString().padStart(2, '0')}`);
        }
      }
      
      if (metadata.pageCount) {
        info.push(`${metadata.pageCount} 페이지`);
      }
      
      return info.join(' • ');
    };
    
    const metadataInfo = getMetadataInfo();
    
    const FileActions = () => (
      <div className="file-actions mt-2 pt-2 border-t border-gray-200">
        <Button
          size="sm"
          variant="outline"
          onClick={handleViewInNewTab}
          title="새 탭에서 보기"
        >
          <ExternalLink size={16} />
          <span>새 탭에서 보기</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleFileDownload}
          title="다운로드"
        >
          <Download size={16} />
          <span>다운로드</span>
        </Button>
      </div>
    );

    const previewWrapperClass = 
      "overflow-hidden";
    const fileInfoClass = 
      "flex items-center gap-3 p-1 mt-2";

    if (mimetype.startsWith('image/')) {
      return (
        <div className={previewWrapperClass}>
          {renderImagePreview(originalname)}
          <div className={fileInfoClass}>
            <div className="flex-1 min-w-0">
              <Text typography="body2" className="font-medium truncate">{getFileIcon()} {originalname}</Text>
              <div className="text-sm text-muted">
                <span>{size}</span>
                {metadataInfo && <span className="ml-2">{metadataInfo}</span>}
              </div>
            </div>
          </div>
          <FileActions />
        </div>
      );
    }

    if (mimetype.startsWith('video/')) {
      return (
        <div className={previewWrapperClass}>
          <div>
            {msg.file.s3Url ? (
              <video 
                className="object-cover rounded-sm"
                controls
                preload="metadata"
                aria-label={`${originalname} 비디오`}
              >
                <source src={msg.file.s3Url} type={mimetype} />
                <track kind="captions" />
                비디오를 재생할 수 없습니다.
              </video>
            ) : (
              <div className="flex items-center justify-center h-full">
                <Film className="w-8 h-8 text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">비디오 URL 없음</span>
              </div>
            )}
          </div>
          <div className={fileInfoClass}>
            <div className="flex-1 min-w-0">
              <Text typography="body2" className="font-medium truncate">{getFileIcon()} {originalname}</Text>
              <div className="text-sm text-muted">
                <span>{size}</span>
                {metadataInfo && <span className="ml-2">{metadataInfo}</span>}
              </div>
            </div>
          </div>
          <FileActions />
        </div>
      );
    }

    if (mimetype.startsWith('audio/')) {
      return (
        <div className={previewWrapperClass}>
          <div className={fileInfoClass}>
            <div className="flex-1 min-w-0">
              <Text typography="body2" className="font-medium truncate">{getFileIcon()} {originalname}</Text>
              <div className="text-sm text-muted">
                <span>{size}</span>
                {metadataInfo && <span className="ml-2">{metadataInfo}</span>}
              </div>
            </div>
          </div>
          <div className="px-3 pb-3">
            {msg.file.s3Url ? (
              <audio 
                className="w-full"
                controls
                preload="metadata"
                aria-label={`${originalname} 오디오`}
              >
                <source src={msg.file.s3Url} type={mimetype} />
                오디오를 재생할 수 없습니다.
              </audio>
            ) : (
              <div className="text-center text-gray-500">
                오디오 URL이 없습니다.
              </div>
            )}
          </div>
          <FileActions />
        </div>
      );
    }

    // Handle PDF files specially
    if (mimetype === 'application/pdf') {
      return (
        <div className={previewWrapperClass}>
          <div className={fileInfoClass}>
            <div className="flex-1 min-w-0">
              <Text typography="body2" className="font-medium truncate">{getFileIcon()} {originalname}</Text>
              <div className="text-sm text-muted">
                <span>{size}</span>
                {metadataInfo && <span className="ml-2">{metadataInfo}</span>}
              </div>
            </div>
          </div>
          <div className="p-3 bg-gray-50 rounded text-center">
            <FileText className="w-12 h-12 mx-auto mb-2 text-red-600" />
            <Text typography="body2" className="text-gray-600">PDF 문서</Text>
          </div>
          <FileActions />
        </div>
      );
    }

    // Handle archive files
    if (category === 'archive' || mimetype.includes('zip') || mimetype.includes('rar') || mimetype.includes('7z')) {
      return (
        <div className={previewWrapperClass}>
          <div className={fileInfoClass}>
            <div className="flex-1 min-w-0">
              <Text typography="body2" className="font-medium truncate">{getFileIcon()} {originalname}</Text>
              <div className="text-sm text-muted">
                <span>{size}</span>
                {metadataInfo && <span className="ml-2">{metadataInfo}</span>}
              </div>
            </div>
          </div>
          <div className="p-3 bg-gray-50 rounded text-center">
            <Archive className="w-12 h-12 mx-auto mb-2 text-brown-600" />
            <Text typography="body2" className="text-gray-600">압축 파일</Text>
          </div>
          <FileActions />
        </div>
      );
    }

    // Handle text files and documents
    if (mimetype.startsWith('text/') || (category === 'document' && mimetype !== 'application/pdf')) {
      return (
        <div className={previewWrapperClass}>
          <div className={fileInfoClass}>
            <div className="flex-1 min-w-0">
              <Text typography="body2" className="font-medium truncate">{getFileIcon()} {originalname}</Text>
              <div className="text-sm text-muted">
                <span>{size}</span>
                {metadataInfo && <span className="ml-2">{metadataInfo}</span>}
              </div>
            </div>
          </div>
          <div className="p-3 bg-gray-50 rounded text-center">
            <Document className="w-12 h-12 mx-auto mb-2 text-orange-600" />
            <Text typography="body2" className="text-gray-600">
              {category === 'document' ? '문서 파일' : '텍스트 파일'}
            </Text>
          </div>
          <FileActions />
        </div>
      );
    }

    // Default fallback for other file types
    return (
      <div className={previewWrapperClass}>
        <div className={fileInfoClass}>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{getFileIcon()} {originalname}</div>
            <div className="text-sm text-muted">
              <span>{size}</span>
              {metadataInfo && <span className="ml-2">{metadataInfo}</span>}
            </div>
          </div>
        </div>
        <FileActions />
      </div>
    );
  };

  return (
    <div className="messages">
      <div className={`message-group ${isMine ? 'mine' : 'yours'}`}>
        <div className="message-sender-info">
          {renderAvatar()}
          <span className="sender-name">
            {isMine ? '나' : msg.sender?.name}
          </span>
        </div>
        <div className={`message-bubble ${isMine ? 'message-mine' : 'message-other'} last file-message`}>
          <div className="message-content" data-testid="message-content">
            {error && (
              <Callout color="danger" className="mb-3 d-flex align-items-center">
                <AlertCircle className="w-4 h-4 me-2" />
                <span>{error}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ms-auto"
                  aria-label="Close"
                  onClick={() => setError(null)}
                >
                  ×
                </Button>
              </Callout>
            )}
            {renderFilePreview()}
            {msg.content && (
              <div className="mt-3">
                <MessageContent content={msg.content} />
              </div>
            )}
          </div>
          <div className="message-footer">
            <div 
              className="message-time mr-3" 
              title={new Date(msg.timestamp).toLocaleString('ko-KR')}
            >
              {formattedTime}
            </div>
            <ReadStatus 
              messageType={msg.type}
              participants={room.participants}
              readers={msg.readers}
              messageId={msg._id}
              messageRef={messageRef}
              currentUserId={currentUser.id}
              socketRef={socketRef}
            />
          </div>
        </div>
        <MessageActions 
          messageId={msg._id}
          messageContent={msg.content}
          reactions={msg.reactions}
          currentUserId={currentUser?.id}
          onReactionAdd={onReactionAdd}
          onReactionRemove={onReactionRemove}
          isMine={isMine}
          room={room}
        />        
      </div>
    </div>
  );
};

FileMessage.defaultProps = {
  msg: {
    file: {
      mimetype: '',
      filename: '',
      originalname: '',
      size: 0
    }
  },
  isMine: false,
  currentUser: null
};

export default React.memo(FileMessage);