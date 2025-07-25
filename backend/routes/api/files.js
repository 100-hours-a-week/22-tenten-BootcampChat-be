// backend/routes/api/files.js
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const fileController = require('../../controllers/fileController');
const { upload, errorHandler } = require('../../middleware/upload');

// S3 Presigned URL 요청
router.post('/presigned-url',
  auth,
  fileController.getPresignedUrl
);

// S3 업로드 완료 알림
router.post('/upload-complete',
  auth,
  fileController.uploadComplete
);

// 파일 업로드 (Legacy - 점진적 마이그레이션용)
router.post('/upload',
  auth,
  upload.single('file'),
  errorHandler,
  fileController.uploadFile
);

// S3 파일 다운로드 URL 생성
router.get('/s3-url/download/:filename',
  auth,
  fileController.getS3DownloadUrl
);

// S3 파일 미리보기 URL 생성
router.get('/s3-url/view/:filename',
  auth,
  fileController.getS3ViewUrl
);

// 파일 다운로드 (Legacy)
router.get('/download/:filename',
  auth,
  fileController.downloadFile
);

// 파일 보기 (미리보기용) (Legacy)
router.get('/view/:filename',
  auth,
  fileController.viewFile
);

// 파일 삭제
router.delete('/:id',
  auth,
  fileController.deleteFile
);

module.exports = router;