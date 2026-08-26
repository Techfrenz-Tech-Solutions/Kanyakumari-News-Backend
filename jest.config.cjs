'use strict';

module.exports = {
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.js', '!src/config/prisma.js'],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup-env.js'],
};
