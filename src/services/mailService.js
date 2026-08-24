'use strict';

/**
 * Mail provider abstraction (nodemailer).
 * When SMTP is not configured (development), messages are logged to the
 * console and reported as NOT delivered — never falsely claimed.
 */
const nodemailer = require('nodemailer');
const env = require('../config/env');
const logger = require('../utils/logger');

let transporter = null;

function getTransporter() {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  return transporter;
}

/**
 * @returns {Promise<{delivered: boolean, note?: string}>}
 */
async function send({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) {
    logger.warn({ to, subject }, 'SMTP not configured — mail not sent (dev mode)');
    return { delivered: false, note: 'smtp-not-configured' };
  }
  try {
    await t.sendMail({ from: env.SMTP_FROM, to, subject, text, html });
    return { delivered: true };
  } catch (err) {
    logger.error({ err: err.message, to, subject }, 'mail send failed');
    return { delivered: false, note: 'send-failed' };
  }
}

module.exports = { send };
