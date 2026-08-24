'use strict';

const prisma = require('../config/prisma');
const { ApiErrors, asyncHandler } = require('../utils/apiError');
const { logActivity } = require('../services/auditService');
const { uniqueSlug, slugify } = require('../utils/slugify');
const {
  adminCategory,
  publicCategory,
  adminSubcategory,
  areaDto,
  districtDto,
} = require('../mappers/taxonomy');
const {
  categoryCreate,
  categoryUpdate,
  subcategoryCreate,
  subcategoryUpdate,
  areaCreate,
  areaUpdate,
  districtCreate,
  districtUpdate,
} = require('../validators/taxonomy.schema');

// ─────────────────────────── CATEGORIES ───────────────────────────

/** Parse the legacy "subcategories" CSV/array payload into an array of names. */
function parseSubcategoryNames(value) {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Sync a category's subcategories to the canonical Subcategory table.
 * Accepts a list of names (from the admin Categories CSV field) — creates
 * missing ones with auto slugs, keeps existing ones, removes ones no longer
 * present.
 */
async function syncCategorySubcategories(categoryId, names) {
  const existing = await prisma.subcategory.findMany({ where: { parentCategoryId: categoryId } });
  const byName = new Map(existing.map((s) => [s.name, s]));

  // Create new + keep existing
  for (const name of names) {
    const found = byName.get(name);
    if (!found) {
      const slug = await uniqueSlug(name, null, null, prisma.subcategory);
      await prisma.subcategory.create({
        data: { name, slug, parentCategoryId: categoryId, status: 'active' },
      });
    }
  }

  // Remove dropped ones (only those without articles to avoid orphaning)
  for (const [name, sub] of byName) {
    if (!names.includes(name)) {
      const articleCount = await prisma.article.count({ where: { subcategoryId: sub.id } });
      if (articleCount === 0) {
        await prisma.subcategory.delete({ where: { id: sub.id } });
      }
    }
  }
}

const categories = {
  list: asyncHandler(async (req, res) => {
    const rows = await prisma.category.findMany({
      where: { status: req.query.status ? { equals: req.query.status } : undefined },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { subcategories: { orderBy: { name: 'asc' } }, _count: { select: { articles: true } } },
    });
    res.json({ success: true, data: rows.map((r) => adminCategory(r)) });
  }),

  create: asyncHandler(async (req, res) => {
    const data = categoryCreate.parse(req.body);
    const slug = data.slug || (await uniqueSlug(data.name, null, null, prisma.category));

    const row = await prisma.$transaction(async (tx) => {
      const cat = await tx.category.create({
        data: {
          name: data.name,
          slug,
          status: data.status,
          sortOrder: data.sortOrder ?? 0,
        },
      });
      const subs = parseSubcategoryNames(data.subcategories);
      if (subs && subs.length) await syncCategorySubcategories(cat.id, subs);
      return tx.category.findUnique({
        where: { id: cat.id },
        include: { subcategories: true, _count: { select: { articles: true } } },
      });
    });

    await logActivity({ req, userId: req.user.id, action: 'category.created', module: 'categories', record: row.name });
    res.status(201).json({ success: true, data: adminCategory(row) });
  }),

  get: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = await prisma.category.findFirst({
      where: { id },
      include: { subcategories: { orderBy: { name: 'asc' } }, _count: { select: { articles: true } } },
    });
    if (!row) throw ApiErrors.notFound('Category not found');
    res.json({ success: true, data: adminCategory(row) });
  }),

  update: asyncHandler(async (req, res) => {
    const data = categoryUpdate.parse(req.body);
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Category not found');

    const row = await prisma.$transaction(async (tx) => {
      await tx.category.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        },
      });
      const subs = parseSubcategoryNames(data.subcategories);
      if (subs !== undefined) await syncCategorySubcategories(id, subs);
      return tx.category.findUnique({
        where: { id },
        include: { subcategories: true, _count: { select: { articles: true } } },
      });
    });

    await logActivity({ req, userId: req.user.id, action: 'category.updated', module: 'categories', record: row.name });
    res.json({ success: true, data: adminCategory(row) });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Category not found');
    const articleCount = await prisma.article.count({ where: { categoryId: id } });
    if (articleCount > 0) {
      throw ApiErrors.conflict(`Cannot delete category with ${articleCount} article(s)`, 'CATEGORY_IN_USE');
    }
    await prisma.category.delete({ where: { id } });
    await logActivity({ req, userId: req.user.id, action: 'category.deleted', module: 'categories', record: existing.name });
    res.json({ success: true, data: { ok: true } });
  }),
};

