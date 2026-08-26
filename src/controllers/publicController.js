'use strict';

/**
 * PUBLIC API controllers.
 *
 * Contract source: kanyakumari-news-frontend/src/services/newsService.js
 * (19 methods) + the component field consumption verified in the source.
 *
 * Visibility is ALWAYS enforced via articleService.publicScope()
 * (status = published AND published_at <= now).
 */
const prisma = require('../config/prisma');
const { Prisma } = require('@prisma/client');
const env = require('../config/env');
const { asyncHandler, ApiErrors } = require('../utils/apiError');
const articleService = require('../services/articleService');
const weatherProvider = require('../services/providers/weatherProvider');
const marketProvider = require('../services/providers/marketProvider');
const readerAuthService = require('../services/readerAuthService');
const mailService = require('../services/mailService');
const {
  publicArticleSummary,
  publicArticleDetail,
  breakingDto,
} = require('../mappers/news');
const { publicCategory } = require('../mappers/taxonomy');
const { clientIp } = require('../utils/ipHash');

const { publicScope, getBySlug, getRelated, recordView } = articleService;

/** Resolve a category slug to its row (404 when missing). */
async function requireCategory(slug) {
  const cat = await prisma.category.findUnique({ where: { slug } });
  if (!cat) throw ApiErrors.notFound('Category not found');
  return cat;
}

/** Resolve an area slug (400 when unknown). */
async function requireArea(slug) {
  const area = await prisma.area.findUnique({ where: { slug } });
  if (!area) throw ApiErrors.badRequest('Area not found');
  return area;
}

// ══════════════════════════ HOME ══════════════════════════

/**
 * GET /api/home
 * One-stop payload for the homepage:
 * { hero[], breaking[], latest {items, hasMore, total}, trending[],
 *   categories[], areas[], ads[], site {...} }
 */
const home = asyncHandler(async (req, res) => {
  const now = new Date();
  const scope = publicScope(now);
  const [hero, breaking, latestRows, latestTotal, categories, areas, ads, settings] =
    await Promise.all([
      // Hero: featured first, fallback to latest
      prisma.article.findMany({
        where: { ...scope, isFeatured: true },
        orderBy: { publishedAt: 'desc' },
        take: 5,
        include: articleService.LIST_INCLUDE,
      }).then(async (rows) => {
        if (rows.length >= 3) return rows;
        const more = await prisma.article.findMany({
          where: { ...scope },
          orderBy: { publishedAt: 'desc' },
          take: 5,
          include: articleService.LIST_INCLUDE,
        });
        const seen = new Set(rows.map((r) => r.id));
        return [...rows, ...more.filter((m) => !seen.has(m.id))].slice(0, 5);
      }),
      prisma.breakingNews.findMany({
        where: { status: 'live' },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        take: 8,
        include: { article: true },
      }),
      prisma.article.findMany({
        where: scope,
        orderBy: { publishedAt: 'desc' },
        take: 9,
        include: articleService.LIST_INCLUDE,
      }),
      prisma.article.count({ where: scope }),
      prisma.category.findMany({ where: { status: 'active' }, orderBy: { sortOrder: 'asc' } }),
      prisma.area.findMany({ orderBy: { name: 'asc' } }),
      getActiveAds(),
      prisma.siteSettings.findUnique({ where: { id: 1 } }),
    ]);

  // publishedToday count for the "today" badge if needed
  res.json({
    success: true,
    data: {
      hero: hero.map(publicArticleSummary),
      breaking: breaking.map(breakingDto),
      latest: {
        items: latestRows.map(publicArticleSummary),
        hasMore: 9 < latestTotal,
        total: latestTotal,
      },
      trending: await trendingItems('daily', 5),
      categories: categories.map(publicCategory),
      areas: areas.map((a) => ({ slug: a.slug, label: a.name })),
      ads: ads.map((a) => ({
        id: a.id,
        position: a.position,
        imageUrl: a.image?.url || null,
        linkUrl: a.linkUrl || null,
        title: a.title,
      })),
      site: publicSettingsDto(settings),
    },
  });
});

// ══════════════════════════ HERO ══════════════════════════

