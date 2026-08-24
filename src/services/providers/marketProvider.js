'use strict';

/**
 * Market / financial data provider abstraction.
 *
 * The public frontend expects two shapes (see newsData.js):
 *   stockData = { sensex:{value,change,changePct,spark[]}, nifty:{...}, nasdaq:{...}, dow:{...} }
 *   rates     = { gold22k, gold24k, silverKg, petrol, diesel }
 *
 * This is a PLUGGABLE provider. v1 ships with a "none" provider that reports
 * clean unavailability (we never invent live market values). To wire a real
 * provider (e.g. a paid market-data API), set MARKET_API_BASE_URL /
 * MARKET_API_KEY and add a provider module that implements:
 *   async getStocks() -> { available, data|reason }
 *   async getRates()  -> { available, data|reason }
 *
 * Results are cached ~5 minutes so we never hammer an upstream.
 */
const env = require('../../config/env');
const cache = require('../../utils/cache');

const STOCK_KEYS = ['sensex', 'nifty', 'nasdaq', 'dow'];
const RATE_KEYS = ['gold22k', 'gold24k', 'silverKg', 'petrol', 'diesel'];

function emptyStocks() {
  const out = {};
  for (const k of STOCK_KEYS) out[k] = { value: 0, change: 0, changePct: 0, spark: [] };
  return out;
}

function emptyRates() {
  return { gold22k: 0, gold24k: 0, silverKg: 0, petrol: 0, diesel: 0 };
}

/**
 * Built-in provider registry. Extend `providers` to add new backends.
 */
const providers = {
  // "none" — no upstream configured; reports clean unavailability.
  none: {
    async getStocks() {
      return { available: false, reason: 'Market data provider not configured' };
    },
    async getRates() {
      return { available: false, reason: 'Market data provider not configured' };
    },
  },
};

function selectProvider() {
  const name = (env.MARKET_PROVIDER || 'none').toLowerCase();
  return providers[name] || providers.none;
}

async function getStocks() {
  const cacheKey = 'market:stocks';
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const result = await selectProvider().getStocks();
  // Only cache successful, available results.
  if (result.available) cache.set(cacheKey, result, 5 * 60 * 1000);
  return result;
}

async function getRates() {
  const cacheKey = 'market:rates';
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const result = await selectProvider().getRates();
  if (result.available) cache.set(cacheKey, result, 5 * 60 * 1000);
  return result;
}

module.exports = {
  getStocks,
  getRates,
  providers,
  STOCK_KEYS,
  RATE_KEYS,
  emptyStocks,
  emptyRates,
};
