'use strict';

/**
 * Article (news) core service.
 *
 * Centralizes:
 *  - public visibility scope (status = published AND published_at <= now)
 *  - the editorial lifecycle (draft/pending/scheduled/published + actions)
 *  - view tracking with 6h per-IP debounce
 *  - slug stability
 *  - tag normalization
 *  - HTML sanitization
 */
const prisma = require('../config/prisma');
const { ApiErrors } = require('../utils/apiError');
const { sanitizeArticleHtml } = require('../utils/sanitizeHtml');
const { uniqueSlug, slugify: slugifyPart } = require('../utils/slugify');
const { hashIp } = require('../utils/ipHash');
const { logActivity } = require('./auditService');

const DETAIL_INCLUDE = {
  category: true,
  subcategory: true,
  area: true,
  author: { include: { avatar: true } },
  featuredImage: true,
  tags: { include: { tag: true } },
  seo: true,
};

const LIST_INCLUDE = {
  category: true,
  subcategory: true,
  area: true,
  author: { include: { avatar: true } },
  featuredImage: true,
  tags: { include: { tag: true } },
};

/**
 * CENTRAL public visibility filter — every public query must go through this.
 * status = 'published' AND published_at <= NOW() (or NULL-safe equivalent).
 */
function publicScope(now = new Date()) {
  return {
    status: 'published',
    publishedAt: { lte: now },
  };
}

const SORT_MAP = {
  '-publishedAt': { publishedAt: 'desc' },
  'publishedAt': { publishedAt: 'asc' },
  'views-desc': { views: 'desc' },
  'views': { views: 'desc' },
  'title-asc': { title: 'asc' },
  'title-desc': { title: 'desc' },
  'date-asc': { publishDate: 'asc' },
  'date-desc': { publishDate: 'desc' },
  newest: { publishedAt: 'desc' },
};

// ─────────────────────────── ADMIN CRUD ───────────────────────────

/**
 * Resolve the legacy name-based references (category name, reporter name,
 * subcategory name, area slug) into relational ids. Accepts the new ID
 * fields when provided.
 */
async function resolveRefs(data) {
  const refs = {};

  // category: categoryId (number) | category (name or slug)
  if (data.categoryId !== undefined) {
    const cat = await prisma.category.findUnique({ where: { id: data.categoryId } });
    if (!cat) throw ApiErrors.badRequest('Category not found');
    refs.categoryId = cat.id;
  } else if (data.category !== undefined) {
    const cat =
      (await prisma.category.findFirst({ where: { name: data.category } })) ||
      (await prisma.category.findUnique({ where: { slug: data.category } }));
    if (!cat) throw ApiErrors.badRequest(`Category "${data.category}" not found`);
    refs.categoryId = cat.id;
  }

  // subcategory: subcategoryId | subCategory (name).
  // The admin Add/Edit News form posts a free-text subCategory, so we
  // auto-provision the subcategory under the resolved category when the
  // name is new (name is globally unique; first write wins).
  if (data.subcategoryId !== undefined) {
    if (data.subcategoryId === null) {
      refs.subcategoryId = null;
    } else {
      const sub = await prisma.subcategory.findUnique({ where: { id: data.subcategoryId } });
      if (!sub) throw ApiErrors.badRequest('Sub-category not found');
      refs.subcategoryId = sub.id;
    }
  } else if (data.subCategory) {
    let sub = await prisma.subcategory.findUnique({ where: { name: data.subCategory } });
    if (!sub) {
      if (refs.categoryId === undefined) {
        // Sub-category sent without a category — resolve it globally (no parent to hang it on).
        sub = await prisma.subcategory.findFirst({ where: { name: data.subCategory } });
        if (!sub) throw ApiErrors.badRequest(`Sub-category "${data.subCategory}" not found`);
      } else {
        sub = await prisma.subcategory.create({
          data: {
            name: data.subCategory,
            slug: `${slugifyPart(data.category || 'cat')}-${slugifyPart(data.subCategory)}`,
            parentCategoryId: refs.categoryId,
          },
        });
      }
    }
    refs.subcategoryId = sub.id;
  }

  // author: authorId (reporter) | author (reporter name)
  if (data.authorId !== undefined) {
    const rep = await prisma.reporter.findUnique({ where: { id: data.authorId } });
    if (!rep) throw ApiErrors.badRequest('Author (reporter) not found');
    refs.authorId = rep.id;
  } else if (data.author !== undefined) {
    const rep = await prisma.reporter.findFirst({ where: { name: data.author } });
    if (!rep) throw ApiErrors.badRequest(`Author "${data.author}" not found`);
    refs.authorId = rep.id;
  }

  // area: areaId | area (slug or name)
  if (data.areaId !== undefined) {
    if (data.areaId === null) {
      refs.areaId = null;
    } else {
      const area = await prisma.area.findUnique({ where: { id: data.areaId } });
      if (!area) throw ApiErrors.badRequest('Area not found');
      refs.areaId = area.id;
    }
  } else if (data.area) {
    const area =
      (await prisma.area.findFirst({ where: { name: data.area } })) ||
      (await prisma.area.findUnique({ where: { slug: data.area } }));
    refs.areaId = area ? area.id : null;
  }

  // featured image: featuredImageId | image (URL)
  if (data.featuredImageId !== undefined) {
    refs.featuredImageId = data.featuredImageId || null;
  } else if (data.image !== undefined) {
    if (data.image === null || data.image === '') {
      refs.featuredImageId = null;
    } else {
      const media = await prisma.media.findFirst({
        where: { url: { equals: data.image, mode: 'insensitive' } },
      });
      refs.featuredImageId = media ? media.id : null;
      if (!media) {
        // External URL not in the media library — store nothing (public image
        // will fall back to the frontend's onError handling). Logged for clarity.
        console.warn(`[article] featured image URL not in media library: ${data.image}`);
      }
    }
  }

  return refs;
}

