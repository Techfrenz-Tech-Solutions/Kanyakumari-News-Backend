'use strict';

const express = require('express');
const {
  authenticateAdmin,
  requirePermission,
  requireArticleLifecyclePermission,
  requireArticleInitialStatusPermission,
} = require('../../middleware/authenticate');
const { singleFile } = require('../../middleware/upload');

const taxonomy = require('../../controllers/taxonomyController');
const team = require('../../controllers/teamController');
const mediaCtrl = require('./media');
const news = require('./news');
const supporting = require('./supporting');

const router = express.Router();

// Everything under /api/admin requires an authenticated admin.
router.use(authenticateAdmin);

// Prevent parseInt-style coercion (for example, "12abc" becoming record 12).
router.param('id', (req, _res, next, value) => {
  if (!/^[1-9]\d*$/.test(value)) {
    return next(require('../../utils/apiError').ApiErrors.badRequest('Invalid resource id'));
  }
  return next();
});

// ── Taxonomy ────────────────────────────────────────────────────────────────
router.get('/categories', requirePermission('categories', 'view'), taxonomy.categories.list);
router.post('/categories', requirePermission('categories', 'create'), taxonomy.categories.create);
router.get('/categories/:id', requirePermission('categories', 'view'), taxonomy.categories.get);
router.put('/categories/:id', requirePermission('categories', 'edit'), taxonomy.categories.update);
router.delete('/categories/:id', requirePermission('categories', 'delete'), taxonomy.categories.remove);

router.get('/subcategories', requirePermission('categories', 'view'), taxonomy.subcategories.list);
router.post('/subcategories', requirePermission('categories', 'create'), taxonomy.subcategories.create);
router.put('/subcategories/:id', requirePermission('categories', 'edit'), taxonomy.subcategories.update);
router.delete('/subcategories/:id', requirePermission('categories', 'delete'), taxonomy.subcategories.remove);

router.get('/areas', requirePermission('categories', 'view'), taxonomy.areas.list);
router.post('/areas', requirePermission('categories', 'create'), taxonomy.areas.create);
router.put('/areas/:id', requirePermission('categories', 'edit'), taxonomy.areas.update);
router.delete('/areas/:id', requirePermission('categories', 'delete'), taxonomy.areas.remove);

router.get('/districts', requirePermission('categories', 'view'), taxonomy.districts.list);
router.post('/districts', requirePermission('categories', 'create'), taxonomy.districts.create);
router.put('/districts/:id', requirePermission('categories', 'edit'), taxonomy.districts.update);
router.delete('/districts/:id', requirePermission('categories', 'delete'), taxonomy.districts.remove);

// ── Team ────────────────────────────────────────────────────────────────────
router.get('/reporters', requirePermission('reporters', 'view'), team.reporters.list);
router.post('/reporters', requirePermission('reporters', 'create'), team.reporters.create);
router.get('/reporters/:id', requirePermission('reporters', 'view'), team.reporters.get);
router.put('/reporters/:id', requirePermission('reporters', 'edit'), team.reporters.update);
router.delete('/reporters/:id', requirePermission('reporters', 'delete'), team.reporters.remove);

router.get('/authors', requirePermission('reporters', 'view'), team.authors.list);
router.post('/authors', requirePermission('reporters', 'create'), team.authors.create);
router.put('/authors/:id', requirePermission('reporters', 'edit'), team.authors.update);
router.delete('/authors/:id', requirePermission('reporters', 'delete'), team.authors.remove);

router.get('/editors', requirePermission('reporters', 'view'), team.editors.list);
router.post('/editors', requirePermission('reporters', 'create'), team.editors.create);
router.put('/editors/:id', requirePermission('reporters', 'edit'), team.editors.update);
router.delete('/editors/:id', requirePermission('reporters', 'delete'), team.editors.remove);

router.get('/users', requirePermission('users', 'view'), team.users.list);
router.post('/users', requirePermission('users', 'create'), team.users.create);
router.put('/users/:id', requirePermission('users', 'edit'), team.users.update);
router.delete('/users/:id', requirePermission('users', 'delete'), team.users.remove);

// ── Media / Uploads ─────────────────────────────────────────────────────────
router.post('/upload', requirePermission('media', 'upload'), singleFile('file'), mediaCtrl.upload);
router.get('/media', requirePermission('media', 'view'), mediaCtrl.list);
router.delete('/media/:id', requirePermission('media', 'delete'), mediaCtrl.remove);

// ── News / Articles ─────────────────────────────────────────────────────────
router.get('/news', requirePermission('news', 'view'), news.list);
router.post(
  '/news',
  requirePermission('news', 'create'),
  requireArticleInitialStatusPermission,
  news.create
);
router.get('/news/:id', requirePermission('news', 'view'), news.get);
router.put('/news/:id', requirePermission('news', 'edit'), news.update);
router.delete('/news/:id', requirePermission('news', 'delete'), news.remove);
router.post('/news/:id/status', requireArticleLifecyclePermission, news.changeStatus);

// ── SEO ─────────────────────────────────────────────────────────────────────
router.get('/seo', requirePermission('news', 'view'), news.listSeo);
router.put('/seo/article/:id', requirePermission('news', 'edit'), news.updateSeo);

