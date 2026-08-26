'use strict';

if (process.env.KKN_INTEGRATION_DB_CONFIRMED !== 'true') {
  throw new Error('Integration tests must be launched through scripts/run-integration-tests.js');
}
if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
  throw new Error('Integration tests require the confirmed dedicated test database');
}
