'use strict';

const crypto = require('node:crypto');
const { hash } = require('@node-rs/argon2');
const prisma = require('../config/prisma');
const { ApiErrors, asyncHandler } = require('../utils/apiError');
const { logActivity } = require('../services/auditService');
const { reporterDto, authorDto, editorDto, userDto } = require('../mappers/team');
const {
  reporterCreate,
  reporterUpdate,
  authorCreate,
  authorUpdate,
  editorCreate,
  editorUpdate,
  userCreate,
  userUpdate,
} = require('../validators/team.schema');
const { ARGON2_OPTS } = require('../services/authService');

function assertUserUpdateAllowed(actor, target, changes) {
  if (actor.role === 'super_admin') return;
  if (target.role === 'super_admin') {
    throw ApiErrors.forbidden('Only a Super Admin can modify a Super Admin account');
  }
  if (changes.role === 'super_admin') {
    throw ApiErrors.forbidden('Only a Super Admin can assign the Super Admin role');
  }
  if (changes.extraPermissions !== undefined) {
    throw ApiErrors.forbidden('Only a Super Admin can change additional permissions');
  }
}

// ─────────────────────────── REPORTERS ───────────────────────────

const reporters = {
  list: asyncHandler(async (req, res) => {
    const rows = await prisma.reporter.findMany({
      where: { status: req.query.status ? { equals: req.query.status } : undefined },
      orderBy: { name: 'asc' },
      include: { _count: { select: { articles: true } }, avatar: true },
    });
    res.json({ success: true, data: rows.map(reporterDto) });
  }),

  create: asyncHandler(async (req, res) => {
    const data = reporterCreate.parse(req.body);
    const row = await prisma.reporter.create({
      data: {
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        location: data.location || null,
        // Prefer explicit designation; fall back to the admin "role"/"Designation" field.
        designation: data.designation || data.role || null,
        bio: data.bio || null,
        avatarId: data.avatarId || null,
        status: data.status,
      },
      include: { _count: { select: { articles: true } }, avatar: true },
    });
    await logActivity({ req, userId: req.user.id, action: 'reporter.created', module: 'reporters', record: data.name });
    res.status(201).json({ success: true, data: reporterDto(row) });
  }),

  get: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = await prisma.reporter.findFirst({
      where: { id },
      include: { _count: { select: { articles: true } }, avatar: true },
    });
    if (!row) throw ApiErrors.notFound('Reporter not found');
    res.json({ success: true, data: reporterDto(row) });
  }),

  update: asyncHandler(async (req, res) => {
    const data = reporterUpdate.parse(req.body);
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.reporter.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Reporter not found');
    const row = await prisma.reporter.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.location !== undefined ? { location: data.location } : {}),
        ...(data.designation !== undefined ? { designation: data.designation } : {}),
        ...(data.designation === undefined && data.role !== undefined ? { designation: data.role } : {}),
        ...(data.bio !== undefined ? { bio: data.bio } : {}),
        ...(data.avatarId !== undefined ? { avatarId: data.avatarId } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
      include: { _count: { select: { articles: true } }, avatar: true },
    });
    await logActivity({ req, userId: req.user.id, action: 'reporter.updated', module: 'reporters', record: row.name });
    res.json({ success: true, data: reporterDto(row) });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.reporter.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Reporter not found');
    const articleCount = await prisma.article.count({ where: { authorId: id } });
    if (articleCount > 0) {
      throw ApiErrors.conflict(`Cannot delete reporter who authored ${articleCount} article(s)`, 'REPORTER_IN_USE');
    }
    await prisma.reporter.delete({ where: { id } });
    await logActivity({ req, userId: req.user.id, action: 'reporter.deleted', module: 'reporters', record: existing.name });
    res.json({ success: true, data: { ok: true } });
  }),
};

// ──────────────────────────── AUTHORS ────────────────────────────

const authors = {
  list: asyncHandler(async (req, res) => {
    const rows = await prisma.author.findMany({
      where: { status: req.query.status ? { equals: req.query.status } : undefined },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: rows.map(authorDto) });
  }),

  create: asyncHandler(async (req, res) => {
    const data = authorCreate.parse(req.body);
    const row = await prisma.author.create({
      data: {
        name: data.name,
        email: data.email || null,
        bio: data.bio || null,
        specialization: data.specialization || null,
        twitterHandle: data.twitterHandle || null,
        status: data.status,
      },
    });
    await logActivity({ req, userId: req.user.id, action: 'author.created', module: 'reporters', record: data.name });
    res.status(201).json({ success: true, data: authorDto(row) });
  }),

  update: asyncHandler(async (req, res) => {
    const data = authorUpdate.parse(req.body);
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.author.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Author not found');
    const row = await prisma.author.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.bio !== undefined ? { bio: data.bio } : {}),
        ...(data.specialization !== undefined ? { specialization: data.specialization } : {}),
        ...(data.twitterHandle !== undefined ? { twitterHandle: data.twitterHandle } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });
    await logActivity({ req, userId: req.user.id, action: 'author.updated', module: 'reporters', record: row.name });
    res.json({ success: true, data: authorDto(row) });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.author.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Author not found');
    await prisma.author.delete({ where: { id } });
    await logActivity({ req, userId: req.user.id, action: 'author.deleted', module: 'reporters', record: existing.name });
    res.json({ success: true, data: { ok: true } });
  }),
};

