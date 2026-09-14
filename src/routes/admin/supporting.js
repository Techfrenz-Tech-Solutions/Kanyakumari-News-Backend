'use strict';

/**
 * Admin controllers for supporting CMS resources:
 * breaking news, videos, galleries, live events, ads, comments,
 * notifications, social posts, jobs, attractions, e-papers,
 * site settings, dashboard/analytics, activity logs.
 */
const { z } = require('zod');
const prisma = require('../../config/prisma');
const { asyncHandler, ApiErrors } = require('../../utils/apiError');
const { logActivity } = require('../../services/auditService');
const mediaService = require('../../services/mediaService');
const { publicArticleSummary } = require('../../mappers/news');

// ═══════════════════════════ HELPERS ═══════════════════════════

function pageOf(req, defaultLimit = 20) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || defaultLimit, 100);
  return { page, limit, skip: (page - 1) * limit };
}

function paginationMeta(total, page, limit) {
  return { total, page, limit, totalPages: Math.ceil(total / limit) };
}

async function resolveCategory(value) {
  if (!value) return null;
  if (typeof value === 'number') {
    const c = await prisma.category.findUnique({ where: { id: value } });
    if (!c) throw ApiErrors.badRequest('Category not found');
    return c.id;
  }
  const c =
    (await prisma.category.findFirst({ where: { name: value } })) ||
    (await prisma.category.findUnique({ where: { slug: value } }));
  if (!c) throw ApiErrors.badRequest(`Category "${value}" not found`);
  return c.id;
}

// ═══════════════════════ BREAKING NEWS ═══════════════════════

const breakingCreateBase = z.object({
  headline: z.string().trim().min(3).max(300),
  articleId: z.number().int().positive().optional().nullable(),
  category: z.union([z.string(), z.number()]).optional(),
  priority: z.number().int().min(1).max(10).optional(),
  displayDuration: z.number().int().min(1).max(60).optional(),
  startTime: z.coerce.date().optional().nullable(),
  endTime: z.coerce.date().optional().nullable(),
  // Admin UI posts start/end as "DD/MM/YYYY HH:MM" strings; accept ISO too.
});

const breakingCreate = breakingCreateBase.superRefine((v, ctx) => {
  if (v.startTime && v.endTime && v.endTime <= v.startTime) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endTime'], message: 'End time must be after start time' });
  }
});

const breakingUpdate = breakingCreateBase.partial();

const breaking = {
  list: asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageOf(req);
    const where = req.query.status ? { status: req.query.status } : {};
    const [items, total] = await Promise.all([
      prisma.breakingNews.findMany({
        where,
        orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        include: { article: { include: { category: true, featuredImage: true, area: true, author: { include: { avatar: true } }, tags: { include: { tag: true } } } } },
      }),
      prisma.breakingNews.count({ where }),
    ]);
    res.json({ success: true, data: { items, total: paginationMeta(total, page, limit) } });
  }),

  create: asyncHandler(async (req, res) => {
    const data = breakingCreate.parse(req.body);
    let articleId = data.articleId || null;
    let categoryId = await resolveCategory(data.category);

    if (articleId) {
      const article = await prisma.article.findUnique({ where: { id: articleId } });
      if (!article) throw ApiErrors.notFound('Article not found');
      categoryId = categoryId || article.categoryId;
    }

    const row = await prisma.breakingNews.create({
      data: {
        headline: data.headline,
        articleId,
        categoryId,
        priority: data.priority ?? 1,
        displayDuration: data.displayDuration ?? 5,
        startTime: data.startTime || null,
        endTime: data.endTime || null,
        status: data.startTime && data.startTime > new Date() ? 'scheduled' : 'live',
      },
    });
    await logActivity({ req, userId: req.user.id, action: 'breaking.created', module: 'news', record: row.headline });
    res.status(201).json({ success: true, data: row });
  }),

  update: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.breakingNews.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Breaking news not found');

    const data = breakingUpdate.parse(req.body);
    const payload = {};
    if (data.headline !== undefined) payload.headline = data.headline;
    if (data.articleId !== undefined) payload.articleId = data.articleId || null;
    if (data.priority !== undefined) payload.priority = data.priority;
    if (data.displayDuration !== undefined) payload.displayDuration = data.displayDuration;
    if (data.startTime !== undefined) payload.startTime = data.startTime;
    if (data.endTime !== undefined) payload.endTime = data.endTime;
    if (data.category !== undefined) payload.categoryId = await resolveCategory(data.category);

    const row = await prisma.breakingNews.update({ where: { id }, data: payload });
    await logActivity({ req, userId: req.user.id, action: 'breaking.updated', module: 'news', record: row.headline });
    res.json({ success: true, data: row });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.breakingNews.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Breaking news not found');
    await prisma.breakingNews.delete({ where: { id } });
    await logActivity({ req, userId: req.user.id, action: 'breaking.deleted', module: 'news', record: existing.headline });
    res.json({ success: true, data: { ok: true } });
  }),

  activate: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = await prisma.breakingNews.update({ where: { id }, data: { status: 'live' } });
    await logActivity({ req, userId: req.user.id, action: 'breaking.activated', module: 'news', record: row.headline });
    res.json({ success: true, data: row });
  }),

  deactivate: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = await prisma.breakingNews.update({ where: { id }, data: { status: 'ended' } });
    await logActivity({ req, userId: req.user.id, action: 'breaking.deactivated', module: 'news', record: row.headline });
    res.json({ success: true, data: row });
  }),
};