const hero = asyncHandler(async (req, res) => {
  const now = new Date();
  const scope = publicScope(now);
  let rows = await prisma.article.findMany({
    where: { ...scope, isFeatured: true },
    orderBy: { publishedAt: 'desc' },
    take: 5,
    include: articleService.LIST_INCLUDE,
  });
  if (rows.length < 3) {
    const more = await prisma.article.findMany({
      where: scope,
      orderBy: { publishedAt: 'desc' },
      take: 5,
      include: articleService.LIST_INCLUDE,
    });
    const seen = new Set(rows.map((r) => r.id));
    rows = [...rows, ...more.filter((m) => !seen.has(m.id))].slice(0, 5);
  }
  res.json({ success: true, data: rows.map(publicArticleSummary) });
});

// ══════════════════════════ BREAKING ══════════════════════════

const breaking = asyncHandler(async (req, res) => {
  const rows = await prisma.breakingNews.findMany({
    where: { status: 'live' },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take: 10,
    include: { article: true },
  });
  // Ticker items: { title, slug, breaking: true }
  res.json({ success: true, data: rows.map(breakingDto) });
});

// ══════════════════════════ NEWS LIST ══════════════════════════

/**
 * GET /api/news
 * Maps newsService.getLatest({ page, pageSize, category, area })
 * -> { items, hasMore, total }
 */
const newsList = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(parseInt(req.query.pageSize || req.query.limit, 10) || 9, 100);
  const scope = publicScope();

  if (req.query.category) {
    const cat = await requireCategory(req.query.category);
    scope.categoryId = cat.id;
  }
  if (req.query.area) {
    const area = await requireArea(req.query.area);
    scope.areaId = area.id;
  }

  const [items, total] = await Promise.all([
    prisma.article.findMany({
      where: scope,
      orderBy: { publishedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: articleService.LIST_INCLUDE,
    }),
    prisma.article.count({ where: scope }),
  ]);

  res.json({
    success: true,
    data: {
      items: items.map(publicArticleSummary),
      hasMore: page * pageSize < total,
      total,
    },
  });
});

/**
 * GET /api/news/category/:slug
 * Maps newsService.getByCategory(slug, limit) -> plain array of summaries
 */
const newsByCategory = asyncHandler(async (req, res) => {
  const cat = await requireCategory(req.params.slug);
  const limit = Math.min(parseInt(req.query.limit, 10) || 6, 50);
  const rows = await prisma.article.findMany({
    where: { ...publicScope(), categoryId: cat.id },
    orderBy: { publishedAt: 'desc' },
    take: limit,
    include: articleService.LIST_INCLUDE,
  });
  res.json({ success: true, data: rows.map(publicArticleSummary) });
});

// ══════════════════════════ ARTICLE DETAIL ══════════════════════════

/**
 * GET /api/news/:slug
 * Maps newsService.getArticleBySlug(slug) -> { article, related }
 * Also records a debounced view (1 counted view per article+IP per 6h).
 */
const articleBySlug = asyncHandler(async (req, res) => {
  const article = await getBySlug(req.params.slug);
  if (!article) {
    // 404 (not found) — no body leakage
    res.status(404).json({
      success: false,
      error: { code: 'ARTICLE_NOT_FOUND', message: 'Article not found', details: null },
    });
    return;
  }

  // Fire-and-forget view tracking (debounced internally)
  recordView(article.id, {
    ip: clientIp(req),
    userAgent: req.get('user-agent'),
    referrer: req.get('referer'),
  }).catch((err) => console.warn('[view] record failed:', err.message));

  const relatedRows = await getRelated(article.slug, 4);
  const site = (await prisma.siteSettings.findUnique({ where: { id: 1 } })) || null;

  const detail = publicArticleDetail(article);
  detail.publisherName = site?.siteName || null;

  res.json({ success: true, data: { article: detail, related: relatedRows.map(publicArticleSummary) } });
});

// ══════════════════════════ TRENDING ══════════════════════════

/**
 * GET /api/trending?period=daily|weekly|monthly&limit=5
 * Computed from article_views within the window (NOT lifetime views).
 * Returns [{ title, slug, viewCount }]
 */
const PERIOD_MS = {
  daily: 24 * 3600 * 1000,
  weekly: 7 * 24 * 3600 * 1000,
  monthly: 30 * 24 * 3600 * 1000,
};

