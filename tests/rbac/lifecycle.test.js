'use strict';

const {
  ARTICLE_ACTION_PERMISSIONS,
  requireArticleLifecyclePermission,
  requireArticleInitialStatusPermission,
} = require('../../src/middleware/authenticate');
const { ROLE_PERMISSIONS } = require('../../src/utils/rbac');

function run(middleware, user, body) {
  const next = jest.fn();
  middleware({ user, body }, {}, next);
  return next.mock.calls[0][0];
}

describe('article lifecycle authorization', () => {
  test.each(Object.keys(ROLE_PERMISSIONS))('%s follows the actual permission matrix', (role) => {
    for (const [action, permission] of Object.entries(ARTICLE_ACTION_PERMISSIONS)) {
      const error = run(requireArticleLifecyclePermission, { role }, { action });
      const allowed = role === 'super_admin' || ROLE_PERMISSIONS[role].news.includes(permission);
      expect(error === undefined).toBe(allowed);
      if (!allowed) expect(error.status).toBe(403);
    }
  });

  test.each(['scheduled', 'published'])('reporter cannot create directly as %s', (status) => {
    expect(run(requireArticleInitialStatusPermission, { role: 'reporter' }, { status }).status).toBe(403);
  });

  test('extra per-user publishing permission is honoured', () => {
    const user = { role: 'reporter', extraPermissions: ['news:publish'] };
    expect(run(requireArticleLifecyclePermission, user, { action: 'publish-now' })).toBeUndefined();
    expect(run(requireArticleInitialStatusPermission, user, { status: 'published' })).toBeUndefined();
  });

  test('unknown action reaches validation without granting an action', () => {
    expect(run(requireArticleLifecyclePermission, { role: 'reporter' }, { action: 'forged' })).toBeUndefined();
  });
});
