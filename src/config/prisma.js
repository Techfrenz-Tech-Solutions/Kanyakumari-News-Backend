'use strict';

const { PrismaClient } = require('@prisma/client');
const env = require('./env');

/**
 * Single shared PrismaClient. In tests the DATABASE_URL for the test DB is set
 * before this module is loaded (see tests/setup).
 */
const prisma = new PrismaClient({
  log: env.IS_PROD ? ['error'] : ['warn', 'error'],
});

module.exports = prisma;