// ────────────────────────── SUBCATEGORIES ──────────────────────────

const subcategories = {
  list: asyncHandler(async (req, res) => {
    const where = {};
    if (req.query.parent) {
      const parent = parseInt(req.query.parent, 10);
      if (Number.isInteger(parent) && parent > 0) where.parentCategoryId = parent;
    }
    if (req.query.status) where.status = req.query.status;

    const rows = await prisma.subcategory.findMany({
      where,
      orderBy: [{ parentCategoryId: 'asc' }, { name: 'asc' }],
      include: { parentCategory: true, _count: { select: { articles: true } } },
    });
    res.json({ success: true, data: rows.map(adminSubcategory) });
  }),

  create: asyncHandler(async (req, res) => {
    const data = subcategoryCreate.parse(req.body);

    // Resolve parent: accept id (number) or name (string) — admin UI posts names.
    let parent;
    if (typeof data.parentCategory === 'number') {
      parent = await prisma.category.findUnique({ where: { id: data.parentCategory } });
    } else {
      const byName = await prisma.category.findFirst({ where: { name: data.parentCategory } });
      const bySlug = byName ? null : await prisma.category.findUnique({ where: { slug: data.parentCategory } });
      parent = byName || bySlug;
    }
    if (!parent) throw ApiErrors.badRequest('Parent category not found');

    const slug = data.slug || (await uniqueSlug(data.name, null, null, prisma.subcategory));
    const row = await prisma.subcategory.create({
      data: {
        name: data.name,
        slug,
        parentCategoryId: parent.id,
        description: data.description ?? null,
        status: data.status,
      },
      include: { parentCategory: true, _count: { select: { articles: true } } },
    });

    await logActivity({ req, userId: req.user.id, action: 'subcategory.created', module: 'categories', record: data.name });
    res.status(201).json({ success: true, data: adminSubcategory(row) });
  }),

  update: asyncHandler(async (req, res) => {
    const data = subcategoryUpdate.parse(req.body);
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.subcategory.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Sub-category not found');

    let parentCategoryId = existing.parentCategoryId;
    if (data.parentCategory !== undefined) {
      let parent;
      if (typeof data.parentCategory === 'number') {
        parent = await prisma.category.findUnique({ where: { id: data.parentCategory } });
      } else {
        parent =
          (await prisma.category.findFirst({ where: { name: data.parentCategory } })) ||
          (await prisma.category.findUnique({ where: { slug: data.parentCategory } }));
      }
      if (!parent) throw ApiErrors.badRequest('Parent category not found');
      parentCategoryId = parent.id;
    }

    const row = await prisma.subcategory.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(parentCategoryId !== existing.parentCategoryId ? { parentCategoryId } : {}),
      },
      include: { parentCategory: true, _count: { select: { articles: true } } },
    });

    await logActivity({ req, userId: req.user.id, action: 'subcategory.updated', module: 'categories', record: data.name || existing.name });
    res.json({ success: true, data: adminSubcategory(row) });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.subcategory.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Sub-category not found');
    const articleCount = await prisma.article.count({ where: { subcategoryId: id } });
    if (articleCount > 0) {
      throw ApiErrors.conflict(`Cannot delete sub-category with ${articleCount} article(s)`, 'SUBCATEGORY_IN_USE');
    }
    await prisma.subcategory.delete({ where: { id } });
    await logActivity({ req, userId: req.user.id, action: 'subcategory.deleted', module: 'categories', record: existing.name });
    res.json({ success: true, data: { ok: true } });
  }),
};

