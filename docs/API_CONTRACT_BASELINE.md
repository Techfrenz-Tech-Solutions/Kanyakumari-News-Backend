# API Contract Baseline

This document records the backend contract at the end of Step 1. It is a baseline for the Admin Panel and Public Frontend adapters, not a redesign of every existing endpoint.

## Authentication

### Admin

- Login: `POST /api/admin/auth/login` returns `data.accessToken` and `data.user`.
- Access authentication: `Authorization: Bearer <access-token>`; the JWT is short-lived and has `kind=admin`.
- Refresh: `POST /api/admin/auth/refresh`; the opaque refresh token is normally carried by the configured httpOnly cookie.
- Refresh tokens are stored hashed, rotate on use, and are revoked on logout, password change, or password reset.
- The refresh cookie is `httpOnly`, `SameSite=Strict`, scoped to `/api`, and `Secure` in production.
- Authenticated admin routes reload the user and deny users whose status is not `active`.

### Reader

- Email login: `POST /api/auth/login`.
- OTP: `POST /api/auth/otp/request` and `POST /api/auth/otp/verify`.
- Reader tokens use the validated reader JWT secret/expiry and the `reader_token` httpOnly cookie.
- The console OTP provider is development/test-only. This build intentionally refuses unsupported production providers.

## Envelopes

Canonical success:

```json
{
  "success": true,
  "data": {}
}
```

Canonical error:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": null
  }
}
```

Validation errors use `VALIDATION_ERROR` and an array of `{ "path", "message" }` objects in `details`. Production 500 responses use `INTERNAL_ERROR` without Prisma messages or stack traces.

## Pagination Variants

These existing variants are intentionally preserved for compatibility:

| Endpoint family | `data` shape |
| --- | --- |
| Admin news | `{ items, total, page, limit, totalPages }` |
| Public `GET /api/news` | `{ items, hasMore, total }` |
| Admin media | `{ items, total, page, limit, hasMore }` |
| Several supporting Admin lists | `{ items, total: { total, page, limit, totalPages } }` |
| Search, hero, gallery, categories | Plain array |

The nested `total` object used by supporting Admin resources is a known exception. Step 2 adapters must not assume one global pagination representation.

## Admin Article DTO

The Admin article representation contains:

```text
id, title, shortDescription, excerpt, titleTA, excerptTA,
content, contentTA, slug, image, featuredImageId,
category, categoryId, subCategory, subcategoryId,
author, authorId, authorRole, area, areaId, location,
tags[], isBreaking, isFeatured, status,
publishDate, publishTime, publishedAt, views, rejectionReason,
words, createdAt, updatedAt
```

List requests may omit `content`/`contentTA` unless `includeContent=true`. Tags are normalized to lowercase names and returned as a string array.

## Public Article DTO

Summary:

```text
id, slug, title, titleTA, excerpt, excerptTA, image,
category (slug), area (slug), tags[], breaking, featured,
views, publishedAt, readTime
```

Detail adds:

```text
content, contentTA, subcategory (slug), author,
location, updatedAt, seo, publisherName
```

Public visibility is always:

```text
status = published AND publishedAt <= current time
```

Draft, pending, scheduled, future-dated, and otherwise non-published articles are excluded from public news, detail, category, hero, related, trending hydration, and search queries.

## Media DTO

```text
id, name, url, thumbnailUrl, mimeType, sizeBytes,
size, kind, width, height, uploadedAt
```

Uploads accept detected PNG, JPEG, WebP, and PDF content subject to configured size/kind limits. The stored extension comes from magic-byte detection, not the submitted filename.

## Category DTOs

Admin category:

```text
id, name, slug, status, sortOrder, articleCount,
subcategories[], subcategoryIds[]
```

Public category:

```json
{ "slug": "category-slug", "label": "Display Name" }
```

## Search Contract

`GET /api/search?q=<query>&category=<optional-slug>&sort=<mode>&limit=<1..50>`

- Empty query: successful empty array.
- Query length: maximum 200 characters; longer input returns controlled `400 BAD_REQUEST`.
- Sort modes: `relevance` (default), `newest`, `popular`.
- Relevance uses bounded, parameterized Prisma `contains` queries over title, excerpt, content, and tags, followed by deterministic in-process ranking.
- Category filter uses the category slug. An unknown category returns a successful empty array.
- Only publicly visible articles are returned.
- Result shape is a plain array of public article summaries.

## Lifecycle and RBAC

| Operation | Required effective permission |
| --- | --- |
| Create draft | `news.create` |
| Create pending | `news.create` + `news.edit` |
| Create scheduled | `news.create` + `news.publish` |
| Create published | `news.create` + `news.publish` |
| Edit article fields | `news.edit` |
| Submit draft | `news.edit` |
| Approve pending | `news.approve` |
| Reject pending | `news.approve` |
| Publish now | `news.publish` |
| Unpublish | `news.publish` |
| Cancel schedule | `news.publish` |

Lifecycle endpoint:

```text
POST /api/admin/news/:id/status
body: { action, reason? }
```

Supported actions are `submit`, `approve`, `reject`, `publish-now`, `unpublish`, and `cancel-schedule`. Invalid source/action combinations return `409 INVALID_STATUS_TRANSITION` without mutation.

Compatibility change:

- Old behavior: every status action required only `news.edit`; creation could start as scheduled/published with only `news.create`.
- New behavior: the action/status-specific permissions above are enforced before the controller mutates data.
- Successful DTO/envelope shapes are unchanged.
- Admin clients should hide or disable actions using the same permission mapping, but server-side enforcement remains authoritative.
