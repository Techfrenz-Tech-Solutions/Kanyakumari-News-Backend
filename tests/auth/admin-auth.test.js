'use strict';

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
};
jest.mock('../../src/config/prisma', () => mockPrisma);
jest.mock('../../src/services/auditService', () => ({ logActivity: jest.fn() }));

const mockVerify = jest.fn();
jest.mock('@node-rs/argon2', () => ({ verify: mockVerify, hash: jest.fn() }));

const mockTokenService = {
  issueRefreshToken: jest.fn(),
  signAccessToken: jest.fn(),
  revokeAllForUser: jest.fn(),
};
jest.mock('../../src/services/tokenService', () => mockTokenService);

const { login } = require('../../src/services/authService');

describe('admin authentication fundamentals', () => {
  const req = { ip: '127.0.0.1', headers: {}, socket: {} };

  test('valid active user receives access and opaque refresh credentials', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 1, email: 'admin@example.com', passwordHash: 'argon2id', status: 'active',
      name: 'Admin', role: 'admin', avatar: null,
    });
    mockVerify.mockResolvedValue(true);
    mockPrisma.user.update.mockResolvedValue({});
    mockTokenService.issueRefreshToken.mockResolvedValue({ token: 'opaque', expiresAt: new Date() });
    mockTokenService.signAccessToken.mockReturnValue('jwt');
    const result = await login({ email: 'ADMIN@example.com', password: 'secret' }, req);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: 'admin@example.com' },
    }));
    expect(result).toMatchObject({ accessToken: 'jwt', refreshToken: 'opaque' });
  });

  test('missing and incorrect credentials share the same controlled response', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockVerify.mockResolvedValue(false);
    await expect(login({ email: 'missing@example.com', password: 'bad' }, req))
      .rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
  });

  test('inactive users remain denied before sessions are issued', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 2, email: 'inactive@example.com', passwordHash: 'hash', status: 'inactive',
    });
    mockVerify.mockResolvedValue(true);
    await expect(login({ email: 'inactive@example.com', password: 'secret' }, req))
      .rejects.toMatchObject({ status: 401 });
    expect(mockTokenService.issueRefreshToken).not.toHaveBeenCalled();
  });
});