// ════════════════════════ VIDEOS ════════════════════════

const YOUTUBE_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const VIMEO_RE = /vimeo\.com\/(\d{6,12})/;

function parseVideoUrl(url) {
  const yt = url.match(YOUTUBE_RE);
  if (yt) return { type: 'youtube', videoId: yt[1] };
  const vm = url.match(VIMEO_RE);
  if (vm) return { type: 'vimeo', videoId: vm[1] };
  return null;
}

const videoCreateBase = z.object({
  title: z.string().trim().min(1).max(255),
  url: z.string().trim().url(),
  type: z.enum(['youtube', 'vimeo']).optional(),
  thumbnailUrl: z.string().trim().url().optional().nullable(),
  category: z.union([z.string(), z.number()]).optional(),
  duration: z.string().trim().max(10).optional().nullable(),
  description: z.string().trim().max(5000).optional().nullable(),
  status: z.enum(['active', 'inactive']).optional(),
});

const videoCreate = videoCreateBase.refine((v) => parseVideoUrl(v.url), {
  message: 'Video URL must be a valid YouTube or Vimeo URL',
  path: ['url'],
});

const videoUpdate = videoCreateBase.partial();

const videos = {
  list: asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageOf(req);
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.category) {
      const catId = await resolveCategory(req.query.category);
      where.categoryId = catId;
    }
    const [items, total] = await Promise.all([
      prisma.video.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit, include: { category: true } }),
      prisma.video.count({ where }),
    ]);
    res.json({ success: true, data: { items, total: paginationMeta(total, page, limit) } });
  }),

  create: asyncHandler(async (req, res) => {
    const data = videoCreate.parse(req.body);
    const parsed = parseVideoUrl(data.url);
    const row = await prisma.video.create({
      data: {
        title: data.title,
        url: data.url,
        type: parsed.type,
        videoId: parsed.videoId,
        thumbnailUrl: data.thumbnailUrl || null,
        categoryId: await resolveCategory(data.category),
        duration: data.duration || null,
        description: data.description || null,
        status: data.status || 'active',
      },
    });
    await logActivity({ req, userId: req.user.id, action: 'video.created', module: 'media', record: data.title });
    res.status(201).json({ success: true, data: row });
  }),

  update: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.video.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Video not found');

    const data = videoUpdate.parse(req.body);
    const payload = {};
    if (data.title !== undefined) payload.title = data.title;
    if (data.url !== undefined) {
      const parsed = parseVideoUrl(data.url);
      payload.url = data.url;
      payload.type = parsed.type;
      payload.videoId = parsed.videoId;
    }
    if (data.thumbnailUrl !== undefined) payload.thumbnailUrl = data.thumbnailUrl || null;
    if (data.category !== undefined) payload.categoryId = await resolveCategory(data.category);
    if (data.duration !== undefined) payload.duration = data.duration || null;
    if (data.description !== undefined) payload.description = data.description || null;
    if (data.status !== undefined) payload.status = data.status;

    const row = await prisma.video.update({ where: { id }, data: payload });
    res.json({ success: true, data: row });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.video.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Video not found');
    await prisma.video.delete({ where: { id } });
    res.json({ success: true, data: { ok: true } });
  }),
};

// ════════════════════════ GALLERIES ════════════════════════

const galleryCreate = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(5000).optional().nullable(),
  album: z.enum(['events', 'festivals', 'nature', 'news']).optional(),
  category: z.union([z.string(), z.number()]).optional(),
  coverImageId: z.number().int().positive().optional().nullable(),
  status: z.enum(['active', 'inactive']).optional(),
});

const galleryUpdate = galleryCreate.partial();

const galleries = {
  list: asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageOf(req);
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.album) where.album = req.query.album;
    const [items, total] = await Promise.all([
      prisma.gallery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { coverImage: true, _count: { select: { images: true } } },
      }),
      prisma.gallery.count({ where }),
    ]);
    res.json({
      success: true,
      data: {
        items: items.map((g) => ({
          ...g,
          coverUrl: g.coverImage?.url || null,
          imageCount: g._count.images,
        })),
        total: paginationMeta(total, page, limit),
      },
    });
  }),

  create: asyncHandler(async (req, res) => {
    const data = galleryCreate.parse(req.body);
    const row = await prisma.gallery.create({
      data: {
        title: data.title,
        description: data.description || null,
        album: data.album || 'news',
        categoryId: await resolveCategory(data.category),
        coverImageId: data.coverImageId || null,
        status: data.status || 'active',
      },
      include: { coverImage: true, _count: { select: { images: true } } },
    });
    await logActivity({ req, userId: req.user.id, action: 'gallery.created', module: 'media', record: data.title });
    res.status(201).json({
      success: true,
      data: { ...row, coverUrl: row.coverImage?.url || null, imageCount: row._count.images },
    });
  }),

  update: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.gallery.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Gallery not found');

    const data = galleryUpdate.parse(req.body);
    const payload = {};
    if (data.title !== undefined) payload.title = data.title;
    if (data.description !== undefined) payload.description = data.description || null;
    if (data.album !== undefined) payload.album = data.album;
    if (data.category !== undefined) payload.categoryId = await resolveCategory(data.category);
    if (data.coverImageId !== undefined) payload.coverImageId = data.coverImageId || null;
    if (data.status !== undefined) payload.status = data.status;

    const row = await prisma.gallery.update({ where: { id }, data: payload, include: { coverImage: true, _count: { select: { images: true } } } });
    res.json({ success: true, data: { ...row, coverUrl: row.coverImage?.url || null, imageCount: row._count.images } });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.gallery.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Gallery not found');
    await prisma.gallery.delete({ where: { id } }); // cascade to gallery_images
    res.json({ success: true, data: { ok: true } });
  }),
};