// ── Supporting CMS resources ────────────────────────────────────────────────
// Breaking news
router.get('/breaking', requirePermission('news', 'view'), supporting.breaking.list);
router.post('/breaking', requirePermission('news', 'create'), supporting.breaking.create);
router.put('/breaking/:id', requirePermission('news', 'edit'), supporting.breaking.update);
router.delete('/breaking/:id', requirePermission('news', 'delete'), supporting.breaking.remove);
router.post('/breaking/:id/activate', requirePermission('news', 'publish'), supporting.breaking.activate);
router.post('/breaking/:id/deactivate', requirePermission('news', 'publish'), supporting.breaking.deactivate);

// Videos
router.get('/videos', requirePermission('media', 'view'), supporting.videos.list);
router.post('/videos', requirePermission('media', 'upload'), supporting.videos.create);
router.put('/videos/:id', requirePermission('media', 'upload'), supporting.videos.update);
router.delete('/videos/:id', requirePermission('media', 'delete'), supporting.videos.remove);

// Galleries
router.get('/galleries', requirePermission('media', 'view'), supporting.galleries.list);
router.post('/galleries', requirePermission('media', 'upload'), supporting.galleries.create);
router.put('/galleries/:id', requirePermission('media', 'upload'), supporting.galleries.update);
router.delete('/galleries/:id', requirePermission('media', 'delete'), supporting.galleries.remove);

// Live events / updates
router.get('/live-events', requirePermission('news', 'view'), supporting.liveEvents.list);
router.post('/live-events', requirePermission('news', 'create'), supporting.liveEvents.create);
router.put('/live-events/:id', requirePermission('news', 'edit'), supporting.liveEvents.update);
router.delete('/live-events/:id', requirePermission('news', 'delete'), supporting.liveEvents.remove);
router.post('/live-events/:id/updates', requirePermission('news', 'create'), supporting.liveEvents.addUpdate);

// Advertisements
router.get('/ads', requirePermission('ads', 'view'), supporting.ads.list);
router.post('/ads', requirePermission('ads', 'create'), supporting.ads.create);
router.put('/ads/:id', requirePermission('ads', 'edit'), supporting.ads.update);
router.delete('/ads/:id', requirePermission('ads', 'delete'), supporting.ads.remove);

// Comments (moderation)
router.get('/comments', requirePermission('comments', 'view'), supporting.comments.list);
router.patch('/comments/:id/status', requirePermission('comments', 'moderate'), supporting.comments.setStatus);
router.delete('/comments/:id', requirePermission('comments', 'delete'), supporting.comments.remove);

// Notifications
router.get('/notifications', requirePermission('settings', 'view'), supporting.notifications.list);
router.post('/notifications', requirePermission('settings', 'edit'), supporting.notifications.create);
router.put('/notifications/:id', requirePermission('settings', 'edit'), supporting.notifications.update);
router.delete('/notifications/:id', requirePermission('settings', 'edit'), supporting.notifications.remove);

// Social posts
router.get('/social/posts', requirePermission('settings', 'view'), supporting.socialPosts.list);
router.post('/social/posts', requirePermission('settings', 'edit'), supporting.socialPosts.create);
router.put('/social/posts/:id', requirePermission('settings', 'edit'), supporting.socialPosts.update);
router.delete('/social/posts/:id', requirePermission('settings', 'edit'), supporting.socialPosts.remove);

// Job listings
router.get('/jobs', requirePermission('news', 'view'), supporting.jobs.list);
router.post('/jobs', requirePermission('news', 'create'), supporting.jobs.create);
router.put('/jobs/:id', requirePermission('news', 'edit'), supporting.jobs.update);
router.delete('/jobs/:id', requirePermission('news', 'delete'), supporting.jobs.remove);

// Tourist attractions
router.get('/attractions', requirePermission('news', 'view'), supporting.attractions.list);
router.post('/attractions', requirePermission('news', 'create'), supporting.attractions.create);
router.put('/attractions/:id', requirePermission('news', 'edit'), supporting.attractions.update);
router.delete('/attractions/:id', requirePermission('news', 'delete'), supporting.attractions.remove);

// E-papers
router.get('/e-papers', requirePermission('media', 'view'), supporting.ePapers.list);
router.post('/e-papers', requirePermission('media', 'upload'), singleFile('pdf'), supporting.ePapers.create);
router.put('/e-papers/:id', requirePermission('media', 'upload'), supporting.ePapers.update);
router.delete('/e-papers/:id', requirePermission('media', 'delete'), supporting.ePapers.remove);

// Site settings
router.get('/settings', requirePermission('settings', 'view'), supporting.settings.get);
router.put('/settings', requirePermission('settings', 'edit'), supporting.settings.update);

// Dashboard / analytics / activity logs
router.get('/dashboard/stats', requirePermission('news', 'view'), supporting.dashboardStats);
router.get('/analytics/top-articles', requirePermission('news', 'view'), supporting.topArticles);
router.get('/activity-logs', requirePermission('settings', 'view'), supporting.activityLogs);

module.exports = router;
