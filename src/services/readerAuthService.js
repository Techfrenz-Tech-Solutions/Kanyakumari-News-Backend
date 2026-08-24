'use strict';

/**
 * Reader account authentication (independent of admin auth).
 *
 * - Email/password login with Argon2id
 * - OTP verification (provider-pluggable; dev console provider only in
 *   non-production)
 * - Short-lived reader JWT stored in an httpOnly cookie
 * - Used primarily for authenticated comments
 */
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { hash, verify } = require('@node-rs/argon2');
const prisma = require('../config/prisma');
const env = require('../config/env');
const { ApiErrors } = require('../utils/apiError');
const { logActivity } = require('./auditService');

const OTP_MAX_ATTEMPTS = 5;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function readerJwt(user) {
  return jwt.sign(
    { sub: user.id, type: 'reader', email: user.email, phone: user.phone, name: user.name },
    env.JWT_READER_SECRET || env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_READER_EXPIRES_IN || '7d' }
  );
}

function setReaderCookie(res, token) {
  res.cookie('reader_token', token, {
    httpOnly: true,
    secure: env.IS_PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

function getReaderUser(req) {
  const token = req.cookies?.reader_token || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_READER_SECRET || env.JWT_ACCESS_SECRET);
    if (payload.type !== 'reader') return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Email/password login ──────────────────────────────────────────────────

async function login({ email, password, req }) {
  const user = await prisma.readerAccount.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    throw ApiErrors.unauthorized('Invalid email or password', 'READER_AUTH_FAILED');
  }
  const ok = await verify(user.passwordHash, password).catch(() => false);
  if (!ok) throw ApiErrors.unauthorized('Invalid email or password', 'READER_AUTH_FAILED');
  return { user: publicUser(user), token: readerJwt(user) };
}

// ── OTP (provider-pluggable) ──────────────────────────────────────────────

/**
 * Provider abstraction: `otpProvider` may be swapped for a real SMS/voice
 * provider. The dev provider prints the code to the server console and
 * returns it in the response (devCode) — ONLY when not in production.
 */
const otpProvider = {
  name: 'console-dev',
  async send({ phone, code }) {
    if (env.IS_PROD) {
      throw new Error('OTP provider not configured for production');
    }
    console.log(`[OTP][dev] code for ${phone}: ${code}`);
    return { devCode: code };
  },
};

async function requestOtp({ phone, req }) {
  // Rate-limit-ish: throttle per phone (1 request / 60s)
  const recent = await prisma.otpCode.findFirst({
    where: { phone, createdAt: { gte: new Date(Date.now() - 60 * 1000) } },
    select: { id: true },
  });
  if (recent) throw ApiErrors.tooManyRequests('Too many OTP requests. Try again in a minute.', 'OTP_RATE_LIMITED');

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const provider = env.OTP_PROVIDER === 'console' || env.OTP_PROVIDER === 'dev' ? otpProvider : otpProvider;

  // Invalidate any previous un-consumed codes for this phone
  await prisma.otpCode.updateMany({
    where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date() },
  });

  const sendResult = await provider.send({ phone, code });
  await prisma.otpCode.create({
    data: {
      phone,
      codeHash: sha256(code),
      expiresAt: new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60 * 1000),
    },
  });

  await logActivity({
    req,
    userId: null,
    action: 'otp.requested',
    module: 'auth',
    record: phone,
  });

  return { devCode: sendResult?.devCode };
}

async function verifyOtp({ phone, otp, req }) {
  const codeRow = await prisma.otpCode.findFirst({
    where: { phone, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!codeRow) throw ApiErrors.unauthorized('No OTP request for this number', 'OTP_NOT_FOUND');
  if (codeRow.expiresAt < new Date()) {
    throw ApiErrors.unauthorized('OTP expired', 'OTP_EXPIRED');
  }
  if (codeRow.attempts >= OTP_MAX_ATTEMPTS) {
    throw ApiErrors.tooManyRequests('Too many incorrect attempts. Request a new OTP.', 'OTP_LOCKED');
  }

  const match = codeRow.codeHash === sha256(otp);
  if (!match) {
    await prisma.otpCode.update({ where: { id: codeRow.id }, data: { attempts: { increment: 1 } } });
    throw ApiErrors.unauthorized('Invalid OTP', 'OTP_INVALID');
  }

  // Consume + find-or-create the reader account (phone-only identity)
  await prisma.otpCode.update({ where: { id: codeRow.id }, data: { consumedAt: new Date() } });
  const user = await prisma.readerAccount.upsert({
    where: { phone },
    create: { phone, provider: 'otp' },
    update: {},
  });

  await logActivity({ req, userId: null, action: 'otp.verified', module: 'auth', record: phone });
  return { user: publicUser(user), token: readerJwt(user) };
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    name: user.name || (user.email ? user.email.split('@')[0] : null),
  };
}

module.exports = {
  login,
  requestOtp,
  verifyOtp,
  getReaderUser,
  setReaderCookie,
  publicUser,
  readerJwt,
};
