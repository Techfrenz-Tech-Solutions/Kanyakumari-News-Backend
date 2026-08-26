'use strict';

/**
 * Local-disk storage provider.
 * Interface: save(key, buffer, opts) -> { key, url, size }
 *            delete(key)
 *            getPublicUrl(key)
 *
 * An S3-compatible provider can implement the same interface later
 * (see STORAGE_README notes in README.md).
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const env = require('../../config/env');

const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

function keyFromFileName(uploadedFileName) {
  const now = new Date();
  const ym = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  const safeName = String(uploadedFileName || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-80);
  return `${ym}/${crypto.randomUUID()}-${safeName}`;
}

function resolvePath(key) {
  // keys are always relative (YYYY/MM/uuid-name.ext); prevent traversal
  const resolved = path.resolve(env.UPLOAD_DIR, key);
  if (!resolved.startsWith(path.resolve(env.UPLOAD_DIR) + path.sep)) {
    throw new Error('Invalid storage key');
  }
  return resolved;
}

const localStorage = {
  name: 'local',

  async save(key, buffer, _opts = {}) {
    const fullPath = resolvePath(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return {
      key,
      url: localStorage.getPublicUrl(key),
      size: buffer.length,
    };
  },

  async delete(key) {
    try {
      await fs.unlink(resolvePath(key));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  },

  getPublicUrl(key) {
    return `${env.PUBLIC_UPLOAD_URL}/${key}`;
  },

  /** Read a stored file (used for sharp thumbnail generation + static serving checks). */
  async read(key) {
    return fs.readFile(resolvePath(key));
  },

  exists(key) {
    return fs
      .stat(resolvePath(key))
      .then((s) => s.isFile())
      .catch(() => false);
  },

  absolutePath(key) {
    return resolvePath(key);
  },

  IMAGE_MIME,
};

module.exports = { localStorage, keyFromFileName, resolvePath };
