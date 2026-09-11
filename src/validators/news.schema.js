'use strict';

const { z } = require('zod');

const statusEnum = z.enum(['draft', 'pending', 'scheduled', 'published']);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const timeStr = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

const isoDateTime = z.string().datetime({ offset: true }).or(z.string().datetime());

/**
 * Article create/update body.
 *
 * Accepts the LEGACY admin field names (what AddEditNews.jsx posts today)
 * AND the new relational ID fields (for future integration code):
 *
 *   title, shortDescription (or excerpt), content,
 *   image (URL) | featuredImageId,
 *   category (name) | categoryId,
 *   subCategory (name) | subcategoryId,
 *   author (reporter name) | authorId,
 *   area (slug/name) | areaId,
 *   location, tags[], isBreaking, isFeatured,
 *   publishDate (YYYY-MM-DD), publishTime (HH:MM), status,
 *   slug (explicit, optional)
 */
const articleBase = z.object({
  title: z.string().trim().min(1, 'Title is required').max(255),
  shortDescription: z.string().trim().min(1).max(500).optional(),
  excerpt: z.string().trim().min(1).max(500).optional(),
  content: z.string().min(1, 'Content is required').max(500000),
  titleTA: z.string().trim().max(255).optional().nullable(),
  excerptTA: z.string().trim().max(500).optional().nullable(),
  contentTA: z.string().max(500000).optional().nullable(),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens')
    .max(200)
    .optional(),

  image: z.string().trim().url().optional().nullable(),
  featuredImageId: z.number().int().positive().optional().nullable(),
  videoUrl: z.string().trim().url().max(500).optional().nullable(),

  category: z.string().trim().min(1).optional(),
  categoryId: z.number().int().positive().optional(),

  subCategory: z.string().trim().min(1).optional(),
  subcategoryId: z.number().int().positive().optional().nullable(),

  author: z.string().trim().min(1).optional(),
  authorId: z.number().int().positive().optional(),

  area: z.string().trim().min(1).optional(),
  areaId: z.number().int().positive().optional().nullable(),

  location: z.string().trim().max(120).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),

  isBreaking: z.boolean().optional(),
  isFeatured: z.boolean().optional(),

  publishDate: isoDate.optional(),
  publishTime: timeStr.optional(),
  // For explicit scheduling via ISO datetime (future integration).
  scheduledAt: isoDateTime.optional(),

  status: statusEnum.optional(),
});

const articleCreate = articleBase
  .superRefine((val, ctx) => {
    if (!val.shortDescription && !val.excerpt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shortDescription'],
        message: 'Short description is required (shortDescription or excerpt)',
      });
    }
    if (val.categoryId === undefined && val.category === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['category'], message: 'Category is required' });
    }
    if (val.authorId === undefined && val.author === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['author'], message: 'Author is required' });
    }
  })
  .refine((v) => v.status !== undefined, {
    message: 'Status is required (draft | scheduled | published)',
    path: ['status'],
  });

const articleUpdate = articleBase.partial().refine((v) => Object.keys(v).length > 0, {
  message: 'At least one field must be provided',
});

const statusActionSchema = z.object({
  action: z.enum(['submit', 'approve', 'reject', 'unpublish', 'publish-now', 'cancel-schedule']),
  reason: z.string().trim().min(3).max(2000).optional(),
});

const seoUpdateSchema = z
  .object({
    seoTitle: z.string().trim().max(70, 'SEO title must be ≤ 70 characters').optional().nullable(),
    metaDescription: z
      .string()
      .trim()
      .max(160, 'Meta description must be ≤ 160 characters')
      .optional()
      .nullable(),
    focusKeyword: z.string().trim().max(80).optional().nullable(),
    metaKeywords: z
      .union([z.string().trim().max(500), z.array(z.string().trim().max(80)).max(20)])
      .optional()
      .nullable(),
    canonicalUrl: z.string().trim().url().max(500).optional().nullable(),
    ogTitle: z.string().trim().max(140).optional().nullable(),
    ogDescription: z.string().trim().max(200).optional().nullable(),
    twitterTitle: z.string().trim().max(140).optional().nullable(),
    twitterDescription: z.string().trim().max(200).optional().nullable(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one SEO field must be provided' });

module.exports = { articleCreate, articleUpdate, statusActionSchema, seoUpdateSchema };
