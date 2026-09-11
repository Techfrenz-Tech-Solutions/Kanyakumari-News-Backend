'use strict';

const mockPrisma = {
  article: { findUnique: jest.fn() },
  subcategory: { findUnique: jest.fn() },
  area: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock('../../src/config/prisma', () => mockPrisma);
jest.mock('../../src/services/auditService', () => ({ logActivity: jest.fn() }));
jest.mock('../../src/utils/sanitizeHtml', () => ({
  sanitizeArticleHtml: (value) => value,
  wordCount: () => 0,
}));

const { resolveRefs, updateArticle } = require('../../src/services/articleService');

describe('article edit relational and scheduling round-trip', () => {
  beforeEach(() => jest.clearAllMocks());

  test('explicit null clears optional subcategory and area relations', async () => {
    await expect(resolveRefs({ subcategoryId: null, areaId: null })).resolves.toEqual({
      subcategoryId: null,
      areaId: null,
    });
    expect(mockPrisma.subcategory.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.area.findUnique).not.toHaveBeenCalled();
  });

  test('rescheduling a scheduled article persists a future publication instant', async () => {
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const publishDate = future.toISOString().slice(0, 10);
    const client = {
      article: {
        update: jest.fn(({ data }) => Promise.resolve({ id: 9, slug: 'story', status: 'scheduled', ...data })),
      },
    };
    mockPrisma.article.findUnique.mockResolvedValue({
      id: 9,
      slug: 'story',
      title: 'Story',
      status: 'scheduled',
      publishDate: future,
      publishTime: '23:55',
    });
    mockPrisma.$transaction.mockImplementation((callback) => callback(client));

    const result = await updateArticle(9, { publishDate, publishTime: '23:55' }, { user: { id: 1 } });

    expect(client.article.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        publishTime: '23:55',
        publishedAt: expect.any(Date),
      }),
    }));
    expect(result.status).toBe('scheduled');
  });

  test('editing an article can set and clear videoUrl', async () => {
    const client = {
      article: {
        update: jest.fn(({ data }) => Promise.resolve({ id: 9, slug: 'story', ...data })),
      },
    };
    mockPrisma.article.findUnique.mockResolvedValue({
      id: 9,
      slug: 'story',
      title: 'Story',
      status: 'draft',
    });
    mockPrisma.$transaction.mockImplementation((callback) => callback(client));

    await updateArticle(9, { videoUrl: 'https://cdn.example.com/story.mp4' }, { user: { id: 1 } });
    expect(client.article.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ videoUrl: 'https://cdn.example.com/story.mp4' }),
    }));

    await updateArticle(9, { videoUrl: null }, { user: { id: 1 } });
    expect(client.article.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ videoUrl: null }),
    }));
  });
});