// ────────────────────────────── AREAS ──────────────────────────────

const areas = {
  list: asyncHandler(async (req, res) => {
    const rows = await prisma.area.findMany({ orderBy: { name: 'asc' } });
    res.json({ success: true, data: rows.map(areaDto) });
  }),

  create: asyncHandler(async (req, res) => {
    const data = areaCreate.parse(req.body);
    const slug = data.slug || slugify(data.name);
    const existing = await prisma.area.findFirst({ where: { OR: [{ name: data.name }, { slug }] } });
    if (existing) throw ApiErrors.conflict('Area already exists', 'AREA_EXISTS');
    const row = await prisma.area.create({ data: { name: data.name, slug } });
    await logActivity({ req, userId: req.user.id, action: 'area.created', module: 'categories', record: data.name });
    res.status(201).json({ success: true, data: areaDto(row) });
  }),

  update: asyncHandler(async (req, res) => {
    const data = areaUpdate.parse(req.body);
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.area.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Area not found');
    const row = await prisma.area.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.slug !== undefined ? { slug: data.slug } : {}),
      },
    });
    res.json({ success: true, data: areaDto(row) });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.area.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Area not found');
    const articleCount = await prisma.article.count({ where: { areaId: id } });
    if (articleCount > 0) {
      throw ApiErrors.conflict(`Cannot delete area with ${articleCount} article(s)`, 'AREA_IN_USE');
    }
    await prisma.area.delete({ where: { id } });
    res.json({ success: true, data: { ok: true } });
  }),
};

// ──────────────────────────── DISTRICTS ────────────────────────────

/** Enrich districts with the derived stats the admin District News page shows. */
async function withDistrictStats(rows) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const enriched = [];
  for (const row of rows) {
    const [total, thisMonth, latest, reporterCount] = await Promise.all([
      prisma.article.count({ where: { districtId: row.id } }),
      prisma.article.count({ where: { districtId: row.id, publishedAt: { gte: monthStart } } }),
      prisma.article.findFirst({
        where: { districtId: row.id },
        orderBy: { publishedAt: 'desc' },
        select: { title: true, publishedAt: true },
      }),
      prisma.article
        .groupBy({ by: ['authorId'], where: { districtId: row.id }, _count: true })
        .then((g) => g.length),
    ]);
    enriched.push(
      districtDto({
        ...row,
        totalArticles: total,
        thisMonth,
        lastUpdatedAt: latest?.publishedAt || null,
        latestHeadline: latest?.title || null,
        reporters: reporterCount,
      })
    );
  }
  return enriched;
}

const districts = {
  list: asyncHandler(async (req, res) => {
    const rows = await prisma.district.findMany({ orderBy: { name: 'asc' } });
    const data = await withDistrictStats(rows);
    res.json({ success: true, data });
  }),

  create: asyncHandler(async (req, res) => {
    const data = districtCreate.parse(req.body);
    const existing = await prisma.district.findUnique({ where: { name: data.name } });
    if (existing) throw ApiErrors.conflict('District already exists', 'DISTRICT_EXISTS');
    const row = await prisma.district.create({ data });
    await logActivity({ req, userId: req.user.id, action: 'district.created', module: 'categories', record: data.name });
    res.status(201).json({ success: true, data: districtDto(row) });
  }),

  update: asyncHandler(async (req, res) => {
    const data = districtUpdate.parse(req.body);
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.district.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('District not found');
    const row = await prisma.district.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });
    res.json({ success: true, data: districtDto(row) });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.district.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('District not found');
    await prisma.district.delete({ where: { id } });
    res.json({ success: true, data: { ok: true } });
  }),
};

module.exports = { categories, subcategories, areas, districts, withDistrictStats };