async function trendingItems(period = 'daily', limit = 5) {
  const ms = PERIOD_MS[period] || PERIOD_MS.daily;
  const since = new Date(Date.now() - ms);
  const rows = await prisma.articleView.groupBy({
    by: ['articleId'],
    where: { createdAt: { gte: since } },
    _count: true,
    orderBy: { _count: { articleId: 'desc' } },
    take: limit,
  });
  const ids = rows.map((r) => r.articleId);
  if (!ids.length) return [];
  const articles = await prisma.article.findMany({ where: { id: { in: ids }, ...publicScope() } });
  const byId = new Map(articles.map((a) => [a.id, a]));
  return rows
    .map((r) => {
      const a = byId.get(r.articleId);
      return a ? { title: a.title, slug: a.slug, viewCount: r._count } : null;
    })
    .filter(Boolean);
}

const trending = asyncHandler(async (req, res) => {
  const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'daily';
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
  const items = await trendingItems(period, limit);
  res.json({ success: true, data: items });
});

// ══════════════════════════ TAXONOMY ══════════════════════════

const categories = asyncHandler(async (req, res) => {
  const rows = await prisma.category.findMany({
    where: { status: 'active' },
    orderBy: { sortOrder: 'asc' },
  });
  res.json({ success: true, data: rows.map(publicCategory) });
});

const areas = asyncHandler(async (req, res) => {
  const rows = await prisma.area.findMany({ orderBy: { name: 'asc' } });
  res.json({ success: true, data: rows.map((a) => ({ slug: a.slug, label: a.name })) });
});

// ══════════════════════════ SEARCH ══════════════════════════

/**
 * GET /api/search?q=...&category=<slug>&sort=relevance|newest|popular&limit=20
 * Maps newsService.search(query, { category }) -> plain array.
 * FULLTEXT over title+excerpt, plus tag match, published-only.
 */
const search = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    res.json({ success: true, data: [] });
    return;
  }
  if (q.length > 200) throw ApiErrors.badRequest('Search query must be 200 characters or fewer');
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const sort = ['relevance', 'newest', 'popular'].includes(req.query.sort) ? req.query.sort : 'relevance';

  const scope = publicScope();
  if (req.query.category) {
    const cat = await prisma.category.findUnique({ where: { slug: req.query.category } });
    if (!cat) {
      res.json({ success: true, data: [] });
      return;
    }
    scope.categoryId = cat.id;
  }

  let items;
  if (sort === 'newest' || sort === 'popular') {
    const where = {
      ...scope,
      OR: [
        { title: { contains: q } },
        { excerpt: { contains: q } },
        { content: { contains: q } },
        { tags: { some: { tag: { name: { contains: q.toLowerCase() } } } } },
      ],
    };
    items = await prisma.article.findMany({
      where,
      orderBy: sort === 'newest' ? { publishedAt: 'desc' } : { views: 'desc' },
      take: limit,
      include: articleService.LIST_INCLUDE,
    });
  } else {
    // The migration owns a FULLTEXT index over title/excerpt/content. Prisma
    // filters cannot contain Prisma.sql fragments, so rank IDs with a fully
    // parameterized raw query and hydrate them through Prisma afterwards.
    const categorySql = scope.categoryId
      ? Prisma.sql`AND a.category_id = ${scope.categoryId}`
      : Prisma.empty;
    const rankedRows = await prisma.$queryRaw(Prisma.sql`
      SELECT a.id,
             MATCH(a.title, a.excerpt, a.content)
               AGAINST (${q} IN NATURAL LANGUAGE MODE) AS score
      FROM articles AS a
      WHERE a.status = 'published'
        AND a.published_at <= ${new Date()}
        ${categorySql}
        AND MATCH(a.title, a.excerpt, a.content)
              AGAINST (${q} IN NATURAL LANGUAGE MODE)
      ORDER BY score DESC, a.published_at DESC
      LIMIT ${limit}
    `);

    const rankedIds = rankedRows.map((row) => Number(row.id));
    const tagRows = await prisma.article.findMany({
      where: {
        ...scope,
        id: rankedIds.length ? { notIn: rankedIds } : undefined,
        tags: { some: { tag: { name: { contains: q.toLowerCase() } } } },
      },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      select: { id: true },
    });
    const ids = [...rankedIds, ...tagRows.map((row) => row.id)].slice(0, limit);
    const hydrated = ids.length
      ? await prisma.article.findMany({
        where: { ...scope, id: { in: ids } },
        include: articleService.LIST_INCLUDE,
      })
      : [];
    const byId = new Map(hydrated.map((article) => [article.id, article]));
    items = ids.map((id) => byId.get(id)).filter(Boolean);
  }

  res.json({ success: true, data: items.map(publicArticleSummary) });
});

// ══════════════════════════ GALLERY ══════════════════════════

