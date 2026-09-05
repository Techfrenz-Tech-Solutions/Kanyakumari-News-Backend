'use strict';

const mockPrisma = {
  media: {
    findUnique: jest.fn(),
  },
};

jest.mock('../../src/config/prisma', () => mockPrisma);
jest.mock('../../src/services/auditService', () => ({ logActivity: jest.fn() }));

const { assertReporterAvatarExists } = require('../../src/controllers/teamController');

describe('reporter avatar validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('allows omitted avatar ids', async () => {
    await expect(assertReporterAvatarExists(undefined)).resolves.toBeUndefined();
    await expect(assertReporterAvatarExists(null)).resolves.toBeUndefined();
    expect(mockPrisma.media.findUnique).not.toHaveBeenCalled();
  });

  test('rejects nonexistent avatar ids before reporter create/update hits the FK', async () => {
    mockPrisma.media.findUnique.mockResolvedValue(null);

    await expect(assertReporterAvatarExists(999999999)).rejects.toMatchObject({
      status: 400,
      code: 'AVATAR_NOT_FOUND',
      message: 'Avatar media not found',
    });
    expect(mockPrisma.media.findUnique).toHaveBeenCalledWith({
      where: { id: 999999999 },
      select: { id: true },
    });
  });
});