// ════════════════════════ LIVE EVENTS ════════════════════════

const liveEventCreate = z.object({
  eventTitle: z.string().trim().min(1).max(255),
  category: z.union([z.string(), z.number()]).optional(),
  status: z.enum(['scheduled', 'live', 'ended']).optional(),
});

const liveEvents = {
  list: asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageOf(req);
    const where = req.query.status ? { status: req.query.status } : {};
    const [items, total] = await Promise.all([
      prisma.liveEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { updates: { orderBy: { createdAt: 'desc' }, take: 50 } },
      }),
      prisma.liveEvent.count({ where }),
    ]);
    res.json({ success: true, data: { items, total: paginationMeta(total, page, limit) } });
  }),

  create: asyncHandler(async (req, res) => {
    const data = liveEventCreate.parse(req.body);
    const row = await prisma.liveEvent.create({
      data: {
        eventTitle: data.eventTitle,
        categoryId: await resolveCategory(data.category),
        status: data.status || 'scheduled',
        startedAt: data.status === 'live' ? new Date() : null,
      },
    });
    await logActivity({ req, userId: req.user.id, action: 'live.created', module: 'news', record: data.eventTitle });
    res.status(201).json({ success: true, data: row });
  }),

  update: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.liveEvent.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Live event not found');

    const data = liveEventCreate.partial().parse(req.body);
    const payload = {};
    if (data.eventTitle !== undefined) payload.eventTitle = data.eventTitle;
    if (data.category !== undefined) payload.categoryId = await resolveCategory(data.category);
    if (data.status !== undefined) {
      payload.status = data.status;
      if (data.status === 'live' && !existing.startedAt) payload.startedAt = new Date();
      if (data.status === 'ended') payload.endedAt = new Date();
    }
    const row = await prisma.liveEvent.update({ where: { id }, data: payload });
    res.json({ success: true, data: row });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.liveEvent.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Live event not found');
    await prisma.liveEvent.delete({ where: { id } });
    res.json({ success: true, data: { ok: true } });
  }),

  addUpdate: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const event = await prisma.liveEvent.findUnique({ where: { id } });
    if (!event) throw ApiErrors.notFound('Live event not found');

    const { text, type, pinned } = z
      .object({ text: z.string().trim().min(1).max(5000), type: z.string().trim().max(30).optional(), pinned: z.boolean().optional() })
      .parse(req.body);

    const row = await prisma.liveUpdate.create({
      data: { eventId: id, text, type: type || 'update', pinned: pinned || false },
    });
    await logActivity({ req, userId: req.user.id, action: 'live.update-added', module: 'news', record: event.eventTitle });
    res.status(201).json({ success: true, data: row });
  }),
};

// ═══════════════════════════ ADS ═══════════════════════════

/**
 * Canonical slot values: leaderboard | rectangle | inline | footer | popup
 * Legacy admin labels are mapped here (the single mapping helper).
 */
const ADMIN_AD_LABEL_MAP = {
  'header banner': 'leaderboard',
  header_banner: 'leaderboard',
  leaderboard: 'leaderboard',
  sidebar: 'rectangle',
  rectangle: 'rectangle',
  'in-article': 'inline',
  in_article: 'inline',
  inline: 'inline',
  'footer banner': 'footer',
  footer_banner: 'footer',
  footer: 'footer',
  popup: 'popup',
};

function normalizeAdPosition(value) {
  if (!value) return 'leaderboard';
  return ADMIN_AD_LABEL_MAP[String(value).toLowerCase().trim()] || 'leaderboard';
}

const adCreateBase = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(500).optional().nullable(),
  imageId: z.number().int().positive().optional().nullable(),
  position: z.string().trim().max(30).optional(),
  linkUrl: z.string().trim().url().optional().nullable(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  status: z.enum(['active', 'inactive']).optional(),
});

const adCreate = adCreateBase.refine((v) => v.startDate < v.endDate, {
  message: 'Start date must be before end date',
  path: ['endDate'],
});

const adUpdate = adCreateBase.partial();

