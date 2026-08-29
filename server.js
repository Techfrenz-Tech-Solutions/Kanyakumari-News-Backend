'use strict';

/**
 * Process entry point (PM2 runs this file).
 * Boots the Express app, connects Prisma, and starts the scheduler.
 */
const { app, prisma } = require('./src/app');
const env = require('./src/config/env');
const logger = require('./src/utils/logger');
const { start: startScheduler } = require('./src/scheduler');

async function main() {
  // Verify DB connectivity at boot.
  await prisma.$queryRaw`SELECT 1`;

  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info({ host: env.HOST, port: env.PORT, env: env.NODE_ENV }, 'Kanyakumari News backend listening');
  });

  if (env.ENABLE_SCHEDULER) {
    startScheduler();
  }

  const shutdown = (signal) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    // Hard exit if graceful shutdown hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error(
      env.IS_PROD ? {} : { reason: reason instanceof Error ? reason.message : String(reason) },
      'unhandled rejection'
    );
  });
}

main().catch((err) => {
  logger.fatal(env.IS_PROD ? {} : { err }, 'fatal startup error');
  process.exit(1);
});
