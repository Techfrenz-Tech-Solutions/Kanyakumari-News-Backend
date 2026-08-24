'use strict';

/**
 * Slug generation: lowercase, ASCII-safe, hyphen-separated, stable, unique.
 * Collision handling: my-story, my-story-2, my-story-3 ...
 */
const prisma = require('../config/prisma');

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function slugify(input) {
  const base = String(input || '')
    .toLowerCase()
    // Transliterate common Tamil letters to ASCII where practical,
    // then strip anything that is not a-z0-9 or a hyphen/space.
    .replace(/[\u0B85-\u0BDD]/g, '') // remove devanagari-tamil block (Tamil slugs use romanization)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // diacritics
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .join('-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'article';
}

function isValidSlug(slug) {
  return SLUG_RE.test(slug) && slug.length >= 1 && slug.length <= 200;
}

/**
 * Generate a unique slug.
 * @param {string} title source text
 * @param {string} [explicit] optional explicit slug
 * @param {number} [excludeId] article id to ignore when checking collisions
 * @param {Promise<{findUnique, create, findMany}>} [repo] injectable for tests
 */
async function uniqueSlug(title, explicit, excludeId = null, repo = prisma.article) {
  const base = explicit && isValidSlug(explicit) ? explicit : slugify(title);

  const taken = await repo.findMany({
    where: {
      slug: { startsWith: base },
      id: excludeId ? { not: excludeId } : undefined,
    },
    select: { slug: true },
  });
  const used = new Set(taken.map((t) => t.slug));

  if (!used.has(base)) return base;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
    n += 1;
  }
}

module.exports = { slugify, isValidSlug, uniqueSlug };
