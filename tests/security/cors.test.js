'use strict';

const env = require('../../src/config/env');

const mockPrisma = { $queryRaw: jest.fn() };
jest.mock('../../src/config/prisma', () => mockPrisma);
jest.mock('../../src/utils/sanitizeHtml', () => ({
  sanitizeArticleHtml: (value) => value,
  wordCount: () => 0,
}));

const { corsOptions } = require('../../src/app');

test('CORS includes configured frontend defaults and credentials intentionally', () => {
  expect(env.CORS_ORIGINS).toEqual(expect.arrayContaining([
    env.ADMIN_FRONTEND_ORIGIN,
    env.PUBLIC_FRONTEND_ORIGIN,
  ]));
  expect(corsOptions.credentials).toBe(true);
  expect(corsOptions.allowedHeaders).toEqual(expect.arrayContaining(['Content-Type', 'Authorization']));
});

test('CORS permits configured/no-origin calls and rejects unknown origins', () => {
  const allowed = jest.fn();
  corsOptions.origin(env.ADMIN_FRONTEND_ORIGIN, allowed);
  expect(allowed).toHaveBeenCalledWith(null, true);

  const serverToServer = jest.fn();
  corsOptions.origin(undefined, serverToServer);
  expect(serverToServer).toHaveBeenCalledWith(null, true);

  const rejected = jest.fn();
  corsOptions.origin('https://attacker.example', rejected);
  expect(rejected.mock.calls[0][0]).toMatchObject({ status: 403, code: 'FORBIDDEN' });
});
