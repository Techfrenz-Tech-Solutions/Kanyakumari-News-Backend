'use strict';

const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const env = require('../config/env');
const { ApiErrors } = require('../utils/apiError');
const { can, permissionsFor } = require('../utils/rbac');

/**
 * authenticateAdmin — requires a valid Bearer access token for a
 * non-deactivated admin user. Attaches req.user.
 */
async function authenticateAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw ApiErrors.unauthorized();

    let payload;
    try {
      payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
    } catch {
      throw ApiErrors.unauthorized('Access token is invalid or expired');
    }
    if (payload.kind !== 'admin') throw ApiErrors.unauthorized();

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'active') throw ApiErrors.unauthorized('Account is not active');

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * requirePermission(module, action) — deny by default.
 * Super Admin bypasses (handled inside can()).
 */
function requirePermission(module, action) {
  return (req, res, next) => {
    if (!req.user) return next(ApiErrors.unauthorized());
    if (!can(req.user, module, action)) {
      return next(ApiErrors.forbidden(`Requires ${module}.${action} permission`));
    }
    return next();
  };
}

/**
 * authenticateReader — valid Bearer access token for a public reader
 * (kind: 'reader'). Attaches req.reader. Used for comment creation.
 */
async function authenticateReader(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw ApiErrors.unauthorized();

    let payload;
    try {
      payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
    } catch {
      throw ApiErrors.unauthorized('Access token is invalid or expired');
    }
    if (payload.kind !== 'reader') throw ApiErrors.unauthorized();

    const reader = await prisma.readerAccount.findUnique({ where: { id: payload.sub } });
    if (!reader) throw ApiErrors.unauthorized('Reader account not found');

    req.reader = reader;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { authenticateAdmin, requirePermission, authenticateReader, can, permissionsFor };