const ads = {
  list: asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageOf(req);
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.position) where.position = normalizeAdPosition(req.query.position);
    const [items, total] = await Promise.all([
      prisma.advertisement.findMany({ where, orderBy: { startDate: 'desc' }, skip, take: limit, include: { image: true } }),
      prisma.advertisement.count({ where }),
    ]);
    res.json({
      success: true,
      data: {
        items: items.map((a) => ({ ...a, imageUrl: a.image?.url || null, position: a.position })),
        total: paginationMeta(total, page, limit),
      },
    });
  }),

  create: asyncHandler(async (req, res) => {
    const data = adCreate.parse(req.body);
    const row = await prisma.advertisement.create({
      data: {
        title: data.title,
        description: data.description || null,
        imageId: data.imageId || null,
        position: normalizeAdPosition(data.position),
        linkUrl: data.linkUrl || null,
        startDate: data.startDate,
        endDate: data.endDate,
        status: data.status || 'active',
      },
      include: { image: true },
    });
    await logActivity({ req, userId: req.user.id, action: 'ad.created', module: 'ads', record: data.title });
    res.status(201).json({ success: true, data: { ...row, imageUrl: row.image?.url || null } });
  }),

  update: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.advertisement.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Advertisement not found');

    const data = adUpdate.parse(req.body);
    const payload = {};
    if (data.title !== undefined) payload.title = data.title;
    if (data.description !== undefined) payload.description = data.description || null;
    if (data.imageId !== undefined) payload.imageId = data.imageId || null;
    if (data.position !== undefined) payload.position = normalizeAdPosition(data.position);
    if (data.linkUrl !== undefined) payload.linkUrl = data.linkUrl || null;
    if (data.startDate !== undefined) payload.startDate = data.startDate;
    if (data.endDate !== undefined) payload.endDate = data.endDate;
    if (data.status !== undefined) payload.status = data.status;

    const row = await prisma.advertisement.update({ where: { id }, data: payload, include: { image: true } });
    await logActivity({ req, userId: req.user.id, action: 'ad.updated', module: 'ads', record: row.title });
    res.json({ success: true, data: { ...row, imageUrl: row.image?.url || null } });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.advertisement.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Advertisement not found');
    await prisma.advertisement.delete({ where: { id } });
    await logActivity({ req, userId: req.user.id, action: 'ad.deleted', module: 'ads', record: existing.title });
    res.json({ success: true, data: { ok: true } });
  }),
};

// ═════════════════════════ COMMENTS ═════════════════════════

const comments = {
  list: asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageOf(req, 30);
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.articleId) where.articleId = parseInt(req.query.articleId, 10);
    if (req.query.search) where.OR = [{ name: { contains: req.query.search } }, { body: { contains: req.query.search } }];

    const [items, total] = await Promise.all([
      prisma.comment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { article: { select: { id: true, title: true, slug: true } }, reader: { select: { id: true, email: true, name: true } } },
      }),
      prisma.comment.count({ where }),
    ]);
    res.json({ success: true, data: { items, total: paginationMeta(total, page, limit) } });
  }),

  setStatus: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.comment.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Comment not found');
    const { status } = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'spam']) }).parse(req.body);
    const row = await prisma.comment.update({ where: { id }, data: { status } });
    await logActivity({
      req,
      userId: req.user.id,
      action: `comment.${status}`,
      module: 'comments',
      record: `#${id}`,
    });
    res.json({ success: true, data: row });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.comment.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Comment not found');
    await prisma.comment.delete({ where: { id } });
    await logActivity({ req, userId: req.user.id, action: 'comment.deleted', module: 'comments', record: `#${id}` });
    res.json({ success: true, data: { ok: true } });
  }),
};

// ═════════════════════════ NOTIFICATIONS ═════════════════════════

const notificationCreate = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(5000),
  link: z.string().trim().url().max(300).optional().nullable(),
  type: z.string().trim().max(30).optional(),
  target: z.string().trim().max(30).optional(),
  status: z.enum(['draft', 'scheduled', 'sent']).optional(),
  scheduledAt: z.coerce.date().optional().nullable(),
});

const notifications = {
  list: asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageOf(req);
    const where = req.query.status ? { status: req.query.status } : {};
    const [items, total] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.notification.count({ where }),
    ]);
    res.json({ success: true, data: { items, total: paginationMeta(total, page, limit) } });
  }),

  create: asyncHandler(async (req, res) => {
    const data = notificationCreate.parse(req.body);
    const row = await prisma.notification.create({
      data: {
        title: data.title,
        message: data.message,
        link: data.link || null,
        type: data.type || 'general',
        target: data.target || 'all',
        status: data.status || 'draft',
        scheduledAt: data.scheduledAt || null,
      },
    });
    await logActivity({ req, userId: req.user.id, action: 'notification.created', module: 'settings', record: data.title });
    res.status(201).json({ success: true, data: row });
  }),

  update: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.notification.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Notification not found');
    const data = notificationCreate.partial().parse(req.body);
    const payload = {};
    for (const k of ['title', 'message', 'link', 'type', 'target', 'status', 'scheduledAt']) {
      if (data[k] !== undefined) payload[k] = data[k];
    }
    const row = await prisma.notification.update({ where: { id }, data: payload });
    await logActivity({ req, userId: req.user.id, action: 'notification.updated', module: 'settings', record: row.title });
    res.json({ success: true, data: row });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.notification.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Notification not found');
    await prisma.notification.delete({ where: { id } });
    res.json({ success: true, data: { ok: true } });
  }),
};

// ═════════════════════════ SOCIAL POSTS ═════════════════════════

