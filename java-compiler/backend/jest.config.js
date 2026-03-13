'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  verbose: true,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',
  ],
  coverageReporters: ['text', 'lcov', 'html'],
};
