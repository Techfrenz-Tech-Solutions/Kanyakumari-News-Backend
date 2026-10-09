'use strict';

const { z } = require('zod');

const emailSchema = z.string().trim().toLowerCase().email().max(190);
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/, 'Phone must be 10-15 digits (optionally with +)');
const otpSchema = z.string().trim().regex(/^\d{6}$/, 'OTP must be exactly 6 digits');

const readerLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
});

const otpRequestSchema = z.object({ phone: phoneSchema });
const otpVerifySchema = z.object({ phone: phoneSchema, otp: otpSchema });

const commentCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema.optional().nullable(),
  body: z
    .string()
    .trim()
    .min(2, 'Comment is too short')
    .max(2000, 'Comment too long (max 2000 chars)'),
});

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  phone: z.string().trim().max(40).optional().nullable(),
  subject: z.string().trim().max(200).optional().nullable(),
  message: z.string().trim().min(1).max(5000),
});

module.exports = {
  readerLoginSchema,
  otpRequestSchema,
  otpVerifySchema,
  commentCreateSchema,
  contactSchema,
  phoneSchema,
};
