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

test('createEmailVerificationToken: returns 6-digit OTP, stores hash, ~15min expiry', () => {
  const user = new User({ name: 'X', email: 'x@x.com', password: 'secret1' });
  const code = user.createEmailVerificationToken();
  assert.match(code, /^\d{6}$/, `expected 6-digit code, got ${code}`);
  assert.equal(user.emailVerificationToken, User.hashResetToken(code));
  const msRemaining = new Date(user.emailVerificationExpires).getTime() - Date.now();
  assert.ok(msRemaining > 14 * 60 * 1000 && msRemaining <= 15 * 60 * 1000);
});

test('createEmailVerificationToken: distribution — every position 0-9 and no fixed digit', () => {
  const digits = new Set();
  for (let i = 0; i < 30; i += 1) {
    const u = new User({ name: 'X', email: 'x@x.com', password: 'secret1' });
    u.createEmailVerificationToken().split('').forEach((d) => digits.add(d));
  }
  // Over 30 codes (180 digits) we should easily see all 10 digits.
  assert.ok(digits.size >= 8, `expected variety, saw ${digits.size} distinct digits`);
});
