# College Complaint Management System

Campus complaint tracking for students, department staff, and super administrators. It uses Express, MongoDB Atlas, session authentication, email OTP password resets, complaint routing, ML category prediction, and rule-based priority analysis.

## Requirements

- Node.js 20 or newer
- A MongoDB connection string
- A Resend API key and verified sender address, or SMTP credentials, for password-reset email outside explicit development mode

## Setup

1. Run `npm install`.
2. Create `.env` with `MONGODB_URI`, `SESSION_SECRET`, and `SUPERADMIN_KEY`; both secrets must be at least 32 characters.
3. For password-reset email, configure Resend with `RESEND_API_KEY` and `EMAIL_FROM` (a sender address on a verified Resend domain). If Resend is not configured, the app can use SMTP with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and optionally `EMAIL_FROM`. For local development without either provider, set both `NODE_ENV=development` and `DEV_LOG_OTP=true` to explicitly enable terminal-only OTP logging.
4. Run `npm start` and open `http://localhost:3000`.

The interface uses separate page URLs: `/` for the landing and student sign-in, `/student` for the student dashboard, `/staff` for department staff, and `/admin` for the super-admin area.

Complaint images are limited to PNG, JPEG, GIF, or WebP data under 4 MB.

## Optional FastAPI model service

The Node app can call a local FastAPI service for category predictions. The Python service loads the same trained category model from `lib/complaint-category-model.json`; no second training step or model copy is needed. Start it in another terminal:

```sh
python -m pip install -r requirements-fastapi.txt
python -m uvicorn ml_service.main:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/docs` to view the API. Express uses `http://127.0.0.1:8000` by default; set `ML_SERVICE_URL` if the service runs at another address. If FastAPI is unavailable or returns an invalid response, Express uses the existing JavaScript classifier. Keep the Python service bound to localhost; add service authentication before exposing it on a network.

Department staff can download an Excel workbook containing active complaints routed to their department. The super admin can download all active complaints. Exports include complaint and triage details, but omit image payloads and student contact details.

Deleting a complaint moves it to a Deleted view instead of removing it from the database. Students see their own deleted complaints, and department staff see deleted complaints assigned to their department.

## Complaint prediction models

Run `npm run train:model` to train category and priority multinomial Naive Bayes models from `data/student_complaints_training.csv`. The `category` and `severity` columns supply the labels; severity is used as the priority label. The script evaluates both models on validation and test splits, then saves them as `lib/complaint-category-model.json` and `lib/complaint-priority-model.json`. Rows marked `needs_review` are excluded, and duplicate groups must stay within one split. Accuracy, macro-F1, per-label scores, and confusion matrices are saved with each model; test metrics are printed by the command.

Safety terms still force Critical priority directly. Evaluation scores reflect the supplied dataset and do not establish performance on real-campus complaints; review predictions against staff-confirmed, de-identified complaints before operational use.

Complaint submission also has a server-side campus-relevance check. It rejects clear personal-advice requests and asks for campus details when a report is ambiguous; safety and student-conduct reports remain eligible. This prototype check uses rules rather than a trained relevance model, so review staff feedback for mistaken blocks and update its examples as needed.

## Tests

Run `npm test`. Dependencies must be installed first.

## Consolidated incidents

New reports are matched using rule-based NLP (equipment synonyms and text similarity), normalized location, the same department, and a ten-minute window from the first report. AC and Wi-Fi reports with equivalent wording share a persistent `INC-…` ID. Provide a location for reliable matching; unrecognized/missing locations remain separate. Historical complaints are not automatically backfilled.

Staff see one incident card with linked reports, while students retain their individual records. Twenty **distinct students** within the window automatically make the incident Critical with an immediate SLA deadline. Staff updates apply to every linked report and its history. This flags urgent work in the queue; it does not send email or dispatch maintenance automatically.

Incident writes use MongoDB transactions and require Atlas or a replica set (not a standalone MongoDB server).
