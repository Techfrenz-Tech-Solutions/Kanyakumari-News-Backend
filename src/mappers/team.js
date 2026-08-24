'use strict';

/**
 * Team mappers (reporters, authors, editors, users).
 * The admin UI identifies people by name; we keep both id and name.
 */

function reporterDto(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    location: row.location,
    // Admin form field is "Designation"; expose both for compat.
    designation: row.designation,
    role: row.designation,
    bio: row.bio,
    avatar: row.avatar?.url || null,
    status: row.status,
    articleCount: row._count?.articles ?? 0,
  };
}

function authorDto(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    bio: row.bio,
    specialization: row.specialization,
    twitterHandle: row.twitterHandle,
    status: row.status,
  };
}

function editorDto(row) {
  let permissions = row.permissions;
  if (typeof permissions === 'string') {
    try {
      permissions = JSON.parse(permissions);
    } catch {
      permissions = [];
    }
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    department: row.department,
    permissions: permissions || [],
    status: row.status,
    lastLoginAt: row.lastLoginAt,
  };
}

function userDto(row) {
  let extra = row.extraPermissions;
  if (typeof extra === 'string') {
    try {
      extra = JSON.parse(extra);
    } catch {
      extra = [];
    }
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    bio: row.bio,
    avatar: row.avatar?.url || null,
    role: row.role,
    status: row.status,
    extraPermissions: extra || [],
    lastLoginAt: row.lastLoginAt,
  };
}

module.exports = { reporterDto, authorDto, editorDto, userDto };
