'use strict';

/**
 * Scheduler — node-cron job running once per minute.
 *
 * Responsibilities (all idempotent):
 *  1. Publish due scheduled articles  (status=scheduled AND publishedAt <= now)
 *  2. Expire breaking news            (status=live AND endTime <= now)
 *  3. Activate scheduled breaking news (status=scheduled AND startTime <= now)
 *  4. Start due live events           (status=scheduled AND createdAt<=now) — no-op safety
 *  5. Send due notifications          (status=scheduled AND scheduledAt <= now)
 *     (v1: mark sent — no push/SMS/email broadcast unless configured)
 *
 * Guarded by a process-level lock so overlapping ticks don't double-publish.
 */
const cron = require('node-cron');
const prisma = require('./config/prisma');
const { logActivity } = require('./services/auditService');

let running = false;
let task;

async function publishDueArticles() {
  const now = new Date();
  // Atomically claim: update only rows still 'scheduled' with publishedAt <= now
  const result = await prisma.article.updateMany({
    where: { status: 'scheduled', publishedAt: { lte: now } },
    data: { status: 'published' },
  });
  if (result.count > 0) {
    const published = await prisma.article.findMany({
      where: { status: 'published', publishedAt: { gte: new Date(Date.now() - 5 * 60 * 1000), lte: now } },
      select: { id: true, slug: true, title: true },
    });
    console.log(`[scheduler] published ${result.count} scheduled article(s)`);
    for (const a of published) {
      await logActivity({ userId: null, action: 'article.scheduled-published', module: 'news', record: a.slug, details: 'by-scheduler' });
    }
  }
  return result.count;
}

async function expireBreakingNews() {
  const now = new Date();
  const result = await prisma.breakingNews.updateMany({
    where: { status: 'live', endTime: { lte: now } },
    data: { status: 'ended' },
  });
  if (result.count > 0) console.log(`[scheduler] ended ${result.count} breaking news item(s)`);
  return result.count;
}

async function activateBreakingNews() {
  const now = new Date();
  const result = await prisma.breakingNews.updateMany({
    where: { status: 'scheduled', startTime: { lte: now } },
    data: { status: 'live' },
  });
  if (result.count > 0) console.log(`[scheduler] activated ${result.count} breaking news item(s)`);
  return result.count;
}

async function sendDueNotifications() {
  const now = new Date();
  const due = await prisma.notification.findMany({
    where: { status: 'scheduled', scheduledAt: { lte: now } },
  });
  for (const n of due) {
    // v1: no broadcast channels configured — just mark sent.
    await prisma.notification.update({
      where: { id: n.id },
      data: { status: 'sent', sentAt: now },
    });
    console.log(`[scheduler] notification "${n.title}" marked sent (no broadcast channel configured)`);
  }
  return due.length;
}

async function tick() {
  if (running) return; // overlap guard
  running = true;
  try {
    await Promise.allSettled([
      publishDueArticles(),
      expireBreakingNews(),
      activateBreakingNews(),
      sendDueNotifications(),
    ]);
  } catch (err) {
    console.error('[scheduler] tick failed:', err.message);
  } finally {
    running = false;
  }
}

function start() {
  if (task) return () => {};
  task = cron.schedule('* * * * *', tick, { timezone: 'Asia/Kolkata' });
  console.log('[scheduler] started (runs every minute, Asia/Kolkata)');
  return stop;
}

function stop() {
  if (task) {
    task.stop();
    task = undefined;
  }
}

module.exports = { start, stop, tick, publishDueArticles };
