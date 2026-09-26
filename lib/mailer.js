const nodemailer = require('nodemailer');

/* ---------------------------------------------------------------------
   Sends the password-reset OTP by real email via SMTP. Configure with
   environment variables (e.g. in a .env file loaded by your process
   manager, or exported in the shell before `npm start`):

     SMTP_HOST=smtp.gmail.com
     SMTP_PORT=587
     SMTP_SECURE=false          // true for port 465, false for 587/25
     SMTP_USER=you@gmail.com
     SMTP_PASS=your-app-password   // NOT your normal login password
     EMAIL_FROM="CampusDesk <you@gmail.com>"

   Gmail specifically requires an "App Password" (Google Account →
   Security → 2-Step Verification → App passwords) — your regular
   password will be rejected. Any other SMTP provider (Outlook,
   Zoho, a college mail server, Resend, Mailgun, etc.) works the same
   way — just point SMTP_HOST/PORT at it.

  If these variables aren't set, no email is sent and no code is logged
  unless NODE_ENV=development and DEV_LOG_OTP=true are both explicitly
  configured. That opt-in fallback is for local development only.
--------------------------------------------------------------------- */

let cachedTransporter;
let warnedNoConfig = false;

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function isDevelopmentFallbackEnabled() {
  return process.env.NODE_ENV === 'development' && process.env.DEV_LOG_OTP === 'true';
}

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return cachedTransporter;
}

/**
 * Sends the OTP to the student's email. Returns { sent: boolean } —
 * the caller should NEVER put the OTP itself in an HTTP response;
 * this function is the only place the code is allowed to leave the
 * server process (via the outgoing email).
 */
async function sendOtpEmail({ to, name, otp }) {
  if (!isConfigured()) {
    if (!isDevelopmentFallbackEnabled()) {
      console.error('[mailer] SMTP is not configured; refusing to send or log a password-reset OTP.');
      return { sent: false, development: false };
    }
    if (!warnedNoConfig) {
      console.warn(
        '\n[mailer] SMTP_HOST/SMTP_USER/SMTP_PASS are not set — emails are not being sent.\n' +
        '[mailer] Falling back to logging the OTP here so you can still test locally.\n' +
        '[mailer] See lib/mailer.js for how to configure a real SMTP provider.\n'
      );
      warnedNoConfig = true;
    }
    console.log(`[mailer] (DEV FALLBACK — not emailed) OTP for ${to}: ${otp}`);
    return { sent: false, development: true };
  }

  try {
    await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to,
      subject: 'Your Complaint Box verification code',
      text:
        `Hi ${name || 'there'},\n\n` +
        `Your verification code is: ${otp}\n\n` +
        `This code expires in 10 minutes. If you didn't request a password reset, you can ignore this email.\n\n` +
        `— Complaint Box`,
      html:
        `<p>Hi ${escapeHtml(name || 'there')},</p>` +
        `<p>Your verification code is:</p>` +
        `<p style="font-size:28px;font-weight:700;letter-spacing:4px;font-family:monospace">${otp}</p>` +
        `<p>This code expires in 10 minutes. If you didn't request a password reset, you can ignore this email.</p>` +
        `<p>— Complaint Box</p>`
    });
    return { sent: true };
  } catch (err) {
    console.error('[mailer] Failed to send OTP email:', err.message);
    return { sent: false, error: err.message };
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

module.exports = { sendOtpEmail, isConfigured, isDevelopmentFallbackEnabled };
