'use strict';

/**
 * Taxonomy mappers.
 * Admin representation keeps `name` + `slug` (+ nested subcategories as
 * plain strings where the legacy admin UI expects them).
 * Public representation MUST use `slug` as the category identifier.
 */

/** Admin category DTO (with optional nested subcategories). */
function adminCategory(row, { withSubcategories = true } = {}) {
  const base = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    sortOrder: row.sortOrder,
    articleCount: row._count?.articles ?? row.articleCount ?? 0,
  };
  if (withSubcategories) {
    base.subcategories = (row.subcategories || []).map((s) => s.name);
    base.subcategoryIds = (row.subcategories || []).map((s) => s.id);
  }
  return base;
}

/** Public category DTO — slug is the identifier the SPA consumes. */
function publicCategory(row) {
  return {
    slug: row.slug,
    label: row.name,
    subcategories: (row.subcategories || [])
      .filter((subcategory) => subcategory.status === 'active')
      .map((subcategory) => ({
        slug: subcategory.slug,
        label: subcategory.name,
      })),
  };
}

/** Admin subcategory DTO. */
function adminSubcategory(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    parentCategory: row.parentCategory?.name || null,
    parentCategoryId: row.parentCategoryId,
    description: row.description,
    status: row.status,
    articleCount: row._count?.articles ?? 0,
  };
}

/** Area DTO (used by admin and public). */
function areaDto(row) {
  return { id: row.id, slug: row.slug, label: row.name, name: row.name };
}

/** District DTO for the admin District News page. */
function districtDto(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    totalArticles: row._count?.articles ?? row.totalArticles ?? 0,
    lastUpdatedAt: row.lastUpdatedAt ?? null,
    latestHeadline: row.latestHeadline ?? null,
    reporters: row.reporters ?? 0,
    thisMonth: row.thisMonth ?? 0,
  };
}

module.exports = { adminCategory, publicCategory, adminSubcategory, areaDto, districtDto };
