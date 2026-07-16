const test = require('node:test');
const assert = require('node:assert');
const { isSessionActive, isValidOrderSession } = require('../../utils/tableSession');

const NOW = Date.now();
const LIVE = { id: 'abc-123', expiresAt: new Date(NOW + 60_000) };
const EXPIRED = { id: 'abc-123', expiresAt: new Date(NOW - 1000) };

test('isSessionActive: live / expired / missing', () => {
  assert.equal(isSessionActive(LIVE, NOW), true);
  assert.equal(isSessionActive(EXPIRED, NOW), false);
  assert.equal(isSessionActive(undefined, NOW), false);
  assert.equal(isSessionActive({ id: undefined, expiresAt: undefined }, NOW), false);
});

test('isValidOrderSession: only the exact matching id is accepted', () => {
  assert.equal(isValidOrderSession(LIVE, 'abc-123', NOW), true);
  assert.equal(isValidOrderSession(LIVE, 'wrong-id', NOW), false);
  assert.equal(isValidOrderSession(LIVE, '', NOW), false);
  assert.equal(isValidOrderSession(LIVE, undefined, NOW), false);
});

test('isValidOrderSession: expired session rejects even the right id', () => {
  assert.equal(isValidOrderSession(EXPIRED, 'abc-123', NOW), false);
});

test('isValidOrderSession: cleared session (table released) rejects everything', () => {
  assert.equal(isValidOrderSession({ id: undefined, expiresAt: undefined }, 'abc-123', NOW), false);
});
