'use strict';

const { z } = require('zod');

const emailOptional = z.string().trim().toLowerCase().email().max(190).nullable().optional();
const statusEnum = z.enum(['active', 'inactive']);
const roleEnum = z.enum([
  'super_admin',
  'admin',
  'editor',
  'reporter',
  'moderator',
  'content_manager',
  'advertisement_manager',
]);
const editorRoleEnum = z.enum([
  'chief_editor',
  'deputy_editor',
  'associate_editor',
  'copy_editor',
  'sub_editor',
  'night_editor',
]);
const departmentEnum = z.enum([
  'news_desk',
  'features',
  'sports',
  'politics',
  'business',
  'cinema',
  'technology',
  'digital',
]);
const permissionEnum = z.enum(['publish', 'approve', 'reject', 'edit', 'delete', 'create']);

const reporterCreate = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailOptional,
  phone: z.string().trim().max(30).optional().nullable(),
  location: z.string().trim().max(120).optional().nullable(),
  // The admin form calls this "Designation"
  role: z.string().trim().max(80).optional().nullable(),
  designation: z.string().trim().max(80).optional().nullable(),
  bio: z.string().trim().max(5000).optional().nullable(),
  avatarId: z.number().int().positive().optional().nullable(),
  status: statusEnum.default('active'),
});

const reporterUpdate = reporterCreate.partial();

const authorCreate = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailOptional,
  bio: z.string().trim().max(5000).optional().nullable(),
  specialization: z.string().trim().max(120).optional().nullable(),
  twitterHandle: z
    .string()
    .trim()
    .max(80)
    .transform((v) => (v && !v.startsWith('@') ? `@${v}` : v))
    .optional()
    .nullable(),
  status: statusEnum.default('active'),
});

const authorUpdate = authorCreate.partial();

const editorCreate = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailOptional,
  phone: z.string().trim().max(30).optional().nullable(),
  role: editorRoleEnum.default('associate_editor'),
  department: departmentEnum.default('news_desk'),
  permissions: z.array(permissionEnum).max(6).default(['edit']),
  status: statusEnum.default('active'),
});

const editorUpdate = editorCreate.partial();

const userCreate = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(190),
  role: roleEnum.default('editor'),
  status: statusEnum.default('active'),
  // Optional initial password when creating a user directly (invite flow can omit it).
  password: z.string().min(8).max(200).optional(),
  extraPermissions: z.array(z.string()).max(64).optional(),
});

const userUpdate = userCreate
  .partial()
  .extend({
    extraPermissions: z.array(z.string()).max(64).nullable().optional(),
  });

module.exports = {
  reporterCreate,
  reporterUpdate,
  authorCreate,
  authorUpdate,
  editorCreate,
  editorUpdate,
  userCreate,
  userUpdate,
};
