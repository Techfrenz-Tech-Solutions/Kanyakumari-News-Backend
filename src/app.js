'use strict';

/**
 * Express application assembly.
 * Kept separate from server.js so tests can boot the app without listening.
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const path = require('node:path');

const env = require('./config/env');
const prisma = require('./config/prisma');
const logger = require('./utils/logger');
const { globalLimiter } = require('./middleware/rateLimiters');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

// Route modules
const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin/index');
const publicRouter = require('./routes/public/index');

const app = express();

// Behind Nginx in production — resolve client IP from X-Forwarded-For.
app.set('trust proxy', env.TRUST_PROXY);
app.disable('x-powered-by');

// ── Global middleware ────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false, // API only; the SPA sets its own CSP
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow SPA-origin img/media fetches
  })
);
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow same-origin / curl / server-to-server (no Origin header)
      if (!origin || env.CORS_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === '/api/health' },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
  })
);
app.use(globalLimiter);

// ── Static uploads (no directory listing, no execution — files only) ─────────
app.use('/uploads', express.static(path.resolve(env.UPLOAD_DIR), { fallthrough: false, dotfiles: 'ignore', index: false }));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api', healthRouter);
app.use('/api/admin/auth', authRouter); // per-route limiters live inside the router
app.use('/api/admin', adminRouter);
app.use('/api', publicRouter);

// ── Fallbacks ────────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

/**
 * Attach request-scoped helpers used across controllers:
 *  - req.ipHash  : HMAC-hashed client IP
 */
app.use((req, res, next) => {
  // (kept as a named middleware for clarity; ipHash computed in services when needed)
  next();
});

module.exports = { app, prisma };
