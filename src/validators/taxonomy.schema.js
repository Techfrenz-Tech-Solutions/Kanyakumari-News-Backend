'use strict';

const { z } = require('zod');

function normalizeSlug(value) {
  if (value === undefined || value === null) return undefined;
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || undefined;
}

const slugString = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens')
  .max(150);

const optionalSlug = z.preprocess(normalizeSlug, slugString.optional());

const categoryRef = z.preprocess((value) => {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value);
  return value;
}, z.union([z.number().int().positive(), z.string().trim().min(1)]));

const categoryCreate = z.object({
  name: z.string().trim().min(1).max(120),
  slug: optionalSlug,
  status: z.enum(['active', 'inactive']).default('active'),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  // Compatibility: the admin Categories page posts comma-separated subcategories.
  subcategories: z
    .union([z.string(), z.array(z.string().trim().min(1).max(120))])
    .optional(),
});

const categoryUpdate = categoryCreate.partial();

const subcategoryCreate = z.object({
  name: z.string().trim().min(1).max(120),
  slug: optionalSlug,
  parentCategory: categoryRef.describe('category id or name (admin UI posts the name)'),
  description: z.string().trim().max(500).optional().nullable(),
  status: z.enum(['active', 'inactive']).default('active'),
});

const subcategoryUpdate = subcategoryCreate.partial();

const areaCreate = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugString.optional(),
});

const areaUpdate = areaCreate.partial();

const districtCreate = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(['active', 'inactive']).default('active'),
});

const districtUpdate = districtCreate.partial();

module.exports = {
  categoryCreate,
  categoryUpdate,
  subcategoryCreate,
  subcategoryUpdate,
  areaCreate,
  areaUpdate,
  districtCreate,
  districtUpdate,
};
