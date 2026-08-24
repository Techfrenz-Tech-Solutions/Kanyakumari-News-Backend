'use strict';

const express = require('express');
const authService = require('../../services/authService');
const tokenService = require('../../services/tokenService');
const { authenticateAdmin } = require('../../middleware/authenticate');
const { asyncHandler } = require('../../utils/apiError');
const { authLimiter, refreshLimiter } = require('../../middleware/rateLimiters');
const {
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  changePasswordSchema,
} = require('../../validators/auth.schema');

const router = express.Router();

/**
 * Admin auth — mounted at /api/admin/auth.
 * Client model: accessToken -> app memory, refreshToken -> httpOnly cookie.
 */

// POST /api/admin/auth/login
router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const result = await authService.login({ email, password }, req);
    tokenService.setRefreshCookie(res, result.refreshToken);
    res.json({
      success: true,
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  })
);

// POST /api/admin/auth/refresh
router.post(
  '/refresh',
  refreshLimiter,
  asyncHandler(async (req, res) => {
    refreshSchema.parse({ refreshToken: req.cookies?.kkn_refresh || req.body?.refreshToken });
    const result = await authService.refresh(req);
    tokenService.setRefreshCookie(res, result.refreshToken);
    res.json({
      success: true,
      data: {
        accessToken: result.accessToken,
        user: result.user,
      },
    });
  })
);

// POST /api/admin/auth/logout
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await authService.logout(req);
    tokenService.clearRefreshCookie(res);
    res.json({ success: true, data: { ok: true } });
  })
);

// GET /api/admin/auth/me
router.get(
  '/me',
  authenticateAdmin,
  asyncHandler(async (req, res) => {
    const user = await authService.me(req);
    res.json({ success: true, data: { user } });
  })
);

// POST /api/admin/auth/forgot-password
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    const result = await authService.forgotPassword({ email }, req);
    res.json({ success: true, data: result });
  })
);

// POST /api/admin/auth/reset-password
router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);
    const result = await authService.resetPassword({ token, newPassword });
    res.json({ success: true, data: result });
  })
);

// PUT /api/admin/auth/profile  (own profile)
router.put(
  '/profile',
  authenticateAdmin,
  asyncHandler(async (req, res) => {
    const data = updateProfileSchema.parse(req.body);
    const user = await authService.updateProfile(req, data);
    res.json({ success: true, data: { user } });
  })
);

// PUT /api/admin/auth/password  (change own password)
router.put(
  '/password',
  authenticateAdmin,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const result = await authService.changePassword(req, { currentPassword, newPassword });
    res.json({ success: true, data: result });
  })
);

module.exports = router;
