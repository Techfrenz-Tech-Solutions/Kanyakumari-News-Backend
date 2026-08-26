'use strict';

const crypto = require('node:crypto');
const { verify, hash } = require('@node-rs/argon2');
const prisma = require('../config/prisma');
const env = require('../config/env');
const { ApiErrors } = require('../utils/apiError');
const tokenService = require('./tokenService');
const { logActivity } = require('./auditService');
const { clientIp } = require('../utils/ipHash');
const mailService = require('./mailService');

const ARGON2_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    bio: user.bio,
    avatar: user.avatar ? user.avatar.url : null,
    role: user.role,
    roleLabel: (require('../utils/rbac').ROLE_LABELS[user.role]) || user.role,
    status: user.status,
  };
}

async function login({ email, password }, req) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { avatar: true },
  });

  // Constant-shape: verify against a dummy hash when user missing to reduce timing leaks.
  const DUMMY = '$argon2id$v=19$m=19456,t=2,p=1$' + 'a'.repeat(22) + '$' + 'b'.repeat(43);
  const candidate = user ? user.passwordHash : DUMMY;
  const ok = await verify(candidate, password).catch(() => false);

  if (!user || !ok) {
    if (user) {
      await logActivity({ req, userId: user.id, action: 'auth.login.failed', module: 'auth', record: user.email });
    }
    throw ApiErrors.invalidCredentials();
  }

  if (user.status !== 'active') {
    throw ApiErrors.unauthorized('Account is deactivated');
  }

  const ip = clientIp(req);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const { token, expiresAt } = await tokenService.issueRefreshToken(user.id, ip);

  await logActivity({ req, userId: user.id, action: 'auth.login', module: 'auth', record: user.email });

  return {
    accessToken: tokenService.signAccessToken({ id: user.id, kind: 'admin', role: user.role }),
    refreshToken: token,
    refreshTokenExpiresAt: expiresAt,
    user: toPublicUser(user),
  };
}

async function refresh(req) {
  const presented =
    (req.cookies && req.cookies[env.REFRESH_COOKIE_NAME]) ||
    (req.body && req.body.refreshToken) ||
    null;

  const result = await tokenService.rotateRefreshToken(presented, clientIp(req));
  if (!result) {
    tokenService.clearRefreshCookie(req.res || req);
    throw ApiErrors.unauthorized('Session expired or invalid');
  }
  if (result.user.status !== 'active') {
    tokenService.clearRefreshCookie(req.res || req);
    throw ApiErrors.unauthorized('Account is deactivated');
  }

  const user = await prisma.user.findUnique({
    where: { id: result.user.id },
    include: { avatar: true },
  });

  return {
    accessToken: tokenService.signAccessToken({ id: user.id, kind: 'admin', role: user.role }),
    refreshToken: result.token,
    refreshTokenExpiresAt: result.expiresAt,
    user: toPublicUser(user),
  };
}

async function logout(req) {
  const presented = (req.cookies && req.cookies[env.REFRESH_COOKIE_NAME]) || null;
  await tokenService.revokeRefreshToken(presented);
}

async function me(req) {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { avatar: true },
  });
  return toPublicUser(user);
}

async function forgotPassword({ email }, req) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  // Always report success to avoid account enumeration.
  if (user && user.status === 'active') {
    const rawToken = crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await prisma.passwordResetToken.create({
      data: { email: user.email, tokenHash, expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
    });
    const resetUrl = buildPasswordResetUrl(rawToken);
    const result = await mailService.send({
      to: user.email,
      subject: 'Reset your Kanyakumari News password',
      text: `Hello ${user.name},\n\nUse this link within 30 minutes to reset your password:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    });
    if (result.delivered) {
      await logActivity({ req, userId: user.id, action: 'auth.password.forgot', module: 'auth', record: user.email });
    }
  }
  return { sent: true };
}

function buildPasswordResetUrl(token) {
  const resetUrl = new URL('/reset-password', env.ADMIN_FRONTEND_ORIGIN);
  resetUrl.searchParams.set('token', token);
  return resetUrl.toString();
}

async function resetPassword({ token, newPassword }) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw ApiErrors.badRequest('Reset link is invalid or has expired');
  }

  const user = await prisma.user.findUnique({ where: { email: record.email } });
  if (!user) throw ApiErrors.badRequest('Reset link is invalid or has expired');

  const passwordHash = await hash(newPassword, ARGON2_OPTS);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    await tokenService.revokeAllForUser(user.id, tx);
  });

  return { ok: true };
}

async function updateProfile(req, data) {
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.bio !== undefined ? { bio: data.bio } : {}),
    },
    include: { avatar: true },
  });
  await logActivity({ req, userId: user.id, action: 'user.profile.updated', module: 'users', record: user.email });
  return toPublicUser(user);
}

async function changePassword(req, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const ok = await verify(user.passwordHash, currentPassword).catch(() => false);
  if (!ok) throw ApiErrors.invalidCredentials('Current password is incorrect');

  const passwordHash = await hash(newPassword, ARGON2_OPTS);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  await tokenService.revokeAllForUser(user.id);
  await logActivity({ req, userId: user.id, action: 'user.password.changed', module: 'users', record: user.email });
  return { ok: true };
}

module.exports = {
  login,
  refresh,
  logout,
  me,
  forgotPassword,
  resetPassword,
  updateProfile,
  changePassword,
  toPublicUser,
  ARGON2_OPTS,
  buildPasswordResetUrl,
};
