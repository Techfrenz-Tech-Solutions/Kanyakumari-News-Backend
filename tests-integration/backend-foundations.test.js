'use strict';

const request = require('supertest');
const prisma = require('../src/config/prisma');
jest.mock('../src/utils/sanitizeHtml', () => ({
  sanitizeArticleHtml: (value) => value,
  wordCount: (value) => String(value || '').split(/\s+/).filter(Boolean).length,
}));
const { app } = require('../src/app');
const { createArticle, updateArticle } = require('../src/services/articleService');
const { adminArticle } = require('../src/mappers/news');

describe('dedicated-database backend foundations', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const titleWord = `hardening${suffix.replace(/[^a-z0-9]/gi, '')}`;
  const tagOne = `tag${suffix.replace(/[^a-z0-9]/gi, '')}`.slice(0, 30).toLowerCase();
  const tagTwo = `new${suffix.replace(/[^a-z0-9]/gi, '')}`.slice(0, 30).toLowerCase();
  const ids = { articles: [], tags: [], media: null, gallery: null, reporter: null, category: null };
  let category;
  let reporter;

  beforeAll(async () => {
    category = await prisma.category.create({
      data: { name: `Hardening Category ${suffix}`, slug: `hardening-category-${suffix}`.toLowerCase() },
    });
    reporter = await prisma.reporter.create({ data: { name: `Hardening Reporter ${suffix}` } });
    ids.category = category.id;
    ids.reporter = reporter.id;
  });

  afterAll(async () => {
    if (ids.gallery) await prisma.gallery.deleteMany({ where: { id: ids.gallery } });
    if (ids.media) await prisma.media.deleteMany({ where: { id: ids.media } });
    if (ids.articles.length) await prisma.article.deleteMany({ where: { id: { in: ids.articles } } });
    await prisma.activityLog.deleteMany({ where: { record: { startsWith: `hardening-${suffix}` } } });
    await prisma.tag.deleteMany({ where: { name: { in: [tagOne, tagTwo] } } });
    if (ids.reporter) await prisma.reporter.deleteMany({ where: { id: ids.reporter } });
    if (ids.category) await prisma.category.deleteMany({ where: { id: ids.category } });
    await prisma.$disconnect();
  });

  test('article create/update persists, replaces, removes, and returns normalized tags', async () => {
    const created = await createArticle({
      title: `${titleWord} published`,
      slug: `hardening-${suffix}-published`.toLowerCase(),
      excerpt: `${titleWord} excerpt`,
      content: `<p>${titleWord} body</p>`,
      categoryId: category.id,
      authorId: reporter.id,
      status: 'published',
      tags: [tagOne, tagOne.toUpperCase()],
    });
    ids.articles.push(created.id);
    expect(adminArticle(created).tags).toEqual([tagOne]);

    const replaced = await updateArticle(created.id, { tags: [tagTwo] });
    expect(adminArticle(replaced).tags).toEqual([tagTwo]);

    const removed = await updateArticle(created.id, { tags: [] });
    expect(adminArticle(removed).tags).toEqual([]);
  });

  test('public visibility and all search sort contracts work against real Prisma', async () => {
    const draft = await createArticle({
      title: `${titleWord} draft`,
      slug: `hardening-${suffix}-draft`.toLowerCase(),
      excerpt: `${titleWord} hidden`,
      content: `<p>${titleWord} hidden body</p>`,
      categoryId: category.id,
      authorId: reporter.id,
      status: 'draft',
    });
    ids.articles.push(draft.id);

    const news = await request(app).get('/api/news').query({ category: category.slug, limit: 100 });
    expect(news.status).toBe(200);
    expect(news.body.data.items.some((row) => row.id === draft.id)).toBe(false);
    expect(news.body.data.items.some((row) => ids.articles.includes(row.id) && row.id !== draft.id)).toBe(true);

    for (const sort of ['relevance', 'newest', 'popular']) {
      const response = await request(app).get('/api/search').query({ q: titleWord, sort, limit: 5 });
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.some((row) => row.id === draft.id)).toBe(false);
      expect(response.body.data.some((row) => ids.articles.includes(row.id))).toBe(true);
    }
  });

  test('populated gallery serializes nested media in persisted order', async () => {
    const media = await prisma.media.create({
      data: {
        name: `hardening-${suffix}.jpg`, key: `tests/${suffix}.jpg`,
        url: `/uploads/tests/${suffix}.jpg`, mimeType: 'image/jpeg', sizeBytes: 10, kind: 'image',
      },
    });
    ids.media = media.id;
    const gallery = await prisma.gallery.create({
      data: {
        title: `Hardening Gallery ${suffix}`, album: 'news', status: 'active',
        images: { create: [{ mediaId: media.id, sortOrder: 1, caption: 'Fixture' }] },
      },
    });
    ids.gallery = gallery.id;

    const response = await request(app).get('/api/gallery').query({ album: 'news' });
    expect(response.status).toBe(200);
    const item = response.body.data.find((row) => row.id === gallery.id);
    expect(item.images).toEqual([{
      url: `/uploads/tests/${suffix}.jpg`,
      thumbnail: `/uploads/tests/${suffix}.jpg`,
      caption: 'Fixture',
    }]);
  });
});
