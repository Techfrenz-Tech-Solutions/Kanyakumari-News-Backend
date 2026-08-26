'use strict';

const mockPrisma = {
  article: { findUnique: jest.fn(), update: jest.fn() },
};
jest.mock('../../src/config/prisma', () => mockPrisma);
jest.mock('../../src/services/auditService', () => ({ logActivity: jest.fn() }));
jest.mock('../../src/utils/sanitizeHtml', () => ({
  sanitizeArticleHtml: (value) => value,
  wordCount: () => 0,
}));

const { TRANSITIONS, changeStatus } = require('../../src/services/articleService');

describe('article lifecycle state machine', () => {
  const valid = [
    ['draft', 'submit', 'pending'],
    ['pending', 'approve', 'published'],
    ['pending', 'reject', 'draft'],
    ['draft', 'publish-now', 'published'],
    ['scheduled', 'publish-now', 'published'],
    ['published', 'unpublish', 'draft'],
    ['scheduled', 'cancel-schedule', 'draft'],
  ];

  test.each(valid)('%s --%s--> %s', async (from, action, to) => {
    mockPrisma.article.findUnique.mockResolvedValue({ id: 1, slug: 'x', status: from, publishedAt: null });
    mockPrisma.article.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, slug: 'x', ...data }));
    const result = await changeStatus(1, { action }, { user: { id: 1 } });
    expect(result.status).toBe(to);
  });

  test.each(Object.entries(TRANSITIONS))('rejects invalid source states for %s', async (action, transition) => {
    const invalid = ['draft', 'pending', 'scheduled', 'published'].find((s) => !transition.from.includes(s));
    mockPrisma.article.findUnique.mockResolvedValue({ id: 1, slug: 'x', status: invalid });
    await expect(changeStatus(1, { action }, { user: { id: 1 } })).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_STATUS_TRANSITION',
    });
    expect(mockPrisma.article.update).not.toHaveBeenCalled();
  });

  test('cancel-schedule clears all scheduling visibility fields', async () => {
    mockPrisma.article.findUnique.mockResolvedValue({
      id: 1, slug: 'x', status: 'scheduled', publishedAt: new Date(),
      publishDate: new Date(), publishTime: '12:00',
    });
    mockPrisma.article.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));
    await changeStatus(1, { action: 'cancel-schedule' }, { user: { id: 1 } });
    expect(mockPrisma.article.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'draft', publishedAt: null, publishDate: null, publishTime: null,
      }),
    }));
  });
});
