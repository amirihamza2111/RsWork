// Minimal HTML email templates. User-provided values (name) are escaped to
// avoid injecting markup into the email.
const escapeHtml = (value) =>
  String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const wrapper = (title, bodyHtml) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#222;">
  <h2 style="margin:0 0 12px;">${title}</h2>
  ${bodyHtml}
  <p style="color:#888;font-size:12px;margin-top:24px;">RsWork · Nerovex</p>
</body></html>`;

const button = (url, label) =>
  `<p><a href="${url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;">${label}</a></p>
   <p style="font-size:12px;color:#666;">Or paste this link: ${url}</p>`;

const verificationEmail = (name, url) => ({
  subject: 'Verify your RsWork email',
  html: wrapper(
    `Welcome${name ? `, ${escapeHtml(name)}` : ''}!`,
    `<p>Please verify your email to finish setting up your RsWork account.</p>${button(url, 'Verify email')}<p style="font-size:12px;color:#666;">This link expires in 24 hours.</p>`
  ),
});

const passwordResetEmail = (name, url) => ({
  subject: 'Reset your RsWork password',
  html: wrapper(
    'Password reset',
    `<p>Hi${name ? ` ${escapeHtml(name)}` : ''}, we received a request to reset your password.</p>${button(url, 'Reset password')}<p style="font-size:12px;color:#666;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>`
  ),
});

module.exports = { verificationEmail, passwordResetEmail, escapeHtml };
