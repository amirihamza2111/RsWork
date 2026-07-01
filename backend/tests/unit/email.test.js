process.env.RESEND_API_KEY = ''; // force "not configured" for these tests

const test = require('node:test');
const assert = require('node:assert');
const { isConfigured, sendEmail, sendEmailSafe } = require('../../services/emailService');
const { verificationEmail, passwordResetEmail, escapeHtml } = require('../../services/emailTemplates');

test('emailService: not configured when no key is set', () => {
  assert.equal(isConfigured(), false);
});

test('sendEmail: skips (no throw, no network) when not configured', async () => {
  const result = await sendEmail({ to: 'a@a.com', subject: 'Hi', html: '<p>hi</p>' });
  assert.equal(result.skipped, true);
});

test('sendEmailSafe: never throws', async () => {
  const result = await sendEmailSafe({ to: 'a@a.com', subject: 'Hi', html: '<p>hi</p>' });
  assert.equal(result.skipped, true);
});

test('escapeHtml: escapes markup', () => {
  assert.equal(escapeHtml('<a>&"'), '&lt;a&gt;&amp;&quot;');
});

test('templates: escape the name and include the link', () => {
  const v = verificationEmail('<b>Eve</b>', 'https://app/verify?token=abc');
  assert.ok(!v.html.includes('<b>Eve</b>'));
  assert.ok(v.html.includes('&lt;b&gt;Eve'));
  assert.ok(v.html.includes('https://app/verify?token=abc'));

  const r = passwordResetEmail('Bob', 'https://app/reset?token=xyz');
  assert.ok(r.html.includes('https://app/reset?token=xyz'));
  assert.match(r.subject, /reset/i);
});