const socialPostCreate = z.object({
  platform: z.enum(['facebook', 'instagram', 'twitter', 'youtube', 'telegram']),
  articleId: z.number().int().positive(),
  caption: z.string().trim().min(1).max(5000),
  hashtags: z.string().trim().max(255).optional().nullable(),
  scheduledAt: z.coerce.date().optional().nullable(),
  status: z.enum(['draft', 'scheduled', 'sent']).optional(),
});

const socialPosts = {
  list: asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageOf(req);
    const where = {};
    if (req.query.platform) where.platform = req.query.platform;
    if (req.query.status) where.status = req.query.status;
    const [items, total] = await Promise.all([
      prisma.socialPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { article: { select: { id: true, title: true, slug: true } } },
      }),
      prisma.socialPost.count({ where }),
    ]);
    res.json({ success: true, data: { items, total: paginationMeta(total, page, limit) } });
  }),

  create: asyncHandler(async (req, res) => {
    const data = socialPostCreate.parse(req.body);
    const article = await prisma.article.findUnique({ where: { id: data.articleId } });
    if (!article) throw ApiErrors.notFound('Article not found');
    const row = await prisma.socialPost.create({
      data: {
        platform: data.platform,
        articleId: data.articleId,
        caption: data.caption,
        hashtags: data.hashtags || null,
        scheduledAt: data.scheduledAt || null,
        status: data.status || 'draft',
      },
      include: { article: { select: { id: true, title: true, slug: true } } },
    });
    await logActivity({ req, userId: req.user.id, action: 'social.created', module: 'settings', record: data.platform });
    res.status(201).json({ success: true, data: row });
  }),

  update: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.socialPost.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Social post not found');
    const data = socialPostCreate.partial().parse(req.body);
    const payload = {};
    for (const k of ['platform', 'caption', 'hashtags', 'scheduledAt', 'status']) {
      if (data[k] !== undefined) payload[k] = data[k];
    }
    if (data.articleId !== undefined) payload.articleId = data.articleId;
    const row = await prisma.socialPost.update({ where: { id }, data: payload });
    res.json({ success: true, data: row });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.socialPost.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Social post not found');
    await prisma.socialPost.delete({ where: { id } });
    res.json({ success: true, data: { ok: true } });
  }),
};

// ════════════════════════════ JOBS ════════════════════════════

const jobCreate = z.object({
  title: z.string().trim().min(1).max(255),
  org: z.string().trim().max(150).optional().nullable(),
  location: z.string().trim().max(120).optional().nullable(),
  type: z.enum(['govt', 'private', 'teaching', 'bank']).optional(),
  lastDate: z.coerce.date(),
  applyUrl: z.string().trim().url().max(500).optional().nullable(),
  status: z.enum(['active', 'inactive']).optional(),
});

const jobs = {
  list: asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageOf(req);
    const where = req.query.status ? { status: req.query.status } : {};
    const [items, total] = await Promise.all([
      prisma.jobListing.findMany({ where, orderBy: { lastDate: 'desc' }, skip, take: limit }),
      prisma.jobListing.count({ where }),
    ]);
    res.json({ success: true, data: { items, total: paginationMeta(total, page, limit) } });
  }),

  create: asyncHandler(async (req, res) => {
    const data = jobCreate.parse(req.body);
    const row = await prisma.jobListing.create({
      data: {
        title: data.title,
        org: data.org || null,
        location: data.location || null,
        type: data.type || 'private',
        lastDate: data.lastDate,
        applyUrl: data.applyUrl || null,
        status: data.status || 'active',
      },
    });
    await logActivity({ req, userId: req.user.id, action: 'job.created', module: 'news', record: data.title });
    res.status(201).json({ success: true, data: row });
  }),

  update: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.jobListing.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Job not found');
    const data = jobCreate.partial().parse(req.body);
    const payload = {};
    for (const k of ['title', 'org', 'location', 'type', 'lastDate', 'applyUrl', 'status']) {
      if (data[k] !== undefined) payload[k] = data[k];
    }
    const row = await prisma.jobListing.update({ where: { id }, data: payload });
    res.json({ success: true, data: row });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.jobListing.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Job not found');
    await prisma.jobListing.delete({ where: { id } });
    res.json({ success: true, data: { ok: true } });
  }),
};

// ════════════════════════ ATTRACTIONS ════════════════════════

const attractionCreate = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(5000).optional().nullable(),
  imageId: z.number().int().positive().optional().nullable(),
  category: z.string().trim().max(50).optional().nullable(),
  timings: z.string().trim().max(120).optional().nullable(),
  entryFee: z.string().trim().max(80).optional().nullable(),
  status: z.enum(['active', 'inactive']).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

