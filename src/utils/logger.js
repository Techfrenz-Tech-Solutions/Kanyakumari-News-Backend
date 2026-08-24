'use strict';

/**
 * Pino logger with secret redaction for request logging.
 */
const pino = require('pino');
const env = require('../config/env');

const logger = pino({
  level: env.IS_PROD ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      '*.password',
      '*.passwordHash',
      '*.otp',
      '*.refreshToken',
      '*.token',
      '*.apiKey',
    ],
    censor: '[REDACTED]',
  },
  base: { service: 'kanyakumari-news-backend' },
});

module.exports = logger;