// ──────────────────────────── EDITORS ────────────────────────────

const editors = {
  list: asyncHandler(async (req, res) => {
    const rows = await prisma.editor.findMany({
      where: { status: req.query.status ? { equals: req.query.status } : undefined },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: rows.map(editorDto) });
  }),

  create: asyncHandler(async (req, res) => {
    const data = editorCreate.parse(req.body);
    const row = await prisma.editor.create({
      data: {
        name: data.name,
        email: data.email || null,
        phone: data.phone || null,
        role: data.role,
        department: data.department,
        permissions: JSON.stringify(data.permissions || ['edit']),
        status: data.status,
      },
    });
    await logActivity({ req, userId: req.user.id, action: 'editor.created', module: 'reporters', record: data.name });
    res.status(201).json({ success: true, data: editorDto(row) });
  }),

  update: asyncHandler(async (req, res) => {
    const data = editorUpdate.parse(req.body);
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.editor.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Editor not found');
    const row = await prisma.editor.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.role !== undefined ? { role: data.role } : {}),
        ...(data.department !== undefined ? { department: data.department } : {}),
        ...(data.permissions !== undefined ? { permissions: JSON.stringify(data.permissions) } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });
    await logActivity({ req, userId: req.user.id, action: 'editor.updated', module: 'reporters', record: row.name });
    res.json({ success: true, data: editorDto(row) });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.editor.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('Editor not found');
    await prisma.editor.delete({ where: { id } });
    await logActivity({ req, userId: req.user.id, action: 'editor.deleted', module: 'reporters', record: existing.name });
    res.json({ success: true, data: { ok: true } });
  }),
};

// ──────────────────────────── USERS ────────────────────────────

const users = {
  list: asyncHandler(async (req, res) => {
    const rows = await prisma.user.findMany({
      where: { status: req.query.status ? { equals: req.query.status } : undefined },
      orderBy: { name: 'asc' },
      include: { avatar: true },
    });
    res.json({ success: true, data: rows.map(userDto) });
  }),

  create: asyncHandler(async (req, res) => {
    const data = userCreate.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw ApiErrors.conflict('A user with this email already exists', 'EMAIL_EXISTS');

    // Invite flow: if no password supplied, generate a temporary one (returned once).
    let tempPassword = null;
    const password = data.password || `KKN-${crypto.randomBytes(12).toString('base64url')}`;
    if (!data.password) tempPassword = password;

    const passwordHash = await hash(password, ARGON2_OPTS);
    const row = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash,
        role: data.role,
        status: data.status,
        extraPermissions: data.extraPermissions ? JSON.stringify(data.extraPermissions) : null,
      },
      include: { avatar: true },
    });
    await logActivity({
      req,
      userId: req.user.id,
      action: 'user.invited',
      module: 'users',
      record: data.email,
      details: tempPassword ? 'temp-password-issued' : 'password-provided',
    });
    res.status(201).json({
      success: true,
      data: {
        user: userDto(row),
        // Only returned when a temp password was generated (invite flow).
        ...(tempPassword ? { tempPassword } : {}),
      },
    });
  }),

  update: asyncHandler(async (req, res) => {
    const data = userUpdate.parse(req.body);
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('User not found');

    assertUserUpdateAllowed(req.user, existing, data);

    const row = await prisma.user.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.role !== undefined ? { role: data.role } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.extraPermissions !== undefined
          ? { extraPermissions: data.extraPermissions ? JSON.stringify(data.extraPermissions) : null }
          : {}),
      },
      include: { avatar: true },
    });
    await logActivity({ req, userId: req.user.id, action: 'user.updated', module: 'users', record: row.email });
    res.json({ success: true, data: userDto(row) });
  }),

  remove: asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (id === req.user.id) throw ApiErrors.badRequest('You cannot delete your own account');
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound('User not found');
    await prisma.user.delete({ where: { id } });
    await logActivity({ req, userId: req.user.id, action: 'user.deleted', module: 'users', record: existing.email });
    res.json({ success: true, data: { ok: true } });
  }),
};

module.exports = { reporters, authors, editors, users, assertUserUpdateAllowed };