const attractions = {
  list: asyncHandler(async (req, res) => {
    const rows = await prisma.touristAttraction.findMany({
      where: req.query.status ? { status: req.query.status } : {},
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { image: true },
    });
    res.json({ success: true, data: rows.map((a) => ({ ...a, imageUrl: a.image?.url || null })) });
  }),

  create: asyncHandler(async (req, res) => {
    const data = attractionCreate.parse(req.body);
    const row = await prisma.touristAttraction.create({
      data: {
        name: data.name,
        description: data.description || null,
        imageId: data.imageId || null,
        category: data.category || null,
        timings: data.timings || null,
        entryFee: data.entryFee || null,
        status: data.status || 'active',
        sortOrder: data.sortOrder ?? 0,
      },
      include: { image: true },
    });
    await logActivity({ req, userId: req.user.id, action: 'attraction.created', module: 'news', record: data.name });
    res.status(201).json({ success: true, data: { ...row, imageUrl: row.image?.url || null } });
  }),

  update: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.touristAttraction.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Attraction not found');
    const data = attractionCreate.partial().parse(req.body);
    const payload = {};
    for (const k of ['name', 'description', 'imageId', 'category', 'timings', 'entryFee', 'status', 'sortOrder']) {
      if (data[k] !== undefined) payload[k] = data[k];
    }
    const row = await prisma.touristAttraction.update({ where: { id }, data: payload, include: { image: true } });
    res.json({ success: true, data: { ...row, imageUrl: row.image?.url || null } });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.touristAttraction.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Attraction not found');
    await prisma.touristAttraction.delete({ where: { id } });
    res.json({ success: true, data: { ok: true } });
  }),
};

// ═══════════════════════════ E-PAPERS ═══════════════════════════

const ePapers = {
  list: asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageOf(req);
    const [items, total] = await Promise.all([
      prisma.ePaper.findMany({ orderBy: { paperDate: 'desc' }, skip, take: limit }),
      prisma.ePaper.count(),
    ]);
    res.json({ success: true, data: { items, total: paginationMeta(total, page, limit) } });
  }),

  create: asyncHandler(async (req, res) => {
    if (!req.file) throw ApiErrors.badRequest('Missing PDF file (field "pdf")');
    const { buffer, originalname, size } = req.file;
    const { paperDate } = z.object({ paperDate: z.coerce.date() }).parse(req.body);

    const media = await mediaService.processUpload(buffer, originalname, size, { kind: 'pdf', userId: req.user.id, req });
    const dateKey = new Date(Date.UTC(paperDate.getUTCFullYear(), paperDate.getUTCMonth(), paperDate.getUTCDate()));
    const existing = await prisma.ePaper.findUnique({ where: { paperDate: dateKey } });
    if (existing) {
      // Replace: delete old media row + file, keep same date
      await mediaService.deleteMedia({ id: parseInt(existing.pdfPath.replace(/\D/g, '') || '0', 10) });
      await prisma.ePaper.update({ where: { id: existing.id }, data: { pdfPath: String(media.id), pdfUrl: media.url } });
      const row = await prisma.ePaper.findUnique({ where: { id: existing.id } });
      return res.json({ success: true, data: row, replaced: true });
    }
    const row = await prisma.ePaper.create({ data: { paperDate: dateKey, pdfPath: String(media.id), pdfUrl: media.url } });
    await logActivity({ req, userId: req.user.id, action: 'epaper.created', module: 'media', record: row.paperDate.toISOString().slice(0, 10) });
    res.status(201).json({ success: true, data: row });
  }),

  update: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.ePaper.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('E-paper not found');
    const { paperDate } = z.object({ paperDate: z.coerce.date() }).parse(req.body);
    const row = await prisma.ePaper.update({
      where: { id },
      data: { paperDate: new Date(Date.UTC(paperDate.getUTCFullYear(), paperDate.getUTCMonth(), paperDate.getUTCDate())) },
    });
    res.json({ success: true, data: row });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.ePaper.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('E-paper not found');
    const mediaId = parseInt(existing.pdfPath.replace(/\D/g, '') || '0', 10);
    if (mediaId) await mediaService.deleteMedia({ id: mediaId });
    await prisma.ePaper.delete({ where: { id } });
    res.json({ success: true, data: { ok: true } });
  }),
};

// ═══════════════════════ SITE SETTINGS ═══════════════════════

// Admin ContactUs page fields (Kanyakumari-Admin-Panel src/pages/ContactUs.jsx,
// production f3d0d38). The UI explicitly documents mapEmbedUrl as a Google
// Maps embed URL ("Google Maps → Share → Embed a map"), so it is validated
// as https + google.com host + /maps/ path. whatsapp is a click-to-chat
// phone number (wa.me/<digits>?text=...), not a URL.
const googleMapsEmbedUrl = z
  .string()
  .trim()
  .max(2083)
  .refine((v) => {
    let u;
    try {
      u = new URL(v);
    } catch {
      return false;
    }
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host !== 'google.com' && !host.endsWith('.google.com')) return false;
    return u.pathname.startsWith('/maps/');
  }, 'mapEmbedUrl must be a Google Maps embed URL (https://…google.com/maps/…)');

const contactInfoSchema = z
  .object({
    officeName: z.string().trim().max(200).optional().nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    city: z.string().trim().max(120).optional().nullable(),
    state: z.string().trim().max(120).optional().nullable(),
    pincode: z.string().trim().max(20).optional().nullable(),
    phone: z.string().trim().max(40).optional().nullable(),
    altPhone: z.string().trim().max(40).optional().nullable(),
    email: z.string().trim().email().max(190).optional().nullable(),
    supportEmail: z.string().trim().email().max(190).optional().nullable(),
    website: z.string().trim().url().max(300).optional().nullable(),
    mapEmbedUrl: googleMapsEmbedUrl.optional().nullable(),
    whatsapp: z.string().trim().max(40).optional().nullable(),
    workingHours: z.string().trim().max(200).optional().nullable(),
  })
  .strict();

