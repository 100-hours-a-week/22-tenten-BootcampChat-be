const File = require('../models/File');
const Message = require('../models/Message');
const Room = require('../models/Room');
const { processFileForRAG } = require('../services/fileService');
const s3Service = require('../services/s3Service');
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

// 개선된 파일 정보 조회 함수
const getFileFromRequest = async (req) => {
  try {
    const filename = req.params.filename;
    const token = req.headers['x-auth-token'] || req.query.token;
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    
    if (!filename) {
      throw new Error('Invalid filename');
    }

    if (!token || !sessionId) {
      throw new Error('Authentication required');
    }

    const filePath = path.join(uploadDir, filename);
    if (!isPathSafe(filePath, uploadDir)) {
      throw new Error('Invalid file path');
    }

    await fsPromises.access(filePath, fs.constants.R_OK);

    const file = await File.findOne({ filename: filename });
    if (!file) {
      throw new Error('File not found in database');
    }

    // 채팅방 권한 검증을 위한 메시지 조회
    const message = await Message.findOne({ file: file._id });
    if (!message) {
      throw new Error('File message not found');
    }

    // 사용자가 해당 채팅방의 참가자인지 확인
    const room = await Room.findOne({
      _id: message.room,
      participants: req.user.id
    });

    if (!room) {
      throw new Error('Unauthorized access');
    }

    return { file, filePath };
  } catch (error) {
    console.error('getFileFromRequest error:', {
      filename: req.params.filename,
      error: error.message
    });
    throw error;
  }
};

exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '파일이 선택되지 않았습니다.'
      });
    }

    const safeFilename = generateSafeFilename(req.file.originalname);
    const currentPath = req.file.path;
    const newPath = path.join(uploadDir, safeFilename);

    const file = new File({
      filename: safeFilename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      user: req.user.id,
      path: newPath
    });

    await file.save();
    await fsPromises.rename(currentPath, newPath);

    res.status(200).json({
      success: true,
      message: '파일 업로드 성공',
      file: {
        _id: file._id,
        filename: file.filename,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        uploadDate: file.uploadDate
      }
    });

  } catch (error) {
    console.error('File upload error:', error);
    if (req.file?.path) {
      try {
        await fsPromises.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Failed to delete uploaded file:', unlinkError);
      }
    }
    res.status(500).json({
      success: false,
      message: '파일 업로드 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};

exports.downloadFile = async (req, res) => {
  try {
    const { file, filePath } = await getFileFromRequest(req);
    const contentDisposition = file.getContentDisposition('attachment');

    res.set({
      'Content-Type': file.mimetype,
      'Content-Length': file.size,
      'Content-Disposition': contentDisposition,
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (error) => {
      console.error('File streaming error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: '파일 스트리밍 중 오류가 발생했습니다.'
        });
      }
    });

    fileStream.pipe(res);

  } catch (error) {
    handleFileError(error, res);
  }
};

exports.viewFile = async (req, res) => {
  try {
    const { file, filePath } = await getFileFromRequest(req);

    if (!file.isPreviewable()) {
      return res.status(415).json({
        success: false,
        message: '미리보기를 지원하지 않는 파일 형식입니다.'
      });
    }

    const contentDisposition = file.getContentDisposition('inline');
        
    res.set({
      'Content-Type': file.mimetype,
      'Content-Disposition': contentDisposition,
      'Content-Length': file.size,
      'Cache-Control': 'public, max-age=31536000, immutable'
    });

    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', (error) => {
      console.error('File streaming error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: '파일 스트리밍 중 오류가 발생했습니다.'
        });
      }
    });

    fileStream.pipe(res);

  } catch (error) {
    handleFileError(error, res);
  }
};

const handleFileStream = (fileStream, res) => {
  fileStream.on('error', (error) => {
    console.error('File streaming error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: '파일 스트리밍 중 오류가 발생했습니다.'
      });
    }
  });

  fileStream.pipe(res);
};

// S3 다운로드 URL 생성
exports.getS3DownloadUrl = async (req, res) => {
  try {
    const file = await File.findOne({ filename: req.params.filename });
    
    if (!file) {
      return res.status(404).json({
        success: false,
        message: '파일을 찾을 수 없습니다.'
      });
    }

    // 채팅방 권한 검증
    const message = await Message.findOne({ file: file._id });
    if (message) {
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
    }

    // S3 파일인 경우 presigned URL 생성
    if (file.isS3File()) {
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

    // 로컬 파일인 경우 일반 다운로드 URL
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
    const file = await File.findOne({ filename: req.params.filename });
    
    if (!file) {
      return res.status(404).json({
        success: false,
        message: '파일을 찾을 수 없습니다.'
      });
    }

    if (!file.isPreviewable()) {
      return res.status(415).json({
        success: false,
        message: '미리보기를 지원하지 않는 파일 형식입니다.'
      });
    }

    // 채팅방 권한 검증
    const message = await Message.findOne({ file: file._id });
    if (message) {
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
    }

    // S3 파일인 경우 공개 URL 또는 presigned URL
    if (file.isS3File()) {
      // 공개 버킷인 경우 직접 URL 사용 가능
      const publicUrl = file.getS3PublicUrl();
      if (publicUrl) {
        return res.json({
          success: true,
          viewUrl: publicUrl
        });
      }
      
      // 비공개 버킷인 경우 presigned URL 사용
      const viewData = await s3Service.generatePresignedDownloadUrl(
        file.s3Key,
        file.originalname
      );
      
      return res.json({
        success: true,
        viewUrl: viewData.downloadUrl,
        expires: viewData.expires
      });
    }

    // 로컬 파일인 경우 일반 보기 URL
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

    // 데이터베이스에 파일 정보 저장
    const file = new File({
      filename: filename,
      originalname: originalname,
      mimetype: mimetype,
      size: verification.actualSize,
      user: req.user.id,
      s3Key: s3Key,
      s3Bucket: process.env.S3_BUCKET_NAME,
      uploadMethod: 's3_presigned'
    });

    await file.save();

    res.json({
      success: true,
      message: '파일 업로드가 완료되었습니다.',
      file: {
        _id: file._id,
        filename: file.filename,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        uploadDate: file.uploadDate
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
    const file = await File.findById(req.params.id);
    
    if (!file) {
      return res.status(404).json({
        success: false,
        message: '파일을 찾을 수 없습니다.'
      });
    }

    if (file.user.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: '파일을 삭제할 권한이 없습니다.'
      });
    }

    // S3에서 삭제 (S3 업로드된 파일인 경우)
    if (file.s3Key) {
      try {
        await s3Service.deleteFile(file.s3Key);
      } catch (s3Error) {
        console.error('S3 file deletion error:', s3Error);
      }
    } else {
      // 로컬 파일 삭제 (레거시)
      const filePath = path.join(uploadDir, file.filename);

      if (!isPathSafe(filePath, uploadDir)) {
        return res.status(403).json({
          success: false,
          message: '잘못된 파일 경로입니다.'
        });
      }
      
      try {
        await fsPromises.access(filePath, fs.constants.W_OK);
        await fsPromises.unlink(filePath);
      } catch (unlinkError) {
        console.error('Local file deletion error:', unlinkError);
      }
    }

    await file.deleteOne();

    res.json({
      success: true,
      message: '파일이 삭제되었습니다.'
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