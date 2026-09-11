'use strict';

const mockPrisma = {
  media: { create: jest.fn() },
};

jest.mock('../../src/config/prisma', () => mockPrisma);
jest.mock('../../src/services/auditService', () => ({ logActivity: jest.fn() }));
jest.mock('../../src/services/storage/localStorage', () => ({
  localStorage: {
    save: jest.fn((key, buffer) => Promise.resolve({ url: `http://localhost:3000/uploads/${key}`, size: buffer.length })),
    delete: jest.fn(),
    getPublicUrl: jest.fn((key) => `http://localhost:3000/uploads/${key}`),
  },
  keyFromFileName: jest.fn((name) => `2026/09/${name}`),
}));

const { detectMime, isVideo, processUpload } = require('../../src/services/mediaService');

const mp4Buffer = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftyp', 'ascii'),
  Buffer.from('mp42', 'ascii'),
  Buffer.alloc(128, 0),
]);

describe('video media upload contract', () => {
  beforeEach(() => jest.clearAllMocks());

  test('detects supported browser video formats by magic bytes', () => {
    expect(detectMime(mp4Buffer)).toEqual({ mime: 'video/mp4', ext: 'mp4' });
    expect(isVideo('video/mp4')).toBe(true);
    expect(isVideo('image/png')).toBe(false);
  });

  test('stores a real video upload as media kind video', async () => {
    mockPrisma.media.create.mockImplementation(({ data }) => Promise.resolve({ id: 44, createdAt: new Date(), ...data }));

    const row = await processUpload(mp4Buffer, 'story-video.mov', mp4Buffer.length, { kind: 'video', userId: 7 });

    expect(mockPrisma.media.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: 'video',
        mimeType: 'video/mp4',
        width: null,
        height: null,
        uploadedById: 7,
      }),
    }));
    expect(row.kind).toBe('video');
    expect(row.url).toContain('.mp4');
  });

  test('rejects image bytes when the frontend requests video kind', async () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]);

    await expect(processUpload(pngBuffer, 'not-video.png', pngBuffer.length, { kind: 'video' }))
      .rejects
      .toThrow('Video upload must be MP4, WebM or QuickTime');
    expect(mockPrisma.media.create).not.toHaveBeenCalled();
  });
});