/**
 * GET /api/gallery?album=events|festivals|nature|news
 * Maps newsService.getGallery() -> plain array of
 * { id, title, image, category }
 * where `category` is the display name of the album (the UI filters on it).
 */
const gallery = asyncHandler(async (req, res) => {
  const where = { status: 'active' };
  if (req.query.album) where.album = req.query.album;
  const rows = await prisma.gallery.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      coverImage: true,
      images: { include: { media: true }, orderBy: { sortOrder: 'asc' }, take: 12 },
    },
  });
  res.json({
    success: true,
    data: rows.map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description || '',
      image: g.coverImage?.url || null,
      category: g.album, // UI filters compare against Events/Festivals/Nature/News
      images: g.images.filter((gi) => gi.media).map((gi) => ({
        url: gi.media.url,
        thumbnail: gi.media.thumbnailUrl || gi.media.url,
        caption: gi.caption || '',
      })),
    })),
  });
});

// ══════════════════════════ VIDEOS ══════════════════════════

/**
 * GET /api/videos
 * Maps newsService.getVideos() -> plain array of
 * { id, title, thumbnail, duration, views, youtubeId }
 */
const videos = asyncHandler(async (req, res) => {
  const rows = await prisma.video.findMany({
    where: { status: 'active' },
    orderBy: { createdAt: 'desc' },
    include: { category: true },
  });
  res.json({
    success: true,
    data: rows.map((v) => ({
      id: v.id,
      title: v.title,
      thumbnail:
        v.thumbnailUrl ||
        (v.type === 'youtube' && v.videoId ? `https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg` : null),
      duration: v.duration || null,
      views: v.views,
      youtubeId: v.type === 'youtube' ? v.videoId : null,
      vimeoId: v.type === 'vimeo' ? v.videoId : null,
      url: v.url,
      description: v.description || null,
      category: v.category?.slug || null,
    })),
  });
});

// ══════════════════════════ PROVIDERS ══════════════════════════

/**
 * GET /api/weather
 * Maps newsService.getWeather() ->
 * { city, tempC, condition, humidity, windKmh, forecast: [{day, high, low, condition}] }
 * Provider-unavailable responses are clearly identified (never invented).
 */
const weather = asyncHandler(async (req, res) => {
  const result = await weatherProvider.getCurrent(req.query.city);
  if (!result.available) {
    res.status(200).json({ success: true, data: { available: false, reason: result.reason } });
    return;
  }
  res.json({ success: true, data: result.data });
});

/**
 * GET /api/market
 * Combined convenience endpoint: { stocks, rates }.
 * The frontend's newsService has TWO methods — getStockData() and getRates() —
 * so /api/market/stocks and /api/market/rates mirror them 1:1.
 *
 * Shapes match newsData.js exactly:
 *   stocks = { sensex:{value,change,changePct,spark[]}, nifty, nasdaq, dow }
 *   rates  = { gold22k, gold24k, silverKg, petrol, diesel }
 * When the provider is unconfigured we return the canonical zero shape (the
 * frontend's own placeholders) PLUS available:false — clearly identified,
 * never invented live values.
 */
const market = asyncHandler(async (req, res) => {
  const [stocks, rates] = await Promise.all([marketProvider.getStocks(), marketProvider.getRates()]);
  res.json({
    success: true,
    data: {
      stocks: stocks.available ? stocks.data : { ...marketProvider.emptyStocks(), available: false, reason: stocks.reason },
      rates: rates.available ? rates.data : { ...marketProvider.emptyRates(), available: false, reason: rates.reason },
    },
  });
});

/** GET /api/market/stocks — 1:1 with newsService.getStockData(). */
const marketStocks = asyncHandler(async (req, res) => {
  const stocks = await marketProvider.getStocks();
  res.json({
    success: true,
    data: stocks.available ? stocks.data : { ...marketProvider.emptyStocks(), available: false, reason: stocks.reason },
  });
});

/** GET /api/market/rates — 1:1 with newsService.getRates(). */
const marketRates = asyncHandler(async (req, res) => {
  const rates = await marketProvider.getRates();
  res.json({
    success: true,
    data: rates.available ? rates.data : { ...marketProvider.emptyRates(), available: false, reason: rates.reason },
  });
});

// ══════════════════════════ JOBS ══════════════════════════

/**
 * GET /api/jobs?type=govt|private|teaching|bank
 * Maps newsService.getJobs({ type }) -> plain array
 */