const settingsUpdate = z.object({
  siteName: z.string().trim().min(1).max(120).optional(),
  tagline: z.string().trim().max(255).optional().nullable(),
  logoId: z.number().int().positive().optional().nullable(),
  faviconId: z.number().int().positive().optional().nullable(),
  contactEmail: z.string().trim().email().max(190).optional().nullable(),
  contactPhone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  headerNote: z.string().trim().max(255).optional().nullable(),
  footerText: z.string().trim().max(5000).optional().nullable(),
  socialFacebook: z.string().trim().url().max(300).optional().nullable(),
  socialTwitter: z.string().trim().url().max(300).optional().nullable(),
  socialInstagram: z.string().trim().url().max(300).optional().nullable(),
  socialYoutube: z.string().trim().url().max(300).optional().nullable(),
  socialTelegram: z.string().trim().url().max(300).optional().nullable(),
  socialWhatsapp: z.string().trim().url().max(300).optional().nullable(),
  socialGooglenews: z.string().trim().url().max(300).optional().nullable(),
  // Admin ContactUs page office/contact configuration (13-field form).
  // Stored as JSON on SiteSettings.contactInfo; only whitelisted keys are
  // accepted. null clears the stored object.
  contactInfo: contactInfoSchema.optional().nullable(),
});

function settingsDto(row) {
  return {
    id: row.id,
    siteName: row.siteName,
    tagline: row.tagline,
    logoId: row.logoId,
    logo: row.logo?.url || null,
    faviconId: row.faviconId,
    favicon: row.favicon?.url || null,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    address: row.address,
    headerNote: row.headerNote,
    footerText: row.footerText,
    socialFacebook: row.socialFacebook,
    socialTwitter: row.socialTwitter,
    socialInstagram: row.socialInstagram,
    socialYoutube: row.socialYoutube,
    socialTelegram: row.socialTelegram,
    socialWhatsapp: row.socialWhatsapp,
    socialGooglenews: row.socialGooglenews,
    contactInfo: row.contactInfo ?? null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

const settings = {
  get: asyncHandler(async (req, res) => {
    let row = await prisma.siteSettings.findUnique({ where: { id: 1 }, include: { logo: true, favicon: true } });
    if (!row) {
      row = await prisma.siteSettings.create({ data: { id: 1 } });
    }
    res.json({ success: true, data: settingsDto(row) });
  }),

  update: asyncHandler(async (req, res) => {
    const data = settingsUpdate.parse(req.body);
    let row = await prisma.siteSettings.findUnique({ where: { id: 1 } });
    if (!row) row = await prisma.siteSettings.create({ data: { id: 1 } });

    const payload = {};
    for (const k of Object.keys(data)) {
      if (data[k] !== undefined) payload[k] = data[k];
    }
    const updated = await prisma.siteSettings.update({ where: { id: 1 }, data: payload, include: { logo: true, favicon: true } });
    await logActivity({ req, userId: req.user.id, action: 'settings.updated', module: 'settings', record: 'site' });
    res.json({ success: true, data: settingsDto(updated) });
  }),
};

// ═══════════════════════ DASHBOARD / ANALYTICS ═══════════════════════

function periodStart(range) {
  const now = new Date();
  switch (range) {
    case 'today':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    case 'yesterday': {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
      return d;
    }
    case '7d':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));
    case '30d':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
    default:
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
}

const dashboardStats = asyncHandler(async (req, res) => {
  const range = ['today', 'yesterday', '7d', '30d'].includes(req.query.range) ? req.query.range : 'today';
  const start = periodStart(range);
  const now = new Date();

  const [
    total,
    published,
    draft,
    pending,
    scheduled,
    breaking,
    totalViews,
    totalComments,
    totalReporters,
    publishedInPeriod,
    viewsInPeriod,
    commentsInPeriod,
  ] = await Promise.all([
    prisma.article.count(),
    prisma.article.count({ where: { status: 'published' } }),
    prisma.article.count({ where: { status: 'draft' } }),
    prisma.article.count({ where: { status: 'pending' } }),
    prisma.article.count({ where: { status: 'scheduled' } }),
    prisma.article.count({ where: { isBreaking: true, status: 'published' } }),
    prisma.articleView.count(),
    prisma.comment.count(),
    prisma.reporter.count({ where: { status: 'active' } }),
    prisma.article.count({ where: { publishedAt: { gte: start, lte: now } } }),
    prisma.articleView.count({ where: { createdAt: { gte: start } } }),
    prisma.comment.count({ where: { createdAt: { gte: start } } }),
  ]);

  // viewsTrend: last 7 days of view counts
  const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));
  const viewRows = await prisma.articleView.groupBy({
    by: ['createdAt'],
    where: { createdAt: { gte: trendStart } },
    _count: true,
  });
  // groupBy on DateTime returns full timestamps — bucket by day in JS
  const buckets = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    buckets[d.toISOString().slice(0, 10)] = 0;
  }
  for (const r of viewRows) {
    const day = r.createdAt.toISOString().slice(0, 10);
    if (buckets[day] !== undefined) buckets[day] += r._count;
  }
  const viewsTrend = Object.entries(buckets).map(([date, count]) => ({ date, count }));

  // categoryDistribution: articles per category (published)
  const catRows = await prisma.article.groupBy({
    by: ['categoryId'],
    where: { status: 'published' },
    _count: true,
  });
  const catNames = await prisma.category.findMany({ select: { id: true, name: true } });
  const nameById = new Map(catNames.map((c) => [c.id, c.name]));
  const categoryDistribution = catRows
    .map((r) => ({ category: nameById.get(r.categoryId) || 'Unknown', count: r._count }))
    .sort((a, b) => b.count - a.count);

  // weeklyPublished: articles published in last 4 ISO weeks
  const weekStart = new Date(trendStart);
  const weeklyBuckets = {};
  for (let i = 3; i >= 0; i--) {
    const d = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() - i * 7));
    weeklyBuckets[`week-${d.toISOString().slice(0, 10)}`] = 0;
  }
  const publishedRows = await prisma.article.findMany({
    where: { status: 'published', publishedAt: { gte: weekStart } },
    select: { publishedAt: true },
  });
  for (const a of publishedRows) {
    const d = a.publishedAt;
    // find the bucket start (Monday-ish anchor = 6 days before "now")
    const keyDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    let bucketKey = null;
    for (const [k, ] of Object.entries(weeklyBuckets)) {
      const anchor = new Date(`${k.slice(5)}T00:00:00Z`);
      if (keyDate >= anchor && keyDate < new Date(anchor.getTime() + 7 * 86400000)) {
        bucketKey = k;
        break;
      }
    }
    if (bucketKey) weeklyBuckets[bucketKey] += 1;
  }
  const weeklyPublished = Object.entries(weeklyBuckets).map(([week, count]) => ({ week: week.replace('week-', ''), count }));

  // trafficSources: from article_views.referrer (top 5)
  const refRows = await prisma.articleView.groupBy({
    by: ['referrer'],
    where: { referrer: { not: null }, createdAt: { gte: start } },
    _count: true,
    orderBy: { _count: { referrer: 'desc' } },
    take: 5,
  });
  const domainOf = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return 'other';
    }
  };
  const trafficSources = refRows.map((r) => ({ source: domainOf(r.referrer), count: r._count }));

  // deviceDistribution: naive UA sniffing over the period's views
  const uaRows = await prisma.articleView.findMany({
    where: { userAgent: { not: null }, createdAt: { gte: start } },
    select: { userAgent: true },
  });
  const devices = { mobile: 0, desktop: 0, tablet: 0, other: 0 };
  for (const r of uaRows) {
    const ua = (r.userAgent || '').toLowerCase();
    if (/bot|crawl|spider/i.test(ua)) continue;
    if (/iphone|ipad|android|mobile/i.test(ua)) {
      if (/ipad|tablet/i.test(ua)) devices.tablet += 1;
      else devices.mobile += 1;
    } else if (/windows|macintosh|linux|x11/i.test(ua)) {
      devices.desktop += 1;
    } else {
      devices.other += 1;
    }
  }
  const deviceDistribution = Object.entries(devices)
    .filter(([, v]) => v > 0)
    .map(([device, count]) => ({ device, count }));

  res.json({
    success: true,
    data: {
      range,
      total,
      published,
      publishedToday: publishedInPeriod,
      draft,
      pending,
      scheduled,
      breaking,
      totalViews,
      totalComments,
      totalReporters,
      viewsInPeriod,
      commentsInPeriod,
      viewsTrend,
      categoryDistribution,
      weeklyPublished,
      trafficSources,
      deviceDistribution,
    },
  });
});

