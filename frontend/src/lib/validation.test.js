/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidEmailAddress } = require('./validation.js');

test('accepts short but valid email addresses', () => {
  assert.equal(isValidEmailAddress('a@b.co'), true);
  assert.equal(isValidEmailAddress('me@cv.io'), true);
});

test('rejects malformed email addresses', () => {
  assert.equal(isValidEmailAddress('not-an-email'), false);
  assert.equal(isValidEmailAddress('person@'), false);
  assert.equal(isValidEmailAddress('person @example.com'), false);
});
