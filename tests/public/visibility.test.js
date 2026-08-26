'use strict';

const mockPrisma = {
  article: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  category: { findUnique: jest.fn() },
};
jest.mock('../../src/config/prisma', () => mockPrisma);
jest.mock('../../src/services/auditService', () => ({ logActivity: jest.fn() }));
jest.mock('../../src/utils/sanitizeHtml', () => ({
  sanitizeArticleHtml: (value) => value,
  wordCount: () => 0,
}));

const { publicScope, getBySlug, getByCategorySlug, listArticles } = require('../../src/services/articleService');

describe('single public article visibility definition', () => {
  test('requires published status and a due publishedAt timestamp', () => {
    const now = new Date('2026-08-26T12:00:00Z');
    expect(publicScope(now)).toEqual({ status: 'published', publishedAt: { lte: now } });
  });

  test('slug, category, and list queries all apply publicScope', async () => {
    mockPrisma.article.findFirst.mockResolvedValue(null);
    mockPrisma.article.findMany.mockResolvedValue([]);
    mockPrisma.article.count.mockResolvedValue(0);
    mockPrisma.category.findUnique.mockResolvedValue({ id: 4 });

    await getBySlug('hidden');
    await getByCategorySlug('local');
    await listArticles({ query: {} });

    expect(mockPrisma.article.findFirst.mock.calls[0][0].where).toMatchObject({
      slug: 'hidden', status: 'published', publishedAt: { lte: expect.any(Date) },
    });
    expect(mockPrisma.article.findMany.mock.calls[0][0].where).toMatchObject({
      categoryId: 4, status: 'published', publishedAt: { lte: expect.any(Date) },
    });
    expect(mockPrisma.article.findMany.mock.calls[1][0].where).toMatchObject({
      status: 'published', publishedAt: { lte: expect.any(Date) },
    });
  });

  test.each(['draft', 'pending', 'scheduled', 'unpublished', 'deleted'])('%s never satisfies the scope', (status) => {
    expect(status).not.toBe(publicScope().status);
  });
});
