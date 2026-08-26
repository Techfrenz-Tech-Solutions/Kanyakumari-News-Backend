'use strict';

const { ROLE_PERMISSIONS, can, permissionsFor } = require('../../src/utils/rbac');

describe('RBAC permission matrix', () => {
  test.each(Object.keys(ROLE_PERMISSIONS))('%s has an explicit deny-by-default matrix', (role) => {
    expect(can({ role }, 'unknown', 'publish')).toBe(role === 'super_admin');
  });

  test('reporters may edit but may not publish or approve', () => {
    const reporter = { role: 'reporter' };
    expect(can(reporter, 'news', 'edit')).toBe(true);
    expect(can(reporter, 'news', 'publish')).toBe(false);
    expect(can(reporter, 'news', 'approve')).toBe(false);
  });

  test('per-user permissions add narrowly scoped grants', () => {
    const user = { role: 'reporter', extraPermissions: ['news:publish', 'media:delete'] };
    expect(permissionsFor(user, 'news')).toEqual(expect.arrayContaining(['edit', 'publish']));
    expect(can(user, 'news', 'approve')).toBe(false);
  });

  test('super admin bypass remains intact', () => {
    expect(can({ role: 'super_admin' }, 'news', 'publish')).toBe(true);
  });
});
