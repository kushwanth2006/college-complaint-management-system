# College Complaint Management System

Campus complaint tracking for students, department staff, and super administrators. It uses Express, MongoDB Atlas, session authentication, email OTP password resets, complaint routing, and rule-based complaint analysis.

## Requirements

- Node.js 20 or newer
- A MongoDB connection string
- SMTP credentials for real password-reset email

## Setup

1. Run `npm install`.
2. Create `.env` with `MONGODB_URI`, `SESSION_SECRET`, and `SUPERADMIN_KEY`.
3. For email resets, also set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and optionally `EMAIL_FROM`.
4. Run `npm start` and open `http://localhost:3000`.

Production startup requires non-default secrets. Complaint images are limited to PNG, JPEG, GIF, or WebP data under 4 MB.

## Tests

Run `npm test`. Dependencies must be installed first.
