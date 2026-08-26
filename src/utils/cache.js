'use strict';

/**
 * Tiny in-memory TTL cache for provider data (weather, market).
 * Not shared across processes — fine for a single PM2 instance in v1.
 */
const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function set(key, value, ttlSeconds) {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new TypeError('ttlSeconds must be a positive number');
  }
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function clear() {
  store.clear();
}

module.exports = { get, set, clear };