const topArticles = asyncHandler(async (req, res) => {
  const range = ['today', 'yesterday', '7d', '30d'].includes(req.query.range) ? req.query.range : '7d';
  const start = periodStart(range);
  const take = Math.min(parseInt(req.query.limit, 10) || 10, 50);

  const rows = await prisma.articleView.groupBy({
    by: ['articleId'],
    where: { createdAt: { gte: start } },
    _count: true,
    orderBy: { _count: { articleId: 'desc' } },
    take,
  });
  const ids = rows.map((r) => r.articleId);
  const articles = await prisma.article.findMany({
    where: { id: { in: ids } },
    include: { featuredImage: true, category: true },
  });
  const byId = new Map(articles.map((a) => [a.id, a]));
  const items = rows
    .map((r) => {
      const a = byId.get(r.articleId);
      return a
        ? { ...publicArticleSummary(a), viewCount: r._count }
        : { articleId: r.articleId, viewCount: r._count };
    })
    .filter((x) => x.slug);

  res.json({ success: true, data: { range, items } });
});

const activityLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = pageOf(req, 30);
  const where = {};
  if (req.query.action) where.action = req.query.action;
  if (req.query.module) where.module = req.query.module;
  if (req.query.userId) where.userId = parseInt(req.query.userId, 10);
  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    }),
    prisma.activityLog.count({ where }),
  ]);
  res.json({ success: true, data: { items, total: paginationMeta(total, page, limit) } });
});

module.exports = {
  breaking,
  videos,
  galleries,
  liveEvents,
  ads,
  comments,
  notifications,
  socialPosts,
  jobs,
  attractions,
  ePapers,
  settings,
  dashboardStats,
  topArticles,
  activityLogs,
  normalizeAdPosition,
  parseVideoUrl,
  settingsUpdate,
  contactInfoSchema,
};
