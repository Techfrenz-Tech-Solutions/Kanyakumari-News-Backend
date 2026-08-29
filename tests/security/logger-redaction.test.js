'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('response Set-Cookie values are redacted from structured logs', () => {
  const loggerPath = path.resolve(__dirname, '../../src/utils/logger.js');
  const secret = 'refresh-cookie-secret-that-must-not-appear';
  const script = [
    `const logger = require(${JSON.stringify(loggerPath)});`,
    `logger.info({ res: { headers: { 'set-cookie': ${JSON.stringify(secret)} } } }, 'cookie test');`,
  ].join('\n');

  const output = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  expect(output).not.toContain(secret);
  expect(JSON.parse(output).res.headers['set-cookie']).toBe('[REDACTED]');
});
