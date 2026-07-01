const config = require('../config');

// Provider-agnostic transactional email. Implements Resend; skips gracefully
// (logs instead of sending) when no key is configured, so signup/reset flows
// keep working in dev/test.

const isConfigured = () => config.email.provider === 'resend' && Boolean(config.email.resendApiKey);

async function resendSend({ to, subject, html }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.email.timeoutMs);
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.email.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: config.email.from, to: [to], subject, html }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Resend ${resp.status}: ${detail.slice(0, 200)}`);
    }
    const data = await resp.json();
    return { id: data.id };
  } finally {
    clearTimeout(timer);
  }
}

async function sendEmail({ to, subject, html }) {
  if (!isConfigured()) {
    console.log(`[email] skipped (not configured) — "${subject}" -> ${to}`);
    return { skipped: true };
  }
  return resendSend({ to, subject, html });
}

// Never throws — safe for request handlers (email failure must not fail signup).
async function sendEmailSafe(opts) {
  try {
    return await sendEmail(opts);
  } catch (err) {
    console.error('[email] send failed:', err.message);
    return { error: err.message };
  }
}

module.exports = { isConfigured, sendEmail, sendEmailSafe };
