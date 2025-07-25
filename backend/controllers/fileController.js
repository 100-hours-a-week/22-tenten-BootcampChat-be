// File 모델은 더 이상 사용하지 않음 - Message 모델에 파일 정보 직접 저장
const Message = require('../models/Message');
const Room = require('../models/Room');
const { processFileForRAG } = require('../services/fileService');
const s3Service = require('../services/s3Service');
const { FileTypeValidator } = require('../../shared/fileTypeConfig');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const crypto = require('crypto');
const { uploadDir } = require('../middleware/upload');

const fsPromises = {
  writeFile: promisify(fs.writeFile),
  unlink: promisify(fs.unlink),
  access: promisify(fs.access),
  mkdir: promisify(fs.mkdir),
  rename: promisify(fs.rename)
};

const isPathSafe = (filepath, directory) => {
  const resolvedPath = path.resolve(filepath);
  const resolvedDirectory = path.resolve(directory);
  return resolvedPath.startsWith(resolvedDirectory);
};

const generateSafeFilename = (originalFilename) => {
  const ext = path.extname(originalFilename || '').toLowerCase();
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(8).toString('hex');
  return `${timestamp}_${randomBytes}${ext}`;
};

// 레거시 로컬 파일 함수 제거됨 - S3 전용 아키텍처

// 로컬 업로드 함수 제거됨 - S3 전용 아키텍처
exports.uploadFile = async (req, res) => {
  res.status(501).json({
    success: false,
    message: '로컬 파일 업로드는 지원하지 않습니다. S3 업로드를 사용해주세요.'
  });
};

// 로컬 파일 다운로드 함수 제거됨 - S3 전용 아키텍처
exports.downloadFile = async (req, res) => {
  res.status(501).json({
    success: false,
    message: '로컬 파일 다운로드는 지원하지 않습니다. S3 다운로드를 사용해주세요.'
  });
};

// 로컬 파일 보기 함수 제거됨 - S3 전용 아키텍처
exports.viewFile = async (req, res) => {
  res.status(501).json({
    success: false,
    message: '로컬 파일 보기는 지원하지 않습니다. S3 URL을 직접 사용해주세요.'
  });
};

// 로컬 파일 스트리밍 함수 제거됨 - S3 전용 아키텍처

// S3 다운로드 URL 생성
exports.getS3DownloadUrl = async (req, res) => {
  try {
    const filename = req.params.filename;
    
    // Message에서 파일 정보 조회
    const message = await Message.findOne({ 'file.filename': filename });
    
    if (!message || !message.file) {
      return res.status(404).json({
        success: false,
        message: '파일을 찾을 수 없습니다.'
      });
    }

    const file = message.file;

    // 채팅방 권한 검증
    const room = await Room.findOne({
      _id: message.room,
      participants: req.user.id
    });

    if (!room) {
      return res.status(403).json({
        success: false,
        message: '파일에 접근할 권한이 없습니다.'
      });
    }

    // S3 파일인 경우 presigned URL 생성
    if (file.s3Key) {
      const downloadData = await s3Service.generatePresignedDownloadUrl(
        file.s3Key,
        file.originalname
      );
      
      return res.json({
        success: true,
        downloadUrl: downloadData.downloadUrl,
        expires: downloadData.expires
      });
    }

    // 로컬 파일인 경우 일반 다운로드 URL (레거시)
    const downloadUrl = `${req.protocol}://${req.get('host')}/api/files/download/${file.filename}`;
    res.json({
      success: true,
      downloadUrl: downloadUrl
    });
  } catch (error) {
    console.error('S3 download URL generation error:', error);
    res.status(500).json({
      success: false,
      message: '다운로드 URL 생성 중 오류가 발생했습니다.'
    });
  }
};

