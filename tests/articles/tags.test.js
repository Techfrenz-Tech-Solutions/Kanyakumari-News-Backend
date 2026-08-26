'use strict';

const mockPrisma = {
  category: { findUnique: jest.fn(), findFirst: jest.fn() },
  reporter: { findUnique: jest.fn(), findFirst: jest.fn() },
  article: { findMany: jest.fn(), findUnique: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock('../../src/config/prisma', () => mockPrisma);
jest.mock('../../src/services/auditService', () => ({ logActivity: jest.fn() }));
jest.mock('../../src/utils/sanitizeHtml', () => ({
  sanitizeArticleHtml: (value) => value,
  wordCount: (value) => String(value || '').split(/\s+/).filter(Boolean).length,
}));

const { syncTags, createArticle, updateArticle } = require('../../src/services/articleService');
const { adminArticle } = require('../../src/mappers/news');

function tagClient(existing = []) {
  let nextId = 20;
  return {
    tag: {
      findMany: jest.fn().mockResolvedValue(existing),
      create: jest.fn(({ data }) => Promise.resolve({ id: nextId++, name: data.name })),
    },
    articleTag: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe('article tag persistence', () => {
  test('normalizes duplicates and replaces relations', async () => {
    const client = tagClient([{ id: 1, name: 'local' }]);
    await syncTags(client, 42, [' Local ', 'LOCAL', 'தமிழ்', 'தமிழ்']);

    expect(client.articleTag.deleteMany).toHaveBeenCalledWith({ where: { articleId: 42 } });
    expect(client.articleTag.createMany).toHaveBeenCalledWith({
      data: [
        { articleId: 42, tagId: 1 },
        { articleId: 42, tagId: 20 },
      ],
    });
  });

  test('an empty tag list removes all relations', async () => {
    const client = tagClient();
    await syncTags(client, 42, []);
    expect(client.articleTag.deleteMany).toHaveBeenCalled();
    expect(client.articleTag.createMany).not.toHaveBeenCalled();
  });

  test('create uses the transaction client and returns persisted tag names', async () => {
    mockPrisma.category.findUnique.mockResolvedValue({ id: 1 });
    mockPrisma.reporter.findUnique.mockResolvedValue({ id: 2 });
    mockPrisma.article.findMany.mockResolvedValue([]);
    const client = tagClient();
    const base = {
      id: 9,
      slug: 'story',
      title: 'Story',
      excerpt: 'Excerpt',
      content: '<p>Body</p>',
      categoryId: 1,
      authorId: 2,
      status: 'draft',
      tags: [],
    };
    client.article = {
      create: jest.fn().mockResolvedValue(base),
      update: jest.fn().mockResolvedValue(base),
      findUnique: jest.fn().mockResolvedValue({
        ...base,
        tags: [{ tag: { name: 'local' } }],
      }),
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(client));

    const result = await createArticle({
      title: 'Story', excerpt: 'Excerpt', content: '<p>Body</p>',
      categoryId: 1, authorId: 2, status: 'draft', tags: ['Local'],
    }, { user: { id: 1 } });

    expect(client.articleTag.createMany).toHaveBeenCalled();
    expect(adminArticle(result).tags).toEqual(['local']);
  });

  test('update replaces tags through the transaction client', async () => {
    mockPrisma.article.findUnique.mockResolvedValue({ id: 9, slug: 'story', title: 'Story' });
    const client = tagClient([{ id: 2, name: 'replacement' }]);
    client.article = {
      update: jest.fn().mockResolvedValue({ id: 9 }),
      findUnique: jest.fn().mockResolvedValue({ id: 9, tags: [{ tag: { name: 'replacement' } }] }),
    };
    mockPrisma.$transaction.mockImplementation((callback) => callback(client));
    const result = await updateArticle(9, { tags: ['Replacement'] }, { user: { id: 1 } });
    expect(client.articleTag.deleteMany).toHaveBeenCalledWith({ where: { articleId: 9 } });
    expect(result.tags[0].tag.name).toBe('replacement');
  });
});
