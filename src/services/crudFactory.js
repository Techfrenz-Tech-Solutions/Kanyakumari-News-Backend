'use strict';

/**
 * Generic CRUD factory for simple admin resources.
 * Each resource declares: prisma model key, list shape, create/update field
 * whitelist, and optional hooks. Keeps controllers thin and consistent.
 */
const prisma = require('../config/prisma');
const { ApiErrors } = require('../utils/apiError');
const { logActivity } = require('./auditService');

/**
 * @param {object} opts
 * @param {string} opts.model       Prisma model delegate name (e.g. 'category')
 * @param {string} opts.module      RBAC module (e.g. 'categories')
 * @param {string} opts.recordLabel Human label for audit logs (e.g. 'category')
 * @param {string} opts.uniqueField Unique field used for idempotent upsert by client ids (optional)
 * @param {object} opts.listInclude Default include for list/detail
 * @param {Function} [opts.map]     (row, ctx) => dto
 * @param {Function} [opts.beforeCreate] (data, req) => data
 * @param {Function} [opts.beforeUpdate] (id, data, req) => data
 * @param {Function} [opts.afterCreate] (req, row)
 * @param {Function} [opts.afterUpdate] (req, row)
 * @param {Function} [opts.afterDelete] (req, row)
 * @param {object}  [opts.listQuery] (req) => where/orderBy extra
 */
function createCrudService(opts) {
  const model = prisma[opts.model];
  const map = opts.map || ((row) => row);

  async function list(req) {
    const where = { ...(opts.listWhere ? opts.listWhere(req) : {}) };
    const take = Math.min(parseInt(req.query.limit || req.query.pageSize, 10) || 50, 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const skip = (page - 1) * take;
    const orderBy = opts.orderBy || { createdAt: 'desc' };

    const [items, total] = await Promise.all([
      model.findMany({ where, take, skip, orderBy, include: opts.listInclude }),
      model.count({ where }),
    ]);
    return { items: items.map((r) => map(r, req)), total, page, limit: take, hasMore: skip + take < total };
  }

  async function get(req) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw ApiErrors.badRequest('Invalid id');
    const row = await model.findFirst({ where: { id }, include: opts.detailInclude || opts.listInclude });
    if (!row) throw ApiErrors.notFound(`${opts.recordLabel} not found`);
    return map(row, req);
  }

  async function create(req, data) {
    let payload = { ...data };
    if (opts.beforeCreate) payload = await opts.beforeCreate(payload, req);
    const row = await model.create({ data: payload, include: opts.listInclude });
    if (opts.afterCreate) await opts.afterCreate(req, row);
    return map(row, req);
  }

  async function update(req, data) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw ApiErrors.badRequest('Invalid id');
    const existing = await model.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound(`${opts.recordLabel} not found`);

    let payload = { ...data };
    if (opts.beforeUpdate) payload = await opts.beforeUpdate(id, payload, req);
    const row = await model.update({ where: { id }, data: payload, include: opts.listInclude });
    if (opts.afterUpdate) await opts.afterUpdate(req, row);
    return map(row, req);
  }

  async function remove(req) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw ApiErrors.badRequest('Invalid id');
    const existing = await model.findUnique({ where: { id } });
    if (!existing) throw ApiErrors.notFound(`${opts.recordLabel} not found`);
    await model.delete({ where: { id } });
    if (opts.afterDelete) await opts.afterDelete(req, existing);
    return { ok: true };
  }

  return { list, get, create, update, remove };
}

module.exports = { createCrudService };
