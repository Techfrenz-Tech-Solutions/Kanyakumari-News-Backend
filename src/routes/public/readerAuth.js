'use strict';

const prisma = require('../../config/prisma');
const { asyncHandler, ApiErrors } = require('../../utils/apiError');
const readerAuthService = require('../../services/readerAuthService');
const { commentCreateSchema } = require('../../validators/public.schema');
const { publicScope } = require('../../services/articleService');

/**
 * Middleware: require an authenticated reader (from cookie or Bearer).
 * Attaches req.reader (JWT payload) when present.
 */
function requireReader(req, res, next) {
  const reader = readerAuthService.getReaderUser(req);
  if (!reader) {
    return next(ApiErrors.unauthorized('Authentication required', 'READER_AUTH_REQUIRED'));
  }
  req.reader = reader;
  return next();
}

/**
 * POST /api/comments  (authenticated reader)
 * Body: { articleSlug, name?, email?, body }
 * v1 requires a valid ReaderAccount for comment creation.
 */
const createComment = asyncHandler(async (req, res) => {
  const { articleSlug } = req.body;
  if (!articleSlug) throw ApiErrors.badRequest('articleSlug is required');

  const article = await prisma.article.findFirst({
    where: { slug: articleSlug, ...publicScope() },
    select: { id: true, slug: true, title: true },
  });
  if (!article) throw ApiErrors.notFound('Article not found');

  const data = commentCreateSchema.parse({
    name: req.body.name,
    email: req.body.email,
    body: req.body.body,
  });

  // Resolve the reader account from the authenticated JWT (phone or email).
  const reader = await prisma.readerAccount.findFirst({
    where: {
      OR: [
        req.reader.phone ? { phone: req.reader.phone } : { id: -1 },
        req.reader.email ? { email: req.reader.email } : { id: -1 },
      ],
    },
  });
  if (!reader) throw ApiErrors.unauthorized('Reader account not found', 'READER_NOT_FOUND');

  const comment = await prisma.comment.create({
    data: {
      articleId: article.id,
      readerId: reader.id,
      name: data.name || reader.name || 'Reader',
      email: data.email || reader.email || null,
      body: data.body, // stored as plain text (never rendered as HTML)
      status: 'pending',
    },
  });

  res.status(201).json({ success: true, data: { id: comment.id, status: comment.status } });
});

module.exports = { requireReader, createComment };
