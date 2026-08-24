'use strict';

const rateLimit = require('express-rate-limit');
const { ApiErrors } = require('../utils/apiError');
const { clientIp } = require('../utils/ipHash');
const env = require('../config/env');

// In tests we exercise the same endpoints repeatedly from 127.0.0.1; rate
// limiting would return 429 and break assertions. No-op the limiters under test.
const testSkip = () => env.IS_TEST;

const json = (req, res) =>
  res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down', details: null } });

/** Global limiter for the whole API. */
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  handler: (req, res) => json(req, res),
  skip: testSkip,
});

/** Admin auth (login/refresh/reset). */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${clientIp(req)}:${(req.body && req.body.email) || ''}`,
  handler: (req, res) => json(req, res),
  skip: (req) => env.IS_TEST || req.path.endsWith('/refresh'), // refresh handled separately
});

/** OTP request — strict per phone + per IP. */
const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${clientIp(req)}:${(req.body && req.body.phone) || ''}`,
  handler: (req, res) => json(req, res),
  skip: testSkip,
});

/** Public search. */
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  handler: (req, res) => json(req, res),
  skip: testSkip,
});

/** Public content endpoints (home, news list, article detail). */
const publicContentLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  handler: (req, res) => json(req, res),
  skip: testSkip,
});

/** Contact form — aggressive. */
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  handler: (req, res) => json(req, res),
  skip: testSkip,
});

/** Comment creation. */
const commentLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  handler: (req, res) => json(req, res),
  skip: testSkip,
});

/** Refresh-token rotation — moderate, per IP. */
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => clientIp(req),
  handler: (req, res) => json(req, res),
  skip: testSkip,
});

module.exports = {
  globalLimiter,
  authLimiter,
  otpLimiter,
  searchLimiter,
  publicContentLimiter,
  contactLimiter,
  commentLimiter,
  refreshLimiter,
};
