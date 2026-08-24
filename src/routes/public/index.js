'use strict';

/**
 * PUBLIC API routes.
 * Base: /api  (mounted in app.js)
 *
 * Contract reference: kanyakumari-news-frontend/src/services/newsService.js
 */
const express = require('express');
const controller = require('../../controllers/publicController');
const publicAuth = require('./readerAuth');
const {
  publicContentLimiter,
  searchLimiter,
  authLimiter,
  commentLimiter,
  contactLimiter,
} = require('../../middleware/rateLimiters');

const router = express.Router();

// Homepage aggregate
router.get('/home', publicContentLimiter, controller.home);

// Individual feed endpoints (1:1 with newsService methods)
router.get('/hero', controller.hero);
router.get('/breaking', controller.breaking);

// News listing + article detail
router.get('/news', publicContentLimiter, controller.newsList);
router.get('/news/category/:slug', controller.newsByCategory);
router.get('/news/:slug', publicContentLimiter, controller.articleBySlug);

// Trending / most read
router.get('/trending', controller.trending);

// Taxonomy
router.get('/categories', controller.categories);
router.get('/areas', controller.areas);

// Search
router.get('/search', searchLimiter, controller.search);

// Media / content
router.get('/gallery', controller.gallery);
router.get('/videos', controller.videos);

// Providers (weather / market)
router.get('/weather', controller.weather);
router.get('/market', controller.market);
router.get('/market/stocks', controller.marketStocks);
router.get('/market/rates', controller.marketRates);

// Reference data
router.get('/jobs', controller.jobs);
router.get('/tourist-attractions', controller.touristAttractions);
router.get('/district-info', controller.districtInfo);

// E-paper
router.get('/e-paper', controller.ePaperList);
router.get('/e-paper/:date', controller.ePaperByDate);

// Site settings
router.get('/settings/site', controller.siteSettings);

// Ads
router.get('/ads', controller.adsByPosition);

// Comments — read (public) / write (authenticated reader)
router.get('/news/:slug/comments', controller.commentsPublic);
router.post('/comments', commentLimiter, publicAuth.requireReader, publicAuth.createComment);

// Reader auth (email/password + OTP)
router.post('/auth/login', authLimiter, controller.readerLogin);
router.post('/auth/otp/request', authLimiter, controller.otpRequest);
router.post('/auth/otp/verify', authLimiter, controller.otpVerify);

// Contact
router.post('/contact', contactLimiter, controller.contact);

// SEO: sitemap + robots (XML / text)
router.get('/sitemap.xml', controller.sitemap);
router.get('/robots.txt', controller.robots);

module.exports = router;
