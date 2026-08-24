'use strict';

const { ZodError } = require('zod');
const { ApiError } = require('../utils/apiError');
const logger = require('../utils/logger');
const env = require('../config/env');

/** 404 for unknown routes (mounted after all routers). */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found`, details: null },
  });
}

/** Central error serializer — one consistent shape, no stack leaks in prod. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
      },
    });
  }

  // Multer errors (file too large, unsupported, etc.)
  if (err.name === 'MulterError') {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({
      success: false,
      error: { code: 'UPLOAD_ERROR', message: err.message, details: null },
    });
  }

  // Prisma known errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: 'Resource already exists (duplicate)', details: null },
    });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Resource not found', details: null },
    });
  }

  const isHttpError = Number.isInteger(err.status) || Number.isInteger(err.statusCode);
  if (isHttpError) {
    const status = err.status || err.statusCode;
    return res.status(status).json({
      success: false,
      error: { code: 'REQUEST_FAILED', message: err.message || 'Request failed', details: null },
    });
  }

  logger.error({ err }, 'unhandled error');
  const message = env.IS_PROD ? 'Internal server error' : err.message;
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message, details: env.IS_PROD ? null : { stack: err.stack } },
  });
}

module.exports = { notFoundHandler, errorHandler };
