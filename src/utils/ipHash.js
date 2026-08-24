'use strict';

const crypto = require('node:crypto');
const env = require('../config/env');

/**
 * Hash a client IP with a server secret so raw IPs are not stored
 * in article_views / activity_logs.
 */
function hashIp(ip) {
  const key = env.IP_HASH_SECRET || 'dev-ephemeral';
  return crypto.createHmac('sha256', key).update(String(ip || '')).digest('hex');
}

/** Best-effort client IP respecting Express trust proxy. */
function clientIp(req) {
  if (!req) return '';
  return req.ip || (req.socket && req.socket.remoteAddress) || '';
}

module.exports = { hashIp, clientIp };
