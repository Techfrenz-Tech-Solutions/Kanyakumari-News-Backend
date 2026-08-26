'use strict';

module.exports = {
  clearMocks: true,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests-integration/**/*.test.js'],
  setupFiles: ['<rootDir>/tests-integration/setup-env.js'],
  transform: {},
  maxWorkers: 1,
};
