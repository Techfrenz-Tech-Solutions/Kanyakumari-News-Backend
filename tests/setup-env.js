'use strict';

// Tests mock the Prisma boundary. This deliberately unusable URL prevents an
// accidental connection to the operational database if a mock is missed.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'mysql://invalid:invalid@127.0.0.1:1/never_connect';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-long-enough';
process.env.JWT_READER_SECRET = 'test-reader-secret-that-is-long-enough';
process.env.IP_HASH_SECRET = 'test-ip-hash-secret';
process.env.ENABLE_SCHEDULER = 'false';
