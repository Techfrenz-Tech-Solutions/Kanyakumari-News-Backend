'use strict';

const prisma = require('../config/prisma');
const { clientIp, hashIp } = require('../utils/ipHash');

/**
 * Audit logging for meaningful admin mutations + auth events.
 * Never logs passwords, OTPs, refresh tokens or other secrets.
 */
async function logActivity({ req = null, userId = null, action, module, record = null, details = null, ip = null }) {
  try {
    const ipAddress = ip || clientIp(req);
    await prisma.activityLog.create({
      data: {
        userId: userId ?? null,
        action,
        module,
        record: record ? String(record).slice(0, 120) : null,
        details: details ? String(details).slice(0, 2000) : null,
        ipAddress: ipAddress ? String(ipAddress).slice(0, 45) : null,
      },
    });
  } catch (err) {
    // Audit logging must never break the primary request.
    console.error('[audit] failed to write activity log:', err.message);
  }
}

module.exports = { logActivity };
