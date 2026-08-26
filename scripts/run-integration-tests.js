'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const operationalUrl = process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.log('Integration tests skipped: TEST_DATABASE_URL is not configured.');
  process.exit(0);
}
if (testUrl === operationalUrl) {
  console.error('Integration tests refused: TEST_DATABASE_URL must differ from DATABASE_URL.');
  process.exit(1);
}

const jestBin = require.resolve('jest/bin/jest');
const result = spawnSync(
  process.execPath,
  [jestBin, '--config', path.resolve(__dirname, '../jest.integration.config.cjs'), '--runInBand'],
  {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: testUrl,
      KKN_INTEGRATION_DB_CONFIRMED: 'true',
      ENABLE_SCHEDULER: 'false',
    },
    stdio: 'inherit',
  }
);

process.exit(result.status ?? 1);
