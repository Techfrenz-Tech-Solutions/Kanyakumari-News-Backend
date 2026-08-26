'use strict';

/**
 * Environment configuration.
 * Loads .env once, validates required values, and exposes a typed-ish object.
 * Fails loudly at startup when critical config is missing in production.
 */

const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const IS_TEST = NODE_ENV === 'test';

const bool = (v, dflt) => (v === undefined || v === '' ? dflt : String(v).toLowerCase() === 'true');
const int = (v, dflt) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
};
const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);

const env = {
  NODE_ENV,
  IS_PROD,
  IS_TEST,
  PORT: int(process.env.PORT, 3000),
  API_BASE_URL: process.env.API_BASE_URL || `http://localhost:${int(process.env.PORT, 3000)}`,
  TRUST_PROXY: process.env.TRUST_PROXY ? int(process.env.TRUST_PROXY, 1) : 1,

  DATABASE_URL: process.env.DATABASE_URL || '',
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || '',

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || '',
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_READER_SECRET: process.env.JWT_READER_SECRET || process.env.JWT_ACCESS_SECRET || '',
  JWT_READER_EXPIRES_IN: process.env.JWT_READER_EXPIRES_IN || '7d',
  REFRESH_TOKEN_EXPIRES_DAYS: int(process.env.REFRESH_TOKEN_EXPIRES_DAYS, 14),
  REFRESH_COOKIE_NAME: process.env.REFRESH_COOKIE_NAME || 'kkn_refresh',
  IP_HASH_SECRET: process.env.IP_HASH_SECRET || '',

  ADMIN_FRONTEND_ORIGIN: process.env.ADMIN_FRONTEND_ORIGIN || 'http://localhost:5173',
  PUBLIC_FRONTEND_ORIGIN: process.env.PUBLIC_FRONTEND_ORIGIN || 'http://localhost:3000',
  EXTRA_CORS_ORIGINS: list(process.env.EXTRA_CORS_ORIGINS),

  UPLOAD_DIR: path.resolve(process.env.UPLOAD_DIR || './uploads'),
  PUBLIC_UPLOAD_URL: (process.env.PUBLIC_UPLOAD_URL || `http://localhost:${int(process.env.PORT, 3000)}/uploads`).replace(/\/$/, ''),
  MAX_IMAGE_UPLOAD_MB: int(process.env.MAX_IMAGE_UPLOAD_MB, 5),
  MAX_PDF_UPLOAD_MB: int(process.env.MAX_PDF_UPLOAD_MB, 20),
  THUMBNAIL_WIDTH: int(process.env.THUMBNAIL_WIDTH, 640),

  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: int(process.env.SMTP_PORT, 587),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || 'Kanyakumari Today <no-reply@kanyakumaritoday.com>',
  CONTACT_RECIPIENT: process.env.CONTACT_RECIPIENT || '',

  OTP_PROVIDER: process.env.OTP_PROVIDER || 'console',
  OTP_EXPIRY_MINUTES: int(process.env.OTP_EXPIRY_MINUTES, 5),
  OTP_MAX_ATTEMPTS: int(process.env.OTP_MAX_ATTEMPTS, 5),

  WEATHER_PROVIDER: process.env.WEATHER_PROVIDER || '',
  WEATHER_API_KEY: process.env.WEATHER_API_KEY || '',
  WEATHER_API_BASE_URL: process.env.WEATHER_API_BASE_URL || '',
  WEATHER_CITY_LAT: process.env.WEATHER_CITY_LAT || '8.0883',
  WEATHER_CITY_LON: process.env.WEATHER_CITY_LON || '77.5399',
  WEATHER_CACHE_TTL_SECONDS: int(process.env.WEATHER_CACHE_TTL_SECONDS, 600),

  MARKET_PROVIDER: process.env.MARKET_PROVIDER || '',
  MARKET_API_KEY: process.env.MARKET_API_KEY || '',
  MARKET_API_BASE_URL: process.env.MARKET_API_BASE_URL || '',
  MARKET_CACHE_TTL_SECONDS: int(process.env.MARKET_CACHE_TTL_SECONDS, 600),

  ENABLE_SCHEDULER: bool(process.env.ENABLE_SCHEDULER, true),

  SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL || 'admin@kanyakumaritoday.com',
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || '',
  SEED_ADMIN_NAME: process.env.SEED_ADMIN_NAME || 'Super Admin',
};