/** Normalize + upsert tags (case-insensitive dedupe). Uses the given client (tx or prisma). */
async function syncTags(client, articleId, tagNames) {
  if (tagNames === undefined) return;
  const cleaned = [...new Set((tagNames || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))];

  // Ensure tag rows exist
  const existing = await client.tag.findMany({ where: { name: { in: cleaned } } });
  const byName = new Map(existing.map((t) => [t.name, t]));
  for (const name of cleaned) {
    if (!byName.has(name)) {
      byName.set(name, await client.tag.create({ data: { name } }));
    }
  }

  // Replace links
  await client.articleTag.deleteMany({ where: { articleId } });
  if (cleaned.length) {
    await client.articleTag.createMany({
      data: cleaned.map((name) => ({ articleId, tagId: byName.get(name).id })),
    });
  }
}

function buildSanitized(data) {
  const out = {};
  const excerpt = data.excerpt ?? data.shortDescription;
  if (excerpt !== undefined) out.excerpt = String(excerpt).slice(0, 500);
  if (data.content !== undefined) out.content = sanitizeArticleHtml(data.content);
  if (data.title !== undefined) out.title = data.title;
  if (data.titleTA !== undefined) out.titleTa = data.titleTA || null;
  if (data.excerptTA !== undefined) out.excerptTa = data.excerptTA || null;
  if (data.contentTA !== undefined) out.contentTa = data.contentTA ? sanitizeArticleHtml(data.contentTA) : null;
  if (data.location !== undefined) out.location = data.location || null;
  if (data.isBreaking !== undefined) out.isBreaking = data.isBreaking;
  if (data.isFeatured !== undefined) out.isFeatured = data.isFeatured;
  return out;
}

async function syncBreakingReference(client, article) {
  if (!client.breakingNews || !article?.id) return;

  if (article.status === 'published' && article.isBreaking) {
    const existing = await client.breakingNews.findFirst({ where: { articleId: article.id } });
    let activeId = existing?.id || null;
    if (existing) {
      await client.breakingNews.update({
        where: { id: existing.id },
        data: {
          headline: article.title,
          categoryId: article.categoryId,
          status: 'live',
          endTime: null,
        },
      });
    } else {
      const created = await client.breakingNews.create({
        data: {
          headline: article.title,
          articleId: article.id,
          categoryId: article.categoryId,
          status: 'live',
        },
      });
      activeId = created.id;
    }
    if (activeId) {
      await client.breakingNews.updateMany({
        where: { articleId: article.id, id: { not: activeId }, status: { not: 'ended' } },
        data: { status: 'ended', endTime: new Date() },
      });
    }
    return;
  }

  await client.breakingNews.updateMany({
    where: { articleId: article.id, status: { not: 'ended' } },
    data: { status: 'ended', endTime: new Date() },
  });
}

