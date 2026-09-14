'use strict';

const mockPrisma = {
  user: { update: jest.fn() },
  media: { findFirst: jest.fn(), findUnique: jest.fn() },
};

jest.mock('../src/config/prisma', () => mockPrisma);
jest.mock('../src/services/auditService', () => ({ logActivity: jest.fn() }));
jest.mock('../src/services/tokenService', () => ({
  signAccessToken: jest.fn(),
  issueRefreshToken: jest.fn(),
  revokeAllForUser: jest.fn(),
}));
jest.mock('../src/services/mailService', () => ({}));

const authService = require('../src/services/authService');

const req = { user: { id: 7 } };
const MEDIA_URL = '/media/2026/08/contract-sync-avatar.png';

/** Simulates prisma.user.update resolving to the persisted user row. */
function setUpdateResult(avatarUrl) {
  mockPrisma.user.update.mockResolvedValue({
    id: 7,
    name: 'Contract Sync',
    email: 'contract@sync.test',
    phone: null,
    bio: null,
    role: 'reporter',
    status: 'active',
    avatar: avatarUrl ? { id: 42, url: avatarUrl } : null,
  });
}

describe('profile avatar persistence (updateProfile)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUpdateResult(null);
  });

  test('omitting avatar and avatarId leaves the avatar untouched', async () => {
    const user = await authService.updateProfile(req, { name: 'Contract Sync' });
    const { data } = mockPrisma.user.update.mock.calls[0][0];
    expect(data).toEqual({ name: 'Contract Sync' });
    expect(data).not.toHaveProperty('avatarId');
    expect(mockPrisma.media.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.media.findUnique).not.toHaveBeenCalled();
    expect(user.avatar).toBeNull();
  });

  test('avatar: null clears the avatar', async () => {
    setUpdateResult(null);
    await authService.updateProfile(req, { avatar: null });
    const { data } = mockPrisma.user.update.mock.calls[0][0];
    expect(data).toEqual({ avatarId: null });
    expect(mockPrisma.media.findFirst).not.toHaveBeenCalled();
  });

  test('avatar: empty string clears the avatar', async () => {
    setUpdateResult(null);
    await authService.updateProfile(req, { avatar: '' });
    const { data } = mockPrisma.user.update.mock.calls[0][0];
    expect(data).toEqual({ avatarId: null });
    expect(mockPrisma.media.findFirst).not.toHaveBeenCalled();
  });

  test('avatar media URL is resolved to the internal Media id', async () => {
    mockPrisma.media.findFirst.mockResolvedValue({ id: 42 });
    setUpdateResult(MEDIA_URL);
    const user = await authService.updateProfile(req, { avatar: MEDIA_URL });
    expect(mockPrisma.media.findFirst).toHaveBeenCalledWith({
      where: { url: MEDIA_URL },
      select: { id: true },
    });
    const { data } = mockPrisma.user.update.mock.calls[0][0];
    expect(data).toEqual({ avatarId: 42 });
    expect(user.avatar).toBe(MEDIA_URL);
  });

  test('unknown avatar URL fails with 400 AVATAR_NOT_FOUND', async () => {
    mockPrisma.media.findFirst.mockResolvedValue(null);
    await expect(authService.updateProfile(req, { avatar: MEDIA_URL })).rejects.toMatchObject({
      status: 400,
      code: 'AVATAR_NOT_FOUND',
    });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  test('avatarId is validated and passed through', async () => {
    mockPrisma.media.findUnique.mockResolvedValue({ id: 9 });
    setUpdateResult(MEDIA_URL);
    await authService.updateProfile(req, { avatarId: 9 });
    expect(mockPrisma.media.findUnique).toHaveBeenCalledWith({
      where: { id: 9 },
      select: { id: true },
    });
    const { data } = mockPrisma.user.update.mock.calls[0][0];
    expect(data).toEqual({ avatarId: 9 });
  });

  test('nonexistent avatarId fails with 400 AVATAR_NOT_FOUND', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(null);
    await expect(authService.updateProfile(req, { avatarId: 999999999 })).rejects.toMatchObject({
      status: 400,
      code: 'AVATAR_NOT_FOUND',
    });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  test('avatar: null with avatarId: null is a consistent clear', async () => {
    await authService.updateProfile(req, { avatar: null, avatarId: null });
    const { data } = mockPrisma.user.update.mock.calls[0][0];
    expect(data).toEqual({ avatarId: null });
    expect(mockPrisma.media.findUnique).not.toHaveBeenCalled();
  });

  test('avatar: null with a live avatarId is a conflict (400 AVATAR_CONFLICT)', async () => {
    mockPrisma.media.findUnique.mockResolvedValue({ id: 9 });
    await expect(authService.updateProfile(req, { avatar: null, avatarId: 9 })).rejects.toMatchObject({
      status: 400,
      code: 'AVATAR_CONFLICT',
    });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  test('conflicting avatar and avatarId fail with 400 AVATAR_CONFLICT', async () => {
    mockPrisma.media.findFirst.mockResolvedValue({ id: 42 });
    mockPrisma.media.findUnique.mockResolvedValue({ id: 9 });
    await expect(authService.updateProfile(req, { avatar: MEDIA_URL, avatarId: 9 })).rejects.toMatchObject({
      status: 400,
      code: 'AVATAR_CONFLICT',
    });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
