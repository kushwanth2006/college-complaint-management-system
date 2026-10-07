const nodemailer = require('nodemailer');

/* ---------------------------------------------------------------------
   Sends password-reset OTPs with Resend when configured, otherwise SMTP.
   Configure with environment variables (e.g. in a .env file loaded by
   your process manager, or exported in the shell before `npm start`):

     RESEND_API_KEY=re_xxxxxxxxx
     EMAIL_FROM="CampusDesk <otp@your-verified-domain.example>"

   Resend is preferred when both providers are configured. EMAIL_FROM must
   use a sender domain verified in Resend.

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
  return isResendConfigured() || isSmtpConfigured();
}

function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function isSmtpConfigured() {
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
      console.error('[mailer] No email provider is configured; refusing to send or log a password-reset OTP.');
      return { sent: false, development: false };
    }
    if (!warnedNoConfig) {
      console.warn(
        '\n[mailer] Resend and SMTP are not configured — emails are not being sent.\n' +
        '[mailer] Falling back to logging the OTP here so you can still test locally.\n' +
        '[mailer] See README.md for email provider setup.\n'
      );
      warnedNoConfig = true;
    }
    console.log(`[mailer] (DEV FALLBACK — not emailed) OTP for ${to}: ${otp}`);
    return { sent: false, development: true };
  }

  try {
    const message = {
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
    };

    if (isResendConfigured()) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ...message, to: [to] })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const reason = result.message || result.error || `HTTP ${response.status}`;
        throw new Error(`Resend API request failed: ${reason}`);
      }
      return { sent: true, provider: 'resend', id: result.id };
    }

    await getTransporter().sendMail(message);
    return { sent: true, provider: 'smtp' };
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
