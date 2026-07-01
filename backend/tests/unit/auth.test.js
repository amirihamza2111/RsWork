const test = require('node:test');
const assert = require('node:assert');
const User = require('../../models/User');

test('createPasswordResetToken: returns a raw token but stores only its hash', () => {
  const user = new User({ name: 'X', email: 'x@x.com', password: 'secret1' });
  const raw = user.createPasswordResetToken();

  assert.equal(typeof raw, 'string');
  assert.ok(raw.length >= 32);
  // Stored value is the SHA-256 hash, never the raw token.
  assert.equal(user.resetPasswordToken, User.hashResetToken(raw));
  assert.notEqual(user.resetPasswordToken, raw);
});

test('createPasswordResetToken: sets an expiry in the future', () => {
  const user = new User({ name: 'X', email: 'x@x.com', password: 'secret1' });
  user.createPasswordResetToken();
  assert.ok(new Date(user.resetPasswordExpires).getTime() > Date.now());
});

test('hashResetToken: is deterministic and collision-distinct', () => {
  assert.equal(User.hashResetToken('abc'), User.hashResetToken('abc'));
  assert.notEqual(User.hashResetToken('abc'), User.hashResetToken('abd'));
});

test('createEmailVerificationToken: stores hash + 24h expiry, returns raw', () => {
  const user = new User({ name: 'X', email: 'x@x.com', password: 'secret1' });
  const raw = user.createEmailVerificationToken();
  assert.equal(typeof raw, 'string');
  assert.ok(raw.length >= 32);
  assert.equal(user.emailVerificationToken, User.hashResetToken(raw));
  assert.ok(new Date(user.emailVerificationExpires).getTime() > Date.now());
});