const jobs = asyncHandler(async (req, res) => {
  const where = { status: 'active', lastDate: { gte: new Date() } };
  if (req.query.type) where.type = req.query.type;
  const rows = await prisma.jobListing.findMany({ where, orderBy: { lastDate: 'desc' } });
  res.json({
    success: true,
    data: rows.map((j) => ({
      id: j.id,
      title: j.title,
      org: j.org || null,
      location: j.location || null,
      type: j.type,
      lastDate: j.lastDate.toISOString().slice(0, 10),
      applyUrl: j.applyUrl || null,
    })),
  });
});

// ══════════════════════════ TOURISM / DISTRICT ══════════════════════════

/**
 * GET /api/tourist-attractions
 * Maps newsService.getTouristAttractions() -> plain array
 * { id, name, description, image, category, timings, entryFee }
 */
const touristAttractions = asyncHandler(async (req, res) => {
  const rows = await prisma.touristAttraction.findMany({
    where: { status: 'active' },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { image: true },
  });
  res.json({
    success: true,
    data: rows.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description || '',
      image: a.image?.url || '',
      category: a.category || null,
      timings: a.timings || null,
      entryFee: a.entryFee || null,
    })),
  });
});

/**
 * GET /api/district-info
 * Maps newsService.getDistrictInfo() ->
 * { taluks: [...], govtOffices: [...], helplines: [...], transport: [...] }
 * Reference data seeded from the frontend (site_settings.districtInfo JSON).
 */
const districtInfo = asyncHandler(async (req, res) => {
  const settings = await prisma.siteSettings.findUnique({ where: { id: 1 } });
  let data = null;
  if (settings?.districtInfo) {
    try {
      data = typeof settings.districtInfo === 'string' ? JSON.parse(settings.districtInfo) : settings.districtInfo;
    } catch (err) {
      console.warn('[settings] districtInfo JSON parse failed:', err.message);
    }
  }
  res.json({ success: true, data: data || { taluks: [], govtOffices: [], helplines: [], transport: [] } });
});

// ══════════════════════════ E-PAPER ══════════════════════════

const ePaperList = asyncHandler(async (req, res) => {
  const take = Math.min(parseInt(req.query.limit, 10) || 31, 366);
  const rows = await prisma.ePaper.findMany({ orderBy: { paperDate: 'desc' }, take });
  res.json({
    success: true,
    data: rows.map((e) => ({
      date: e.paperDate.toISOString().slice(0, 10),
      url: e.pdfUrl,
    })),
  });
});

const ePaperByDate = asyncHandler(async (req, res) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(req.params.date);
  if (!m) throw ApiErrors.badRequest('Date must be YYYY-MM-DD');
  const dateKey = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const row = await prisma.ePaper.findUnique({ where: { paperDate: dateKey } });
  if (!row) {
    res.status(404).json({ success: false, error: { code: 'EPAPER_NOT_FOUND', message: 'E-paper not available for this date', details: null } });
    return;
  }
  res.json({ success: true, data: { date: row.paperDate.toISOString().slice(0, 10), url: row.pdfUrl } });
});

// ══════════════════════════ SETTINGS ══════════════════════════

async function getSiteSettings() {
  return prisma.siteSettings.findUnique({ where: { id: 1 }, include: { logo: true, favicon: true } });
}

function publicSettingsDto(row) {
  if (!row) return null;
  return {
    siteName: row.siteName,
    tagline: row.tagline,
    logo: row.logo?.url || null,
    favicon: row.favicon?.url || null,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    address: row.address,
    headerNote: row.headerNote,
    footerText: row.footerText,
    social: {
      facebook: row.socialFacebook,
      twitter: row.socialTwitter,
      instagram: row.socialInstagram,
      youtube: row.socialYoutube,
    },
  };
}

const siteSettings = asyncHandler(async (req, res) => {
  const row = await getSiteSettings();
  res.json({ success: true, data: publicSettingsDto(row) });
});

// ══════════════════════════ ADS (public) ══════════════════════════

async function getActiveAds() {
  const now = new Date();
  return prisma.advertisement.findMany({
    where: {
      status: 'active',
      startDate: { lte: now },
      endDate: { gte: now },
    },
    include: { image: true },
  });
}

const adsByPosition = asyncHandler(async (req, res) => {
  const rows = await getActiveAds();
  res.json({
    success: true,
    data: rows.map((a) => ({
      id: a.id,
      position: a.position,
      imageUrl: a.image?.url || null,
      linkUrl: a.linkUrl || null,
      title: a.title,
    })),
  });
});

