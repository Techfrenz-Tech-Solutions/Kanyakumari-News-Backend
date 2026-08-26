'use strict';

const prisma = require('../../config/prisma');
const { asyncHandler, ApiErrors } = require('../../utils/apiError');
const articleService = require('../../services/articleService');
const { articleCreate, articleUpdate, statusActionSchema, seoUpdateSchema } = require('../../validators/news.schema');
const { adminArticle } = require('../../mappers/news');

const {
  createArticle,
  updateArticle,
  deleteArticle,
  getArticle,
  changeStatus: applyStatusChange,
  LIST_INCLUDE,
  SORT_MAP,
} = articleService;

function parsePagination(req) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit || req.query.pageSize, 10) || 20, 100);
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Build the admin list `where` clause.
 * Legacy admin UI sends: status, category (name), search, isBreaking,
 * isFeatured, author, dateFrom, dateTo, sort.
 */
async function buildAdminWhere(req) {
  const where = {};

  if (req.query.status) {
    where.status = req.query.status;
  } else if (req.query.tab === 'published') {
    where.status = 'published';
  } else if (req.query.tab === 'scheduled') {
    where.status = 'scheduled';
  } else if (req.query.tab === 'pending') {
    where.status = 'pending';
  } else if (req.query.tab === 'drafts') {
    where.status = 'draft';
  }

  if (req.query.category) {
    const cat =
      (await prisma.category.findFirst({ where: { name: req.query.category } })) ||
      (await prisma.category.findUnique({ where: { slug: req.query.category } }));
    if (!cat) throw ApiErrors.notFound('Category not found');
    where.categoryId = cat.id;
  }

  if (req.query.author) {
    const rep = await prisma.reporter.findFirst({ where: { name: req.query.author } });
    if (rep) where.authorId = rep.id;
  }

  if (req.query.isBreaking === 'true') where.isBreaking = true;
  if (req.query.isFeatured === 'true') where.isFeatured = true;

  if (req.query.search) {
    where.OR = [
      { title: { contains: req.query.search } },
      { excerpt: { contains: req.query.search } },
      { content: { contains: req.query.search } },
    ];
  }

  if (req.query.dateFrom || req.query.dateTo) {
    where.publishedAt = {};
    if (req.query.dateFrom) where.publishedAt.gte = new Date(`${req.query.dateFrom}T00:00:00Z`);
    if (req.query.dateTo) where.publishedAt.lte = new Date(`${req.query.dateTo}T23:59:59Z`);
  }

  return where;
}

const list = asyncHandler(async (req, res) => {
  const where = await buildAdminWhere(req);
  const { page, limit, skip } = parsePagination(req);

  const sortKey = req.query.sort || 'publishedAt';
  let orderBy;
  if (SORT_MAP[sortKey]) {
    orderBy = SORT_MAP[sortKey];
  } else {
    // default: newest first, but drafts (null publishedAt) still sort sensibly
    orderBy =
      sortKey === 'createdAt'
        ? { createdAt: 'asc' }
        : sortKey === '-createdAt'
          ? { createdAt: 'desc' }
          : { publishedAt: 'desc' };
  }

  const [items, total] = await Promise.all([
    prisma.article.findMany({ where, orderBy, skip, take: limit, include: LIST_INCLUDE }),
    prisma.article.count({ where }),
  ]);

  res.json({
    success: true,
    data: {
      items: items.map((a) => adminArticle(a, { withContent: req.query.includeContent === 'true' })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});

const create = asyncHandler(async (req, res) => {
  const data = articleCreate.parse(req.body);
  const article = await createArticle(data, req);
  res.status(201).json({ success: true, data: adminArticle(article) });
});

const get = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const article = await getArticle(id);
  res.json({ success: true, data: adminArticle(article) });
});

const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const data = articleUpdate.parse(req.body);
  const article = await updateArticle(id, data, req);
  res.json({ success: true, data: adminArticle(article) });
});

const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = await deleteArticle(id, req);
  res.json({ success: true, data: result });
});

const changeStatus = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { action, reason } = statusActionSchema.parse(req.body);
  const article = await applyStatusChange(id, { action, reason }, req);
  res.json({ success: true, data: adminArticle(article) });
});

// ───────────────────────────── SEO ─────────────────────────────

const listSeo = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req);
  const where = {};
  if (req.query.search) where.OR = [{ title: { contains: req.query.search } }];
  const [items, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
      include: { seo: true },
    }),
    prisma.article.count({ where }),
  ]);
  res.json({
    success: true,
    data: {
      items: items.map((a) => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        status: a.status,
        seo: a.seo,
      })),
      total,
      page,
      limit,
    },
  });
});

const updateSeo = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const article = await prisma.article.findUnique({ where: { id } });
  if (!article) throw ApiErrors.notFound('Article not found');

  const data = seoUpdateSchema.parse(req.body);
  const { seoTitle, metaDescription, focusKeyword, metaKeywords, canonicalUrl, ogTitle, ogDescription, twitterTitle, twitterDescription } = data;

  const seo = await prisma.articleSeo.upsert({
    where: { articleId: id },
    create: { articleId: id },
    update: {},
  });

  const payload = {};
  if (seoTitle !== undefined) payload.seoTitle = seoTitle || null;
  if (metaDescription !== undefined) payload.metaDescription = metaDescription || null;
  if (focusKeyword !== undefined) payload.focusKeyword = focusKeyword || null;
  if (metaKeywords !== undefined) {
    payload.metaKeywords = Array.isArray(metaKeywords) ? metaKeywords.join(', ') : metaKeywords || null;
  }
  if (canonicalUrl !== undefined) payload.canonicalUrl = canonicalUrl || null;
  if (ogTitle !== undefined) payload.ogTitle = ogTitle || null;
  if (ogDescription !== undefined) payload.ogDescription = ogDescription || null;
  if (twitterTitle !== undefined) payload.twitterTitle = twitterTitle || null;
  if (twitterDescription !== undefined) payload.twitterDescription = twitterDescription || null;

  const updated = await prisma.articleSeo.update({ where: { id: seo.id }, data: payload });

  res.json({ success: true, data: { articleId: id, seo: updated } });
});

module.exports = {
  list,
  create,
  get,
  update,
  remove,
  changeStatus,
  listSeo,
  updateSeo,
  buildAdminWhere,
  parsePagination,
};
