'use strict';

jest.mock('../../src/config/prisma', () => ({}));
jest.mock('../../src/services/auditService', () => ({ logActivity: jest.fn() }));

const { assertUserUpdateAllowed } = require('../../src/controllers/teamController');
const { userUpdate } = require('../../src/validators/team.schema');

describe('user administration privilege boundaries', () => {
  test('admin cannot promote a user to super admin', () => {
    expect(() => assertUserUpdateAllowed(
      { role: 'admin' }, { role: 'editor' }, { role: 'super_admin' }
    )).toThrow(expect.objectContaining({ status: 403 }));
  });

  test('admin cannot alter a super admin or arbitrary extra permissions', () => {
    expect(() => assertUserUpdateAllowed(
      { role: 'admin' }, { role: 'super_admin' }, { status: 'inactive' }
    )).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => assertUserUpdateAllowed(
      { role: 'admin' }, { role: 'editor' }, { extraPermissions: ['users:edit'] }
    )).toThrow(expect.objectContaining({ status: 403 }));
  });

  test('super admin may manage roles and extra permissions', () => {
    expect(() => assertUserUpdateAllowed(
      { role: 'super_admin' }, { role: 'editor' }, { role: 'super_admin', extraPermissions: [] }
    )).not.toThrow();
  });

  test('unknown permissions and password changes are rejected by update schema', () => {
    expect(() => userUpdate.parse({ extraPermissions: ['root:anything'] })).toThrow();
    expect(() => userUpdate.parse({ password: 'must-not-be-updated-here' })).toThrow();
  });
});