/** CORS origins derived from configured frontends. */
env.CORS_ORIGINS = [...new Set([
  env.ADMIN_FRONTEND_ORIGIN,
  env.PUBLIC_FRONTEND_ORIGIN,
  ...env.EXTRA_CORS_ORIGINS,
].filter(Boolean))];

function validateEnv() {
  const problems = [];

  const requireAlways = ['DATABASE_URL'];
  for (const key of requireAlways) {
    if (!env[key]) problems.push(`${key} is required`);
  }

  if (IS_PROD) {
    if (!env.JWT_ACCESS_SECRET || env.JWT_ACCESS_SECRET.length < 32) {
      problems.push('JWT_ACCESS_SECRET must be set (>= 32 chars) in production');
    }
    if (!env.IP_HASH_SECRET || env.IP_HASH_SECRET.length < 16) {
      problems.push('IP_HASH_SECRET must be set (>= 16 chars) in production');
    }
    if (!env.JWT_READER_SECRET || env.JWT_READER_SECRET.length < 32) {
      problems.push('JWT_READER_SECRET (or JWT_ACCESS_SECRET fallback) must be >= 32 chars in production');
    }
    if (['console', 'dev'].includes(env.OTP_PROVIDER)) {
      problems.push('development OTP providers are not allowed in production');
    }
    if (!env.API_BASE_URL.startsWith('https://')) {
      problems.push('API_BASE_URL should use https in production');
    }
  } else {
    // Development convenience: generate one-time ephemeral secrets so the app can boot,
    // but log loudly that they are ephemeral.
    const crypto = require('node:crypto');
    if (!env.JWT_ACCESS_SECRET) {
      env.JWT_ACCESS_SECRET = `dev-ephemeral-${crypto.randomBytes(24).toString('hex')}`;
      console.warn('[env] WARNING: JWT_ACCESS_SECRET not set — using an ephemeral development secret.');
    }
    if (!env.JWT_READER_SECRET) env.JWT_READER_SECRET = env.JWT_ACCESS_SECRET;
    if (!env.IP_HASH_SECRET) {
      env.IP_HASH_SECRET = `dev-ephemeral-${crypto.randomBytes(16).toString('hex')}`;
      console.warn('[env] WARNING: IP_HASH_SECRET not set — using an ephemeral development secret.');
    }
  }

  if (!['console', 'dev'].includes(env.OTP_PROVIDER)) {
    problems.push(`OTP_PROVIDER=${env.OTP_PROVIDER} is unsupported by this build`);
  }
  if (env.OTP_EXPIRY_MINUTES <= 0) problems.push('OTP_EXPIRY_MINUTES must be positive');
  if (env.OTP_MAX_ATTEMPTS <= 0) problems.push('OTP_MAX_ATTEMPTS must be positive');
  if (env.WEATHER_CACHE_TTL_SECONDS <= 0) problems.push('WEATHER_CACHE_TTL_SECONDS must be positive');
  if (env.MARKET_CACHE_TTL_SECONDS <= 0) problems.push('MARKET_CACHE_TTL_SECONDS must be positive');
  if (IS_PROD && env.SMTP_HOST && !env.CONTACT_RECIPIENT) {
    problems.push('CONTACT_RECIPIENT is required in production when SMTP is configured');
  }

  if (problems.length) {
    const msg = `Invalid environment configuration:\n  - ${problems.join('\n  - ')}`;
    if (IS_PROD) {
      throw new Error(msg);
    }
    // In development we only throw when a critical (always-required) var is missing.
    const fatal = problems.filter((p) =>
      p.startsWith('DATABASE_URL') || p.includes('unsupported by this build')
    );
    if (fatal.length) throw new Error(msg);
    console.warn(`[env] ${msg}`);
  }
}

validateEnv();

module.exports = env;
