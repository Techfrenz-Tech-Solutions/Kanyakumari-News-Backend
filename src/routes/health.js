'use strict';

const express = require('express');
const prisma = require('../config/prisma');
const env = require('../config/env');
const pkg = require('../../package.json');

const router = express.Router();

/** GET /api/health — status, database, uptime, timestamp, version. No secrets. */
router.get('/health', async (req, res) => {
  let database = 'up';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'down';
  }
  res.status(database === 'up' ? 200 : 503).json({
    success: true,
    data: {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      version: pkg.version,
      env: env.NODE_ENV,
    },
  });
});

module.exports = router;
