'use strict';

const env = require('../config/env');
const { wordCount } = require('../utils/sanitizeHtml');

/**
 * Public news mappers.
 *
 * The public SPA expects camelCase with specific field names
 * (see kanyakumari-news-frontend/src/services/newsService.js):
 *   category = slug string, author = {name, role, avatar},
 *   breaking = bool, publishedAt = ISO string, image = URL.
 * Internal DB ids (category_id, author_id, featured_image_id) are NOT leaked.
 */

function readTimeFromContent(content) {
  const words = wordCount(content);
  // ~200 wpm, minimum 1 minute
  return Math.max(1, Math.ceil(words / 200));
}

/** Public summary DTO (list cards, hero, trending inputs). */
function publicArticleSummary(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    titleTA: row.titleTa || null,
    excerpt: row.excerpt,
    excerptTA: row.excerptTa || null,
    image: row.featuredImage?.url || null,
    videoUrl: row.videoUrl || null,
    category: row.category?.slug || null,
    area: row.area?.slug || null,
    tags: (row.tags || []).map((t) => t.tag.name),
    breaking: row.isBreaking,
    featured: row.isFeatured,
    views: row.views,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    readTime: readTimeFromContent(row.content),
  };
}

/** Public detail DTO (article page). */
function publicArticleDetail(row) {
  const summary = publicArticleSummary(row);
  return {
    ...summary,
    content: row.content,
    contentTA: row.contentTa || null,
    subcategory: row.subcategory?.slug || null,
    author: {
      name: row.author?.name || null,
      role: row.author?.designation || null,
      avatar: row.author?.avatar?.url || null,
    },
    location: row.location || null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    seo: seoDto(row.seo, row, summary),
  };
}

/** SEO object for the public detail DTO (for <title>/meta/JSON-LD hydration). */
function seoDto(seo, row, summary) {
  const canonical =
    seo?.canonicalUrl || `${env.API_BASE_URL.replace(/\/api$/, '')}/article/${row.slug}`;
  return {
    seoTitle: seo?.seoTitle || row.title,
    metaDescription: seo?.metaDescription || row.excerpt,
    focusKeyword: seo?.focusKeyword || null,
    metaKeywords: seo?.metaKeywords || null,
    canonicalUrl: canonical,
    ogTitle: seo?.ogTitle || row.title,
    ogDescription: seo?.ogDescription || row.excerpt,
    ogImage: row.featuredImage?.url || null,
    twitterTitle: seo?.twitterTitle || row.title,
    twitterDescription: seo?.twitterDescription || row.excerpt,
    twitterImage: row.featuredImage?.url || null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    author: {
      name: row.author?.name || null,
      jobTitle: row.author?.designation || null,
    },
    publisherName: summary && row.publisherName ? row.publisherName : null,
  };
}

/** Admin article DTO (what the admin UI form/table needs). */
function adminArticle(row, { withContent = true } = {}) {
  const base = {
    id: row.id,
    title: row.title,
    shortDescription: row.excerpt,
    excerpt: row.excerpt,
    titleTA: row.titleTa || null,
    excerptTA: row.excerptTa || null,
    content: withContent ? row.content : undefined,
    contentTA: withContent ? row.contentTa || null : undefined,
    slug: row.slug,
    image: row.featuredImage?.url || null,
    featuredImageId: row.featuredImageId || null,
    videoUrl: row.videoUrl || null,
    category: row.category?.name || null,
    categoryId: row.categoryId,
    subCategory: row.subcategory?.name || null,
    subcategoryId: row.subcategoryId || null,
    author: row.author?.name || null,
    authorId: row.authorId,
    authorRole: row.author?.designation || null,
    area: row.area?.slug || null,
    areaId: row.areaId || null,
    location: row.location || null,
    tags: (row.tags || []).map((t) => t.tag.name),
    isBreaking: row.isBreaking,
    isFeatured: row.isFeatured,
    status: row.status,
    publishDate: row.publishDate ? row.publishDate.toISOString().slice(0, 10) : null,
    publishTime: row.publishTime || null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    views: row.views,
    rejectionReason: row.rejectionReason || null,
    words: wordCount(row.content),
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
  return base;
}

/** Trending / most-read item shape the public SPA expects. */
function trendingItem(row) {
  return {
    title: row.title,
    slug: row.slug,
    viewCount: row._count ?? row.viewCount ?? row.views,
  };
}

/** Public breaking-news ticker item: { title, slug, breaking: true }. */
function breakingDto(row) {
  const article = row.article;
  const slug = article?.slug || row.linkSlug || null;
  return {
    id: row.id,
    title: article?.title || row.headline,
    slug,
    breaking: true,
  };
}

module.exports = {
  publicArticleSummary,
  publicArticleDetail,
  adminArticle,
  trendingItem,
  breakingDto,
  readTimeFromContent,
};