// S3 미리보기 URL 생성
exports.getS3ViewUrl = async (req, res) => {
  try {
    const filename = req.params.filename;
    
    // Message에서 파일 정보 조회
    const message = await Message.findOne({ 'file.filename': filename });
    
    if (!message || !message.file) {
      return res.status(404).json({
        success: false,
        message: '파일을 찾을 수 없습니다.'
      });
    }

    const file = message.file;

    // 채팅방 권한 검증
    const room = await Room.findOne({
      _id: message.room,
      participants: req.user.id
    });

    if (!room) {
      return res.status(403).json({
        success: false,
        message: '파일에 접근할 권한이 없습니다.'
      });
    }

    // S3 파일인 경우 S3 URL 반환
    if (file.s3Url) {
      return res.json({
        success: true,
        viewUrl: file.s3Url
      });
    }

    // 로컬 파일인 경우 (레거시)
    const viewUrl = `${req.protocol}://${req.get('host')}/api/files/view/${file.filename}`;
    res.json({
      success: true,
      viewUrl: viewUrl
    });
  } catch (error) {
    console.error('S3 view URL generation error:', error);
    res.status(500).json({
      success: false,
      message: '미리보기 URL 생성 중 오류가 발생했습니다.'
    });
  }
};

const handleFileError = (error, res) => {
  console.error('File operation error:', {
    message: error.message,
    stack: error.stack
  });

  // 에러 상태 코드 및 메시지 매핑
  const errorResponses = {
    'Invalid filename': { status: 400, message: '잘못된 파일명입니다.' },
    'Authentication required': { status: 401, message: '인증이 필요합니다.' },
    'Invalid file path': { status: 400, message: '잘못된 파일 경로입니다.' },
    'File not found in database': { status: 404, message: '파일을 찾을 수 없습니다.' },
    'File message not found': { status: 404, message: '파일 메시지를 찾을 수 없습니다.' },
    'Unauthorized access': { status: 403, message: '파일에 접근할 권한이 없습니다.' },
    'ENOENT': { status: 404, message: '파일을 찾을 수 없습니다.' }
  };

  const errorResponse = errorResponses[error.message] || {
    status: 500,
    message: '파일 처리 중 오류가 발생했습니다.'
  };

  res.status(errorResponse.status).json({
    success: false,
    message: errorResponse.message
  });
};

// S3 Presigned URL 생성
exports.getPresignedUrl = async (req, res) => {
  try {
    const { filename, mimetype, size } = req.body;
    
    if (!filename || !mimetype || !size) {
      return res.status(400).json({
        success: false,
        message: '파일 정보가 누락되었습니다.'
      });
    }

    const result = await s3Service.generatePresignedUploadUrl(
      filename,
      mimetype,
      parseInt(size),
      req.user.id
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Presigned URL generation error:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// S3 업로드 완료 처리
exports.uploadComplete = async (req, res) => {
  try {
    const { s3Key, filename, originalname, mimetype, size } = req.body;

    if (!s3Key || !filename || !originalname || !mimetype || !size) {
      return res.status(400).json({
        success: false,
        message: '업로드 정보가 누락되었습니다.'
      });
    }

    // S3에서 파일 업로드 검증
    const verification = await s3Service.verifyUploadComplete(
      s3Key,
      parseInt(size),
      mimetype
    );

    if (!verification.verified) {
      return res.status(400).json({
        success: false,
        message: '파일 업로드 검증에 실패했습니다.'
      });
    }

    // Get file type validation info
    const validation = FileTypeValidator.validateFile(mimetype, verification.actualSize, originalname);

    // S3 파일 정보를 직접 반환 (File 테이블 사용하지 않음)
    const s3Url = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${s3Key}`;
    
    res.json({
      success: true,
      message: '파일 업로드가 완료되었습니다.',
      data: {
        filename: filename,
        originalname: originalname,
        mimetype: mimetype,
        size: verification.actualSize,
        s3Url: s3Url,
        s3Key: s3Key,
        s3Bucket: process.env.S3_BUCKET_NAME,
        uploadedAt: new Date(),
        category: validation.category || 'other',
        subtype: validation.subtype
      }
    });
  } catch (error) {
    console.error('Upload completion error:', error);
    res.status(500).json({
      success: false,
      message: '업로드 완료 처리 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

exports.deleteFile = async (req, res) => {
  try {
    // 새 아키텍처에서는 파일이 메시지에 직접 저장되므로
    // 개별 파일 삭제는 지원하지 않습니다. 
    // 메시지 삭제를 통해 파일도 함께 삭제됩니다.
    res.status(501).json({
      success: false,
      message: '개별 파일 삭제는 지원하지 않습니다. 메시지를 삭제해주세요.'
    });
  } catch (error) {
    console.error('File deletion error:', error);
    res.status(500).json({
      success: false,
      message: '파일 삭제 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};