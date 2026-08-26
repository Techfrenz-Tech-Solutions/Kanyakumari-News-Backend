'use strict';

const mockPrisma = {
  user: { findUnique: jest.fn() },
  passwordResetToken: { findUnique: jest.fn(), create: jest.fn() },
  $transaction: jest.fn(),
};
jest.mock('../../src/config/prisma', () => mockPrisma);
jest.mock('../../src/services/auditService', () => ({ logActivity: jest.fn() }));
jest.mock('../../src/services/mailService', () => ({ send: jest.fn() }));
jest.mock('../../src/services/tokenService', () => ({
  revokeAllForUser: jest.fn().mockResolvedValue({ count: 2 }),
}));
jest.mock('@node-rs/argon2', () => ({
  verify: jest.fn(),
  hash: jest.fn().mockResolvedValue('argon2id-hash'),
}));

const env = require('../../src/config/env');
const mailService = require('../../src/services/mailService');
const tokenService = require('../../src/services/tokenService');
const service = require('../../src/services/authService');

describe('admin password reset', () => {
  test('email link targets the configurable frontend and URL-encodes the token', () => {
    const url = new URL(service.buildPasswordResetUrl('a token+/?'));
    expect(url.origin).toBe(new URL(env.ADMIN_FRONTEND_ORIGIN).origin);
    expect(url.pathname).toBe('/reset-password');
    expect(url.searchParams.get('token')).toBe('a token+/?');
  });

  test('forgot-password remains enumeration resistant', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.forgotPassword({ email: 'missing@example.com' }, {})).resolves.toEqual({ sent: true });
    expect(mailService.send).not.toHaveBeenCalled();
  });

  test('valid reset is single-use and revokes refresh sessions atomically', async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 3, email: 'user@example.com', usedAt: null, expiresAt: new Date(Date.now() + 60_000),
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 4, email: 'user@example.com' });
    const tx = {
      user: { update: jest.fn().mockResolvedValue({ id: 4 }) },
      passwordResetToken: { update: jest.fn().mockResolvedValue({ id: 3 }) },
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(tx));
    await expect(service.resetPassword({ token: 'secret', newPassword: 'new password' })).resolves.toEqual({ ok: true });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 4 }, data: { passwordHash: 'argon2id-hash' },
    });
    expect(tx.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: 3 }, data: { usedAt: expect.any(Date) },
    });
    expect(tokenService.revokeAllForUser).toHaveBeenCalledWith(4, tx);
  });

  test.each([
    [null],
    [{ id: 1, usedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }],
    [{ id: 1, usedAt: null, expiresAt: new Date(Date.now() - 1) }],
  ])('invalid, used, and expired reset tokens are rejected', async (record) => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue(record);
    await expect(service.resetPassword({ token: 'bad', newPassword: 'password' }))
      .rejects.toMatchObject({ status: 400 });
  });
});
