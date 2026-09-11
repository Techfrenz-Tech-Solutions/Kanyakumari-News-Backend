'use strict';

const express = require('express');
const request = require('supertest');

const mockPrisma = {
  category: { findUnique: jest.fn(), findMany: jest.fn() },
  area: { findMany: jest.fn() },
  article: { findMany: jest.fn(), count: jest.fn() },
  articleView: { groupBy: jest.fn() },
  advertisement: { findMany: jest.fn() },
  gallery: { findMany: jest.fn() },
  siteSettings: { findUnique: jest.fn() },
};

jest.mock('../../src/config/prisma', () => mockPrisma);
jest.mock('../../src/services/auditService', () => ({ logActivity: jest.fn() }));
jest.mock('../../src/utils/sanitizeHtml', () => ({
  sanitizeArticleHtml: (value) => value,
  wordCount: () => 3,
}));

const controller = require('../../src/controllers/publicController');
const { errorHandler } = require('../../src/middleware/errorHandler');

const article = (id, title = `Story ${id}`) => ({
  id,
  slug: `story-${id}`,
  title,
  titleTa: null,
  excerpt: 'News excerpt',
  excerptTa: null,
  content: '<p>News body</p>',
  category: { slug: 'local' },
  area: null,
  tags: [],
  featuredImage: null,
  isBreaking: false,
  isFeatured: false,
  views: 1,
  publishedAt: new Date('2026-08-25T00:00:00Z'),
});

function appFor(path, handler) {
  const app = express();
  app.use(express.json());
  app.get(path, handler);
  app.use(errorHandler);
  return app;
}

describe('public search contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.category.findUnique.mockResolvedValue({ id: 7 });
    mockPrisma.article.count.mockResolvedValue(0);
  });

  test.each([
    ["'\"%_+-() தமிழ் spaces", 'relevance'],
    ['ordinary', undefined],
  ])('relevance uses supported parameterized Prisma filters for %s', async (q, sort) => {
    mockPrisma.article.findMany.mockResolvedValue([
      { ...article(1), title: `Prefix ${q}` },
      { ...article(2), title: q },
      { ...article(3), tags: [{ tag: { name: q.toLowerCase() } }] },
    ]);

    const response = await request(appFor('/api/search', controller.search))
      .get('/api/search')
      .query({ q, ...(sort ? { sort } : {}), category: 'local', limit: 3 });

    expect(response.status).toBe(200);
    expect(response.body.data.map((row) => row.id)).toEqual([2, 1, 3]);
    expect(mockPrisma.article.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'published',
        OR: expect.arrayContaining([{ title: { contains: q } }]),
      }),
    }));
  });

  test.each([
    ['newest', { publishedAt: 'desc' }],
    ['popular', { views: 'desc' }],
  ])('%s uses a supported Prisma filter and returns a stable envelope', async (sort, orderBy) => {
    mockPrisma.article.findMany.mockResolvedValue([article(1)]);
    const response = await request(appFor('/api/search', controller.search))
      .get('/api/search')
      .query({ q: 'news', sort });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: [{ id: 1 }] });
    expect(mockPrisma.article.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy }));
  });

  test('zero results and empty queries return valid empty responses', async () => {
    mockPrisma.article.findMany.mockResolvedValue([]);
    const app = appFor('/api/search', controller.search);
    expect((await request(app).get('/api/search').query({ q: 'none' })).body.data).toEqual([]);
    expect((await request(app).get('/api/search')).body.data).toEqual([]);
  });

  test('overlong input is a controlled validation error', async () => {
    const response = await request(appFor('/api/search', controller.search))
      .get('/api/search')
      .query({ q: 'x'.repeat(201) });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('BAD_REQUEST');
  });
});

describe('public home contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.article.count.mockResolvedValue(12);
    mockPrisma.category.findMany.mockResolvedValue([]);
    mockPrisma.area.findMany.mockResolvedValue([]);
    mockPrisma.advertisement.findMany.mockResolvedValue([]);
    mockPrisma.siteSettings.findUnique.mockResolvedValue(null);
    mockPrisma.articleView.groupBy.mockResolvedValue([]);
  });

  test('returns all breaking articles for hero and breaking homepage sections', async () => {
    const breakingRows = [article(1, 'Breaking 1'), article(2, 'Breaking 2')].map((row) => ({
      ...row,
      isBreaking: true,
    }));

    mockPrisma.article.findMany
      .mockResolvedValueOnce(breakingRows)
      .mockResolvedValueOnce(breakingRows)
      .mockResolvedValueOnce([article(3)]);

    const response = await request(appFor('/api/home', controller.home)).get('/api/home');

    expect(response.status).toBe(200);
    expect(response.body.data.hero).toHaveLength(2);
    expect(response.body.data.breaking).toHaveLength(2);
    expect(mockPrisma.article.findMany).toHaveBeenNthCalledWith(1, expect.not.objectContaining({ take: expect.any(Number) }));
    expect(mockPrisma.article.findMany).toHaveBeenNthCalledWith(2, expect.not.objectContaining({ take: expect.any(Number) }));
  });
});

describe('gallery serialization', () => {
  test('handles empty, populated, ordered, nullable-cover, and missing-media galleries', async () => {
    mockPrisma.gallery.findMany.mockResolvedValue([
      { id: 1, title: 'Empty', description: null, album: 'news', coverImage: null, images: [] },
      {
        id: 2,
        title: 'Festival',
        description: 'Photos',
        album: 'festivals',
        coverImage: { url: '/cover.jpg' },
        images: [
          { sortOrder: 1, caption: 'First', media: { url: '/1.jpg', thumbnailUrl: '/1-thumb.jpg' } },
          { sortOrder: 2, caption: null, media: { url: '/2.jpg', thumbnailUrl: null } },
          { sortOrder: 3, caption: 'Deleted', media: null },
        ],
      },
    ]);
    const response = await request(appFor('/api/gallery', controller.gallery))
      .get('/api/gallery')
      .query({ album: 'festivals' });
    expect(response.status).toBe(200);
    expect(response.body.data[0].images).toEqual([]);
    expect(response.body.data[1]).toMatchObject({
      image: '/cover.jpg',
      images: [
        { url: '/1.jpg', thumbnail: '/1-thumb.jpg', caption: 'First' },
        { url: '/2.jpg', thumbnail: '/2.jpg', caption: '' },
      ],
    });
    expect(mockPrisma.gallery.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'active', album: 'festivals' },
      include: expect.objectContaining({ images: expect.objectContaining({ include: { media: true } }) }),
    }));
  });
});
