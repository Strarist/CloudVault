/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldBootstrapAuth, shouldRedirectToLogin } = require('./sessionGuards.js');

test('should bootstrap auth only before the first auth check completes', () => {
  assert.equal(
    shouldBootstrapAuth({ hasInitialized: false, isAuthenticated: false, loading: false }),
    true,
  );
  assert.equal(
    shouldBootstrapAuth({ hasInitialized: true, isAuthenticated: false, loading: false }),
    false,
  );
  assert.equal(
    shouldBootstrapAuth({ hasInitialized: false, isAuthenticated: false, loading: true }),
    false,
  );
});

test('should redirect to login only after auth initialization completes', () => {
  assert.equal(
    shouldRedirectToLogin({ hasInitialized: false, isAuthenticated: false, loading: false }),
    false,
  );
  assert.equal(
    shouldRedirectToLogin({ hasInitialized: true, isAuthenticated: false, loading: false }),
    true,
  );
  assert.equal(
    shouldRedirectToLogin({ hasInitialized: true, isAuthenticated: true, loading: false }),
    false,
  );
});