function splitDateTime(data) {
  // publishDate (YYYY-MM-DD) + publishTime (HH:MM) — both expressed in IST.
  let publishDate = null; // Date set to UTC midnight of the IST calendar date
  let publishTime = null;
  if (data.scheduledAt) {
    const d = new Date(data.scheduledAt);
    // Store IST wall-clock fields; istInstant() performs the inverse when
    // deriving the absolute publication instant.
    const ist = new Date(d.getTime() + IST_OFFSET_MS);
    publishDate = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
    publishTime = `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
  } else {
    if (data.publishDate) publishDate = new Date(`${data.publishDate}T00:00:00Z`);
    if (data.publishTime) publishTime = data.publishTime;
  }
  return { publishDate, publishTime };
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Combine an IST calendar date + IST wall-clock time into an absolute instant. */
function istInstant(dateUtcMidnight, timeStr) {
  if (!dateUtcMidnight || !timeStr) return null;
  const [hh, mm] = timeStr.split(':').map(Number);
  const d = new Date(dateUtcMidnight);
  const utcMidnightOfDate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  // IST wall-clock -> UTC instant: utc = ist - 5:30
  return new Date(utcMidnightOfDate + hh * 3600 * 1000 + mm * 60 * 1000 - IST_OFFSET_MS);
}

async function createArticle(data, req) {
  const refs = await resolveRefs(data);
  if (refs.categoryId === undefined) throw ApiErrors.badRequest('Category is required');
  if (refs.authorId === undefined) throw ApiErrors.badRequest('Author is required');

  const status = data.status || 'draft';
  const dt = splitDateTime(data);

  // published_at semantics:
  //  - published (now)  -> now
  //  - scheduled        -> publishDate + publishTime
  //  - draft / pending  -> null
  let publishedAt = null;
  if (status === 'published') {
    publishedAt = new Date();
  } else if (status === 'scheduled') {
    publishedAt = istInstant(dt.publishDate, dt.publishTime);
    if (!publishedAt) {
      throw ApiErrors.badRequest('Scheduled articles require publishDate and publishTime');
    }
    if (publishedAt <= new Date()) {
      throw ApiErrors.badRequest('Scheduled time must be in the future');
    }
  }

  const slug = data.slug
    ? (await uniqueSlug(data.title, data.slug, null, prisma.article))
    : (await uniqueSlug(data.title, null, null, prisma.article));

  const article = await prisma.$transaction(async (tx) => {
    const created = await tx.article.create({
      data: {
        slug,
        title: data.title,
        titleTa: data.titleTA || null,
        excerpt: String(data.excerpt ?? data.shortDescription ?? '').slice(0, 500),
        excerptTa: data.excerptTA || null,
        content: sanitizeArticleHtml(data.content),
        contentTa: data.contentTA ? sanitizeArticleHtml(data.contentTA) : null,
        categoryId: refs.categoryId,
        subcategoryId: refs.subcategoryId ?? null,
        areaId: refs.areaId ?? null,
        authorId: refs.authorId,
        location: data.location || null,
        featuredImageId: refs.featuredImageId ?? null,
        isBreaking: data.isBreaking || false,
        isFeatured: data.isFeatured || false,
        status,
        publishDate: dt.publishDate,
        publishTime: dt.publishTime,
        publishedAt,
      },
      include: DETAIL_INCLUDE,
    });

    if (data.tags !== undefined) {
      await syncTags(tx, created.id, data.tags);
      await tx.article.update({ where: { id: created.id }, data: {} }); // touch updated_at
      const tagged = await tx.article.findUnique({ where: { id: created.id }, include: DETAIL_INCLUDE });
      await syncBreakingReference(tx, tagged);
      return tagged;
    }
    await syncBreakingReference(tx, created);
    return created;
  });

  await logActivity({
    req,
    userId: req?.user?.id || null,
    action: 'article.created',
    module: 'news',
    record: article.slug,
    details: `status=${status}`,
  });

  return article;
}

async function updateArticle(id, data, req) {
  const existing = await prisma.article.findUnique({ where: { id } });
  if (!existing) throw ApiErrors.notFound('Article not found');

  const hasRefs =
    data.categoryId !== undefined ||
    data.category !== undefined ||
    data.subcategoryId !== undefined ||
    data.subCategory !== undefined ||
    data.authorId !== undefined ||
    data.author !== undefined ||
    data.areaId !== undefined ||
    data.area !== undefined ||
    data.featuredImageId !== undefined ||
    data.image !== undefined;

  const refs = hasRefs ? await resolveRefs(data) : {};

  const payload = buildSanitized(data);
  if (refs.categoryId !== undefined) payload.categoryId = refs.categoryId;
  if (refs.subcategoryId !== undefined) payload.subcategoryId = refs.subcategoryId;
  if (refs.authorId !== undefined) payload.authorId = refs.authorId;
  if (refs.areaId !== undefined) payload.areaId = refs.areaId;
  if (refs.featuredImageId !== undefined) payload.featuredImageId = refs.featuredImageId;

  if (data.publishDate !== undefined || data.publishTime !== undefined || data.scheduledAt !== undefined) {
    const scheduleInput = data.scheduledAt
      ? { scheduledAt: data.scheduledAt }
      : {
          publishDate: data.publishDate ?? (existing.publishDate ? existing.publishDate.toISOString().slice(0, 10) : undefined),
          publishTime: data.publishTime ?? existing.publishTime ?? undefined,
        };
    const schedule = splitDateTime(scheduleInput);
    payload.publishDate = schedule.publishDate;
    payload.publishTime = schedule.publishTime;
    if (existing.status === 'scheduled') {
      const scheduledAt = istInstant(schedule.publishDate, schedule.publishTime);
      if (!scheduledAt || scheduledAt <= new Date()) {
        throw ApiErrors.badRequest('Scheduled time must be in the future');
      }
      payload.publishedAt = scheduledAt;
    }
  }

  // Slug stability: only change when explicitly requested.
  if (data.slug && data.slug !== existing.slug) {
    const newSlug = await uniqueSlug(data.title || existing.title, data.slug, existing.id, prisma.article);
    payload.slug = newSlug;
  }

  // Status changes via update body are allowed ONLY for create-time values;
  // lifecycle transitions go through /status to preserve the workflow.
  // Exception: editing a draft/pending keeps its status untouched.

  const article = await prisma.$transaction(async (tx) => {
    const updated = await tx.article.update({
      where: { id },
      data: payload,
      include: DETAIL_INCLUDE,
    });
    if (data.tags !== undefined) {
      await syncTags(tx, id, data.tags);
      const tagged = await tx.article.findUnique({ where: { id }, include: DETAIL_INCLUDE });
      await syncBreakingReference(tx, tagged);
      return tagged;
    }
    await syncBreakingReference(tx, updated);
    return updated;
  });

  await logActivity({
    req,
    userId: req?.user?.id || null,
    action: 'article.updated',
    module: 'news',
    record: article.slug,
  });

  return article;
}

async function deleteArticle(id, req) {
  const existing = await prisma.article.findUnique({ where: { id } });
  if (!existing) throw ApiErrors.notFound('Article not found');
  await prisma.article.delete({ where: { id } });
  await logActivity({
    req,
    userId: req?.user?.id || null,
    action: 'article.deleted',
    module: 'news',
    record: existing.slug,
  });
  return { ok: true };
}

async function getArticle(id) {
  const article = await prisma.article.findFirst({ where: { id }, include: DETAIL_INCLUDE });
  if (!article) throw ApiErrors.notFound('Article not found');
  return article;
}

async function listArticles(req) {
  const where = { ...publicScope() };
  const now = new Date();
  where.publishedAt = { lte: now };

  if (req.query.category) {
    const cat =
      (await prisma.category.findFirst({ where: { name: req.query.category } })) ||
      (await prisma.category.findUnique({ where: { slug: req.query.category } }));
    if (!cat) throw ApiErrors.notFound('Category not found');
    where.categoryId = cat.id;
  }
  if (req.query.area) {
    const area =
      (await prisma.area.findFirst({ where: { name: req.query.area } })) ||
      (await prisma.area.findUnique({ where: { slug: req.query.area } }));
    if (!area) throw ApiErrors.badRequest('Area not found');
    where.areaId = area.id;
  }

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(parseInt(req.query.pageSize || req.query.limit, 10) || 9, 100);
  const sort = SORT_MAP[req.query.sort] || { publishedAt: 'desc' };

  const [items, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: sort,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: LIST_INCLUDE,
    }),
    prisma.article.count({ where }),
  ]);

  return { items, total, page, pageSize, hasMore: page * pageSize < total };
}

async function getByCategorySlug(slug, limit = 6) {
  const cat = await prisma.category.findUnique({ where: { slug } });
  if (!cat) return [];
  return prisma.article.findMany({
    where: { ...publicScope(), categoryId: cat.id },
    orderBy: { publishedAt: 'desc' },
    take: limit,
    include: LIST_INCLUDE,
  });
}

async function getBySlug(slug) {
  const article = await prisma.article.findFirst({
    where: { slug, ...publicScope() },
    include: DETAIL_INCLUDE,
  });
  if (!article) return null;
  return article;
}

async function getRelated(slug, count = 4) {
  const current = await prisma.article.findFirst({
    where: { slug },
    select: { id: true, categoryId: true },
  });
  if (!current) return [];
  return prisma.article.findMany({
    where: {
      ...publicScope(),
      categoryId: current.categoryId,
      id: { not: current.id },
    },
    orderBy: { publishedAt: 'desc' },
    take: count,
    include: LIST_INCLUDE,
  });
}

// ─────────────────────────── LIFECYCLE ───────────────────────────

/**
 * Valid transitions:
 *   draft     -> submit           -> pending
 *   pending   -> approve          -> published
 *   pending   -> reject           -> draft (+ reason)
 *   published -> unpublish        -> draft
 *   scheduled -> publish-now      -> published
 *   scheduled -> cancel-schedule  -> draft
 */
const TRANSITIONS = {
  submit: { from: ['draft'], to: 'pending' },
  approve: { from: ['pending'], to: 'published' },
  reject: { from: ['pending'], to: 'draft' },
  unpublish: { from: ['published'], to: 'draft' },
  'publish-now': { from: ['scheduled', 'draft', 'pending'], to: 'published' },
  'cancel-schedule': { from: ['scheduled'], to: 'draft' },
};

async function changeStatus(id, { action, reason }, req) {
  const transition = TRANSITIONS[action];
  if (!transition) throw ApiErrors.invalidTransition(`Unknown action "${action}"`);

  const article = await prisma.article.findUnique({ where: { id }, include: { category: true } });
  if (!article) throw ApiErrors.notFound('Article not found');

  if (!transition.from.includes(article.status)) {
    throw ApiErrors.invalidTransition(
      `Cannot ${action} an article in status "${article.status}" (expected: ${transition.from.join(' | ')})`
    );
  }

  const data = { status: transition.to };
  if (transition.to === 'published') {
    data.publishedAt = article.publishedAt || new Date();
    // If we publish a scheduled article early, clear the schedule fields.
    data.publishDate = null;
    data.publishTime = null;
  }
  if (transition.to === 'draft') {
    data.publishedAt = null;
  }
  if (action === 'cancel-schedule') {
    data.publishDate = null;
    data.publishTime = null;
  }
  if (action === 'reject') {
    data.rejectionReason = reason || null;
  } else if (action === 'approve' || action === 'publish-now' || action === 'submit') {
    data.rejectionReason = null;
  }

  const updated = await prisma.article.update({ where: { id }, data, include: DETAIL_INCLUDE });
  await syncBreakingReference(prisma, updated);

  await logActivity({
    req,
    userId: req?.user?.id || null,
    action: `article.${action}`,
    module: 'news',
    record: updated.slug,
    details: reason ? `reason=${reason}` : null,
  });

  return updated;
}

// ─────────────────────────── VIEW TRACKING ───────────────────────────

const VIEW_DEBOUNCE_MS = 6 * 60 * 60 * 1000;

/**
 * Record a view (debounced: one counted view per article + ipHash per 6h).
 * Returns true when the view was counted.
 */
async function recordView(articleId, { ip, userAgent = null, referrer = null } = {}) {
  const ipHash = hashIp(ip || '');
  const windowStart = new Date(Date.now() - VIEW_DEBOUNCE_MS);

  const recent = await prisma.articleView.findFirst({
    where: { articleId, ipHash, createdAt: { gte: windowStart } },
    select: { id: true },
  });
  if (recent) return false;

  await prisma.$transaction([
    prisma.articleView.create({
      data: {
        articleId,
        ipHash,
        userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
        referrer: referrer ? String(referrer).slice(0, 500) : null,
      },
    }),
    prisma.article.update({
      where: { id: articleId },
      data: { views: { increment: 1 } },
    }),
  ]);
  return true;
}

module.exports = {
  publicScope,
  resolveRefs,
  syncTags,
  createArticle,
  updateArticle,
  deleteArticle,
  getArticle,
  listArticles,
  getByCategorySlug,
  getBySlug,
  getRelated,
  changeStatus,
  recordView,
  TRANSITIONS,
  splitDateTime,
  istInstant,
  DETAIL_INCLUDE,
  LIST_INCLUDE,
  SORT_MAP,
};
