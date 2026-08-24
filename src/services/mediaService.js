'use strict';

/**
 * Media upload + library.
 *
 * - Multer writes to a temp location; we stream/validate magic bytes,
 *   move to uploads/YYYY/MM/uuid-<name>, generate image thumbnails with
 *   sharp, and record a Media row.
 * - Never trusts the original extension. Detects actual MIME by magic bytes.
 * - Rejects unsupported formats and oversize files.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const prisma = require('../config/prisma');
const env = require('../config/env');
const { ApiErrors } = require('../utils/apiError');
const { logActivity } = require('./auditService');
const { localStorage, keyFromFileName } = require('./storage/localStorage');

const MAGIC = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47], ext: 'png' },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff], ext: 'jpg' },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], ext: 'webp', offset4: true },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46], ext: 'pdf' },
];

/**
 * Detect MIME by inspecting the leading bytes of a buffer.
 * WebP: RIFF....WEBP (check bytes 0-3 == 'RIFF' and 8-11 == 'WEBP').
 */
function detectMime(buffer) {
  const head = buffer.subarray(0, 12);
  if (head.length < 4) return null;

  const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  if (png) return { mime: 'image/png', ext: 'png' };

  const jpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (jpg) return { mime: 'image/jpeg', ext: 'jpg' };

  const riff =
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46;
  if (riff && head.length >= 12) {
    const webp =
      head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
    if (webp) return { mime: 'image/webp', ext: 'webp' };
  }

  const pdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  if (pdf) return { mime: 'application/pdf', ext: 'pdf' };

  return null;
}

function isImage(mime) {
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp';
}

/**
 * Process a single uploaded file (multer memory or disk file).
 * @param {string|Buffer} fileSource path or buffer
 * @param {string} originalName
 * @param {number} sizeBytes
 * @param {object} [opts]
 * @param {string|null} opts.kind 'image' | 'pdf' | null (auto)
 * @param {number|null} opts.userId
 * @returns {Promise<Media row>}
 */
async function processUpload(fileSource, originalName, sizeBytes, { kind = null, userId = null, req = null } = {}) {
  // Load into buffer for magic-byte inspection.
  let buffer;
  if (Buffer.isBuffer(fileSource)) {
    buffer = fileSource;
  } else if (typeof fileSource === 'string') {
    buffer = await fs.readFile(fileSource);
  } else {
    throw ApiErrors.badRequest('Unsupported upload source');
  }

  const detected = detectMime(buffer);
  if (!detected) {
    throw ApiErrors.badRequest('Unsupported or unrecognized file format');
  }

  const resolvedKind = kind || (isImage(detected.mime) ? 'image' : 'pdf');

  // Enforce size limits by kind.
  const maxBytes =
    resolvedKind === 'pdf'
      ? env.MAX_PDF_UPLOAD_MB * 1024 * 1024
      : env.MAX_IMAGE_UPLOAD_MB * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    throw ApiErrors.badRequest(
      `File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit for ${resolvedKind === 'pdf' ? 'PDF' : 'image'} uploads`
    );
  }

  // Enforce kind/format compatibility.
  if (resolvedKind === 'image' && !isImage(detected.mime)) {
    throw ApiErrors.badRequest('Image upload must be PNG, JPEG or WebP');
  }
  if (resolvedKind === 'pdf' && detected.mime !== 'application/pdf') {
    throw ApiErrors.badRequest('PDF upload must be a real PDF file');
  }

  // Build storage key with the REAL detected extension (never trust original).
  const cleanBase = String(originalName || 'file').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
  const key = `${keyFromFileName(cleanBase)}.${detected.ext}`;

  const { url, size } = await localStorage.save(key, buffer);

  let width = null;
  let height = null;
  let thumbnailUrl = null;
  let thumbnailKey = null;

  if (resolvedKind === 'image') {
    try {
      const meta = await sharp(buffer).metadata();
      width = meta.width || null;
      height = meta.height || null;

      // Card thumbnail derivative (640px wide, progressive JPEG).
      const thumbKey = `${key.replace(/\.[^.]+$/, '')}-640.jpg`;
      const thumbBuf = await sharp(buffer)
        .resize({ width: env.THUMBNAIL_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true })
        .toBuffer();
      await localStorage.save(thumbKey, thumbBuf);
      thumbnailKey = thumbKey;
      thumbnailUrl = localStorage.getPublicUrl(thumbKey);
    } catch (err) {
      // Non-fatal: thumbnail generation failed but original is fine.
      console.warn('[media] thumbnail generation failed:', err.message);
    }
  }

  const row = await prisma.media.create({
    data: {
      name: String(originalName || 'file').slice(0, 255),
      key,
      url,
      mimeType: detected.mime,
      sizeBytes: sizeBytes || size,
      kind: resolvedKind,
      width,
      height,
      thumbnailKey,
      thumbnailUrl,
      uploadedById: userId || null,
    },
  });

  if (req) {
    await logActivity({
      req,
      userId: userId || null,
      action: 'media.uploaded',
      module: 'media',
      record: row.name,
      details: `${detected.mime} ${sizeBytes}B`,
    });
  }

  return row;
}

/** List media (search by name), newest first. */
async function listMedia({ q = null, kind = null, page = 1, limit = 24, req = null } = {}) {
  const where = {};
  if (kind) where.kind = kind;
  if (q) where.name = { contains: q };
  const take = Math.min(limit, 200);
  const skip = (page - 1) * take;
  const [items, total] = await Promise.all([
    prisma.media.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
    prisma.media.count({ where }),
  ]);
  return { items: items.map(mediaDto), total, page, limit: take, hasMore: skip + take < total };
}

function mediaDto(row) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    thumbnailUrl: row.thumbnailUrl,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    size: `${(row.sizeBytes / (1024 * 1024)).toFixed(1)} MB`, // admin UI expects "1.2 MB"
    kind: row.kind,
    width: row.width,
    height: row.height,
    uploadedAt: row.createdAt,
  };
}

/**
 * Delete a media row + its stored file(s).
 * Media referenced by articles/ads/etc. is still removable at the row level;
 * referencing FKs are ON DELETE SET NULL so content survives.
 */
async function deleteMedia({ id, req = null, userId = null } = {}) {
  const row = await prisma.media.findUnique({ where: { id } });
  if (!row) throw ApiErrors.notFound('Media not found');

  await prisma.media.delete({ where: { id } });
  await localStorage.delete(row.key);
  if (row.thumbnailKey) await localStorage.delete(row.thumbnailKey);

  if (req) {
    await logActivity({ req, userId: userId || null, action: 'media.deleted', module: 'media', record: row.name });
  }
  return { ok: true };
}

module.exports = {
  processUpload,
  listMedia,
  deleteMedia,
  mediaDto,
  detectMime,
  isImage,
};