// ══════════════════════════ COMMENTS (public) ══════════════════════════

const commentsPublic = asyncHandler(async (req, res) => {
  const article = await prisma.article.findFirst({ where: { slug: req.params.slug, ...publicScope() } });
  if (!article) throw ApiErrors.notFound('Article not found');
  const rows = await prisma.comment.findMany({
    where: { articleId: article.id, status: 'approved' },
    orderBy: { createdAt: 'desc' },
    include: { reader: { select: { name: true, email: true } } },
  });
  res.json({
    success: true,
    data: rows.map((c) => ({
      id: c.id,
      name: c.name,
      body: c.body, // plain text — frontend must NOT render as HTML
      createdAt: c.createdAt.toISOString(),
    })),
  });
});

// ══════════════════════════ CONTACT ══════════════════════════

const contact = asyncHandler(async (req, res) => {
  const { name, email, subject, message } = require('../validators/public.schema').contactSchema.parse(req.body);
  await prisma.contactSubmission.create({
    data: { name, email, subject: subject || null, message },
  });
  const mail = await mailService.send({
    to: env.CONTACT_RECIPIENT,
    subject: `[Contact] ${subject || name}`,
    text: `From: ${name} <${email}>\n\n${message}`,
  });
  res.json({
    success: true,
    data: {
      ok: true,
      // Do not claim delivery when SMTP is not configured.
      emailSent: mail.delivered,
      ...(mail.delivered ? {} : { note: 'Message stored. Email delivery is not configured on this server.' }),
    },
  });
});

// ══════════════════════════ SITEMAP / ROBOTS ══════════════════════════

const sitemap = asyncHandler(async (req, res) => {
  const now = new Date();
  const articles = await prisma.article.findMany({
    where: publicScope(now),
    select: { slug: true, updatedAt: true, publishedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 5000,
  });
  const baseUrl = env.PUBLIC_FRONTEND_ORIGIN || env.API_BASE_URL.replace(/\/api$/, '');
  const urls = [
    `<url><loc>${baseUrl}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...articles.map((a) => {
      const mod = (a.updatedAt || a.publishedAt).toISOString();
      return `<url><loc>${baseUrl}/article/${a.slug}</loc><lastmod>${mod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
    }),
  ].join('\n');
  res
    .type('application/xml')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
});

const robots = asyncHandler(async (req, res) => {
  const baseUrl = env.PUBLIC_FRONTEND_ORIGIN || env.API_BASE_URL.replace(/\/api$/, '');
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${baseUrl}/sitemap.xml\n`);
});

// ══════════════════════════ READER AUTH (public) ══════════════════════════

const readerLogin = asyncHandler(async (req, res) => {
  const { email, password } = require('../validators/public.schema').readerLoginSchema.parse(req.body);
  const result = await readerAuthService.login({ email, password, req });
  readerAuthService.setReaderCookie(res, result.token);
  // Frontend contract (newsService.login): { user: { email, name, token } }
  res.json({ success: true, data: { user: { ...result.user, token: result.token } } });
});

const otpRequest = asyncHandler(async (req, res) => {
  const { phone } = require('../validators/public.schema').otpRequestSchema.parse(req.body);
  const result = await readerAuthService.requestOtp({ phone, req });
  res.json({ success: true, data: { sent: true, phone, devCode: result.devCode || undefined } });
});

const otpVerify = asyncHandler(async (req, res) => {
  const { phone, otp } = require('../validators/public.schema').otpVerifySchema.parse(req.body);
  const result = await readerAuthService.verifyOtp({ phone, otp, req });
  readerAuthService.setReaderCookie(res, result.token);
  // Frontend contract (newsService.verifyOtp): { user: { phone, token } }
  res.json({ success: true, data: { user: { ...result.user, token: result.token } } });
});

module.exports = {
  home,
  hero,
  breaking,
  newsList,
  newsByCategory,
  articleBySlug,
  trending,
  categories,
  areas,
  search,
  gallery,
  videos,
  weather,
  market,
  marketStocks,
  marketRates,
  jobs,
  touristAttractions,
  districtInfo,
  ePaperList,
  ePaperByDate,
  siteSettings,
  adsByPosition,
  commentsPublic,
  contact,
  sitemap,
  robots,
  readerLogin,
  otpRequest,
  otpVerify,
  trendingItems,
  publicSettingsDto,
};
