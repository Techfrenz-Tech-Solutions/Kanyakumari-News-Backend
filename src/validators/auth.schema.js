'use strict';

const { z } = require('zod');

const emailSchema = z.string().trim().toLowerCase().email().max(190);

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(200),
});

const refreshSchema = z.object({
  // refresh token travels in the httpOnly cookie; body optional for compatibility
  refreshToken: z.string().min(1).max(200).optional(),
});

const forgotPasswordSchema = z.object({
  email: emailSchema,
});

const resetPasswordSchema = z
  .object({
    token: z.string().min(8).max(200),
    newPassword: z.string().min(8, 'Password must be at least 8 characters').max(200),
  })
  .strict();

const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(30).optional().nullable(),
    bio: z.string().trim().max(5000).optional().nullable(),
    avatarId: z.number().int().positive().optional().nullable(),
    // Media URL string (admin Profile uploads via POST /api/admin/upload and
    // submits the returned url). Resolved to the internal Media row in
    // authService.updateProfile; empty/whitespace-only clears the avatar.
    avatar: z.string().trim().max(2083).optional().nullable(),
  })
  .partial();

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'New password must be at least 8 characters').max(200),
  })
  .strict();

module.exports = {
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  changePasswordSchema,
};
