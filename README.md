# College Complaint Management System

Campus complaint tracking for students, department staff, and super administrators. It uses Express, MongoDB Atlas, session authentication, email OTP password resets, complaint routing, and rule-based complaint analysis.

## Requirements

- Node.js 20 or newer
- A MongoDB connection string
- SMTP credentials for password-reset email outside explicit development mode

## Setup

1. Run `npm install`.
2. Create `.env` with `MONGODB_URI`, `SESSION_SECRET`, and `SUPERADMIN_KEY`; both secrets must be at least 32 characters.
3. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and optionally `EMAIL_FROM` for password-reset email. For local development without SMTP, set both `NODE_ENV=development` and `DEV_LOG_OTP=true` to explicitly enable terminal-only OTP logging. SMTP is required unless that development fallback is enabled.
4. Run `npm start` and open `http://localhost:3000`.

Complaint images are limited to PNG, JPEG, GIF, or WebP data under 4 MB.

Department staff can download an Excel workbook containing individual complaints routed to their department. The super admin can download all complaints. Exports include complaint and triage details, but omit image payloads and student contact details.

## Complaint prediction models

Run `npm run train:model` to preprocess the complaint text, train category and priority multinomial Naive Bayes models on the training split, evaluate both on validation and test splits, and save them as `lib/complaint-category-model.json` and `lib/complaint-priority-model.json`. Rows marked `needs_review` are excluded, and duplicate groups must stay within one split. Accuracy, macro-F1, per-label scores, and confusion matrices are saved with each model; test metrics are printed by the command.

The category labels are synthetic. The source data has no dependable priority labels, so preprocessing assigns priority labels using the app's existing safety and service-disruption rubric. The priority model therefore learns to approximate those weak labels, not historical staff decisions. Safety terms still force Critical priority directly. The dataset and both models are project prototypes; evaluate on real, staff-confirmed, de-identified complaints before operational use.

## Tests

Run `npm test`. Dependencies must be installed first.

## Consolidated incidents

New reports are matched using rule-based NLP (equipment synonyms and text similarity), normalized location, the same department, and a ten-minute window from the first report. AC and Wi-Fi reports with equivalent wording share a persistent `INC-…` ID. Provide a location for reliable matching; unrecognized/missing locations remain separate. Historical complaints are not automatically backfilled.

Staff see one incident card with linked reports, while students retain their individual records. Twenty **distinct students** within the window automatically make the incident Critical with an immediate SLA deadline. Staff updates apply to every linked report and its history. This flags urgent work in the queue; it does not send email or dispatch maintenance automatically.

Incident writes use MongoDB transactions and require Atlas or a replica set (not a standalone MongoDB server).
