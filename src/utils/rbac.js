'use strict';

/**
 * RBAC — the EXACT role-permission matrix reconstructed from
 * Kanyakumari-Admin-Panel/src/data/mockData.js (rolePermissions).
 * Do not approximate: each entry below mirrors that source 1:1.
 *
 * Roles (UI label -> DB enum value):
 *   Super Admin           -> super_admin
 *   Admin                 -> admin
 *   Editor                -> editor
 *   Reporter              -> reporter
 *   Moderator             -> moderator
 *   Content Manager       -> content_manager
 *   Advertisement Manager -> advertisement_manager
 */
const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  editor: 'Editor',
  reporter: 'Reporter',
  moderator: 'Moderator',
  content_manager: 'Content Manager',
  advertisement_manager: 'Advertisement Manager',
};

const ROLE_PERMISSIONS = {
  super_admin: {
    news: ['view', 'create', 'edit', 'delete', 'publish', 'approve'],
    categories: ['view', 'create', 'edit', 'delete'],
    reporters: ['view', 'create', 'edit', 'delete'],
    media: ['view', 'upload', 'delete'],
    ads: ['view', 'create', 'edit', 'delete'],
    comments: ['view', 'moderate', 'delete'],
    users: ['view', 'create', 'edit', 'delete'],
    settings: ['view', 'edit'],
  },
  admin: {
    news: ['view', 'create', 'edit', 'delete', 'publish'],
    categories: ['view', 'create', 'edit'],
    reporters: ['view', 'create', 'edit'],
    media: ['view', 'upload', 'delete'],
    ads: ['view', 'create', 'edit'],
    comments: ['view', 'moderate', 'delete'],
    users: ['view', 'edit'],
    settings: ['view'],
  },
  editor: {
    news: ['view', 'create', 'edit', 'publish', 'approve'],
    categories: ['view'],
    reporters: ['view'],
    media: ['view', 'upload'],
    ads: ['view'],
    comments: ['view', 'moderate'],
    users: [],
    settings: [],
  },
  reporter: {
    news: ['view', 'create', 'edit'],
    categories: ['view'],
    reporters: ['view'],
    media: ['view', 'upload'],
    ads: [],
    comments: ['view'],
    users: [],
    settings: [],
  },
  moderator: {
    news: ['view'],
    categories: ['view'],
    reporters: ['view'],
    media: ['view'],
    ads: ['view'],
    comments: ['view', 'moderate', 'delete'],
    users: [],
    settings: [],
  },
  content_manager: {
    news: ['view', 'create', 'edit'],
    categories: ['view', 'create', 'edit'],
    reporters: ['view'],
    media: ['view', 'upload', 'delete'],
    ads: ['view'],
    comments: ['view'],
    users: [],
    settings: [],
  },
  advertisement_manager: {
    news: ['view'],
    categories: ['view'],
    reporters: [],
    media: ['view', 'upload'],
    ads: ['view', 'create', 'edit', 'delete'],
    comments: [],
    users: [],
    settings: [],
  },
};

/**
 * Returns the effective permission list for a user on a module.
 * - Super Admin bypasses every check (returns '*').
 * - Base role permissions come from the matrix.
 * - user.extraPermissions (JSON array of "module:action" strings) adds
 *   per-user overrides (as implied by the Editor/User UIs).
 */
function permissionsFor(user, module) {
  if (!user) return [];
  if (user.role === 'super_admin') return ['*'];

  const base = (ROLE_PERMISSIONS[user.role] || {})[module] || [];
  let extra = user.extraPermissions || [];
  if (typeof extra === 'string') {
    try {
      extra = JSON.parse(extra);
    } catch {
      extra = [];
    }
  }
  const extras = Array.isArray(extra)
    ? extra.filter((p) => typeof p === 'string' && p.startsWith(`${module}:`)).map((p) => p.slice(module.length + 1))
    : [];

  const merged = new Set([...base, ...extras]);
  return [...merged];
}

/** True if the user may perform `action` on `module` (deny by default). */
function can(user, module, action) {
  if (!user) return false;
  const perms = permissionsFor(user, module);
  return perms.includes('*') || perms.includes(action);
}

module.exports = { ROLE_PERMISSIONS, ROLE_LABELS, permissionsFor, can };
