'use strict';

/**
 * JWT access tokens + opaque rotating refresh tokens.
 *
 * Access: short-lived JWT (default 15m), held in app memory by the client.
 * Refresh: opaque random token, stored ONLY as a SHA-256 hash in the DB,
 * delivered via httpOnly Secure SameSite=Strict cookie. Rotated on every
 * refresh; reuse of a revoked token revokes the whole family.
 */
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const env = require('../config/env');

function signAccessToken({ id, kind, role = null }) {
  return jwt.sign(
    { sub: id, kind, ...(role ? { role } : {}) },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN }
  );
}

function generateOpaqueToken() {
  return crypto.randomBytes(48).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.IS_PROD,
  sameSite: 'strict',
  path: '/api', // refresh endpoint lives under /api/admin/auth
  maxAge: env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
};

function setRefreshCookie(res, token) {
  res.cookie(env.REFRESH_COOKIE_NAME, token, REFRESH_COOKIE_OPTIONS);
}

function clearRefreshCookie(res) {
  res.clearCookie(env.REFRESH_COOKIE_NAME, {
    ...REFRESH_COOKIE_OPTIONS,
    maxAge: undefined,
  });
}

/**
 * Issue a fresh refresh token row for a user.
 * @returns {Promise<{token, expiresAt}>} the raw token (cookie-bound) + expiry
 */
async function issueRefreshToken(userId, ipAddress = null) {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: ipAddress ? String(ipAddress).slice(0, 45) : null,
    },
  });
  return { token, expiresAt };
}

/**
 * Rotate a refresh token.
 * - If the presented token is unknown  -> 401 (no session)
 * - If the presented token is revoked  -> reuse detected: revoke ALL of the
 *   user's refresh tokens, then 401.
 * - If valid                           -> revoke it, issue a new one.
 *
 * @returns {Promise<{user, token, expiresAt} | null>} null when no valid token.
 */
async function rotateRefreshToken(presented, ipAddress = null) {
  if (!presented) return null;
  const hash = hashToken(presented);
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash },
    include: { user: true },
  });

  if (!row) return null;

  if (row.revokedAt) {
    // Reuse of a rotated/revoked token — treat as theft: nuke the family.
    await prisma.refreshToken.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return null;
  }

  if (row.expiresAt < new Date()) return null;

  // Revoke the used token and issue the next one (rotation).
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } }),
    prisma.refreshToken.create({
      data: {
        userId: row.userId,
        tokenHash: hashToken(token),
        expiresAt,
        ipAddress: ipAddress ? String(ipAddress).slice(0, 45) : null,
      },
    }),
  ]);

  return { user: row.user, token, expiresAt };
}

/** Revoke a single refresh token (logout). */
async function revokeRefreshToken(presented) {
  if (!presented) return;
  const hash = hashToken(presented);
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoke every refresh token for a user (password change, role change, etc.) */
async function revokeAllForUser(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

module.exports = {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  setRefreshCookie,
  clearRefreshCookie,
  REFRESH_COOKIE_OPTIONS,
};
