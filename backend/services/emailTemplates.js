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

const verificationEmail = (name, code) => ({
  subject: 'Your RsWork verification code',
  html: wrapper(
    `Welcome${name ? `, ${escapeHtml(name)}` : ''}!`,
    `<p>Enter this code in RsWork to verify your email address:</p>
     <p style="margin:20px 0;text-align:center;">
       <span style="display:inline-block;font-family:'SF Mono',Menlo,monospace;font-size:32px;font-weight:600;letter-spacing:8px;padding:14px 24px;background:#f4f7f9;border-radius:8px;color:#111;">${escapeHtml(code)}</span>
     </p>
     <p style="font-size:12px;color:#666;">This code expires in 15 minutes. If you didn't create an RsWork account, ignore this email.</p>`
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
