'use strict';

/**
 * Multer memory storage — files land in a buffer we validate by magic bytes
 * before writing to the uploads/ tree (see mediaService.processUpload).
 *
 * We intentionally use memory (not disk) storage so that untrusted/invalid
 * bytes never touch the public uploads directory. For very large uploads you
 * could swap to disk storage, but current media limits remain memory-safe.
 */
const multer = require('multer');
const env = require('../config/env');
const { ApiErrors } = require('../utils/apiError');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.max(env.MAX_IMAGE_UPLOAD_MB, env.MAX_PDF_UPLOAD_MB, env.MAX_VIDEO_UPLOAD_MB) * 1024 * 1024,
    files: 20,
  },
});

/** Single-file field. Field name defaults to "file". */
function singleFile(field = 'file') {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (err) return next(ApiErrors.badRequest(err.message, 'UPLOAD_ERROR'));
      if (!req.file) return next(ApiErrors.badRequest(`Missing file field "${field}"`));
      return next();
    });
  };
}

/** Multiple files under a field (galleries). */
function arrayFiles(field = 'images', max = 20) {
  return (req, res, next) => {
    upload.array(field, max)(req, res, (err) => {
      if (err) return next(ApiErrors.badRequest(err.message, 'UPLOAD_ERROR'));
      if (!req.files || req.files.length === 0) return next(ApiErrors.badRequest(`Missing file field "${field}"`));
      return next();
    });
  };
}

module.exports = { upload, singleFile, arrayFiles };
