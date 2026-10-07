const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { db, initDb } = require('./db/database');
const { sendOtpEmail, isConfigured: isMailerConfigured, isDevelopmentFallbackEnabled } = require('./lib/mailer');
const { analyzeComplaint, similarity } = require('./lib/complaint-ai');
const { checkComplaintRelevance } = require('./lib/complaint-relevance');

const app = express();
const PORT = process.env.PORT || 3000;

const isProduction = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET;
const SUPERADMIN_KEY = process.env.SUPERADMIN_KEY;
if (!SESSION_SECRET || SESSION_SECRET.length < 32 || !SUPERADMIN_KEY || SUPERADMIN_KEY.length < 32) {
  throw new Error('SESSION_SECRET and SUPERADMIN_KEY must each be set to at least 32 characters.');
}
if (!isMailerConfigured() && !isDevelopmentFallbackEnabled()) {
  throw new Error('SMTP_HOST, SMTP_USER, and SMTP_PASS must be set unless the development OTP fallback is explicitly enabled.');
}
const MIN_PASSWORD_LENGTH = 8;
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000';

// Photos are sent as base64 data URLs in the JSON body, so the default
// ~100kb express.json() limit is too small — bump it.
app.use(express.json({ limit: '5mb' }));

app.use(session({
  secret: SESSION_SECRET,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI, dbName: process.env.MONGODB_DB || 'college_complaints', collectionName: 'sessions' }),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 8 // 8 hour session
  }
}));

if (isProduction) app.set('trust proxy', 1);

// Reject cross-site state-changing API requests. Same-origin browser requests
// and non-browser clients without Origin/Referer continue to work.
app.use('/api', (req, res, next) => {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();
  const source = req.get('origin') || req.get('referer');
  if (!source) return next();
  try {
    if (new URL(source).host !== req.get('host')) return res.status(403).json({ error: 'Cross-site request rejected.' });
  } catch { return res.status(403).json({ error: 'Invalid request origin.' }); }
  next();
});

const rateBuckets = new Map();
function rateLimit(name, max, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`; const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    else if (++bucket.count > max) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    next();
  };
}
const authLimit = rateLimit('auth', 10, 15 * 60 * 1000);
const otpLimit = rateLimit('otp', 5, 15 * 60 * 1000);
const analysisLimit = rateLimit('analysis', 20, 15 * 60 * 1000);

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function requestedPage(req, defaultPageSize = 50) {
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || defaultPageSize);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) return null;
  return { page, pageSize };
}

function pageInfo(page, pageSize, total) {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Browsers auto-request this; there's no favicon asset yet, so just
// answer quietly instead of letting it 404 in the console.
app.get('/favicon.ico', async (req, res) => res.status(204).end());

app.get('/', async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

for (const [route, page] of Object.entries({
  '/student': 'student.html',
  '/staff': 'staff.html',
  '/admin': 'admin.html'
})) {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, 'public', page)));
}

/* ---------------- constants (kept in sync with Script.js) ---------------- */

const CATEGORIES = ['Hostel', 'Mess', 'Academic', 'Wi-Fi & Network', 'Transport', 'Library', 'General'];
const HOSTELS = ['Leaders', 'Kings', 'Queens', 'B3', 'IGH', 'VVH'];
const RESIDENCES = [...HOSTELS, 'Day Scholar'];
const STAGES = ['Submitted', 'Assigned', 'In Progress', 'Resolved', 'Closed'];

const OTP_TTL_MS = 10 * 60 * 1000;   // 10 minutes
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
const SLA_HOURS = { Critical: 2, High: 8, Medium: 24, Low: 72 };

async function predictCategoryWithFastApi(text) {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/predict-category`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) return null;
    const prediction = await response.json();
    if (!CATEGORIES.includes(prediction.category) || !Number.isFinite(prediction.confidence) || prediction.confidence < 0 || prediction.confidence > 100) return null;
    return { category: prediction.category, confidence: prediction.confidence };
  } catch {
    return null;
  }
}

/* ---------------- helpers ---------------- */

async function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.session.userId);
  if (!user || (req.session.authVersion ?? 0) !== (user.auth_version || 0)) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Session invalid. Please log in again.' });
  }
  next();
}

function publicUser(u) {
  return { id: u.id, name: u.name, collegeId: u.college_id, hostel: u.hostel, email: u.email };
}

function isValidCollegeId(id) {
  return /^VTU\d{5}$/i.test(id);
}

/* Department staff use a separate TTS-prefixed College ID — never VTU. */
function isValidStaffCollegeId(id) {
  return /^TTS\d{5}$/i.test(id);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function genComplaintCode() {
  for (let i = 0; i < 20; i++) {
    const code = 'CDT-' + crypto.randomInt(100000, 1000000);
    const exists = await db.get('SELECT id FROM complaints WHERE complaint_code = ?', code);
    if (!exists) return code;
  }
  return 'CDT-' + Date.now().toString().slice(-6); // astronomically unlikely fallback
}

// Routing must always reflect the staff accounts currently approved for a
// department. It deliberately does not use a static name, so reassigning or
// approving staff in the super-admin panel takes effect on existing cards too.
async function getRoutingDetails(department) {
  const handlers = (await db.all(
    "SELECT name FROM admins WHERE department = ? AND status = 'approved' AND TRIM(name) <> '' ORDER BY id ASC",
    department
  )).map(admin => admin.name.trim());

  if (handlers.length) {
    const handlerNames = handlers.join(', ');
    return {
      officer: handlerNames,
      note: `Logged and routed to ${handlerNames}, ${department} department.`
    };
  }

  return {
    officer: `${department} department`,
    note: `The complaint is routed to the respective ${department} department.`
  };
}

function publicAdmin(a) {
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    collegeId: a.college_id,
    department: a.department,
    requestedDepartment: a.requested_department,
    status: a.status
  };
}

async function requireAdminAuth(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  const admin = await db.get('SELECT * FROM admins WHERE id = ?', req.session.adminId);
  if (!admin || admin.status !== 'approved' || (req.session.authVersion ?? 0) !== (admin.auth_version || 0)) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Admin session invalid.' });
  }
  req.admin = admin;
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.session.isSuperAdmin) {
    return res.status(401).json({ error: 'Not logged in as super admin.' });
  }
  next();
}

async function publicComplaint(c, suppliedRouting, { includeSensitive = false } = {}) {
  const routing = suppliedRouting || await getRoutingDetails(c.category);
  return {
    id: c.complaint_code,
    category: c.category,
    title: c.title,
    description: c.description,
    // Resolve this at read time so the card always shows the currently
    // assigned department handler rather than the name stored at creation.
    officer: routing.officer,
    stageIndex: c.stage_index,
    // Preserve staff progress updates, but keep submitted/routed complaints
    // in sync with the current department handler and the no-handler fallback.
    note: c.stage_index <= 1 ? routing.note : c.note,
    createdAt: c.created_at,
    studentName: c.student_name || null,
    studentCollegeId: c.student_college_id || null,
    ...(includeSensitive ? {
      photo: c.photo || null,
      studentEmail: c.student_email || null,
      studentHostel: c.student_hostel || null
    } : {}),
    aiCategory: c.ai_category || null,
    aiConfidence: c.ai_confidence || null,
    aiPriority: c.ai_priority || null,
    aiPriorityReason: c.ai_priority_reason || null,
    aiSummary: c.ai_summary || null,
    incident: c.incident_code ? { id: c.incident_code, title: c.incident_title, affectedStudents: c.incident_affected, reportCount: c.incident_reports, urgent: c.incident_urgent } : null,
    possibleDuplicate: c.possible_duplicate ? { similarity: c.possible_duplicate.similarity } : null
    , location: c.location || null
    , aiKeywords: c.ai_keywords || []
    , aiDetectedLocation: c.ai_detected_location || null
    , aiSuggestedResolution: c.ai_suggested_resolution || []
    , slaDeadline: c.sla_deadline || null
    , overdue: c.sla_deadline ? Date.now() > new Date(c.sla_deadline).getTime() && c.stage_index < 3 : false
    , deletedAt: c.deleted_at || null
    , deletedByRole: c.deleted_by_role || null
    , feedback: c.feedback || null
    , studentUpdates: c.student_updates || []
  };
}

async function publicComplaints(rows, options = {}) {
  const routing = new Map();
  await Promise.all([...new Set(rows.map(row => row.category))].map(async category => routing.set(category, await getRoutingDetails(category))));
  return Promise.all(rows.map(row => publicComplaint(row, routing.get(row.category), options)));
}

async function departmentComplaintRows(department) {
  return db.all(`
    SELECT c.*, u.name as student_name, u.college_id as student_college_id, u.email as student_email, u.hostel as student_hostel
    FROM complaints c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.category = ?
    ORDER BY c.id DESC
  `, department);
}

async function allComplaintRows() {
  return db.all(`
    SELECT c.*, u.name as student_name, u.college_id as student_college_id, u.email as student_email, u.hostel as student_hostel
    FROM complaints c
    LEFT JOIN users u ON c.user_id = u.id
    ORDER BY c.id DESC
  `);
}

async function sendComplaintWorkbook(res, rows, scope) {
  try {
    const complaints = await publicComplaints(rows);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CampusDesk';
    workbook.created = new Date();
    workbook.subject = 'Complaint export';
    workbook.title = 'CampusDesk complaints';

    const worksheet = workbook.addWorksheet('Complaints', { views: [{ state: 'frozen', ySplit: 1 }] });
    worksheet.columns = [
      { header: 'Complaint ID', key: 'id', width: 18 },
      { header: 'Department', key: 'category', width: 22 },
      { header: 'Title', key: 'title', width: 34 },
      { header: 'Description', key: 'description', width: 60 },
      { header: 'Location', key: 'location', width: 24 },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Priority', key: 'priority', width: 14 },
      { header: 'Priority reason', key: 'priorityReason', width: 42 },
      { header: 'Assigned staff', key: 'officer', width: 24 },
      { header: 'Submitted at', key: 'createdAt', width: 22, style: { numFmt: 'dd mmm yyyy hh:mm' } },
      { header: 'SLA deadline', key: 'slaDeadline', width: 22, style: { numFmt: 'dd mmm yyyy hh:mm' } },
      { header: 'SLA overdue', key: 'overdue', width: 14 },
      { header: 'Progress note', key: 'note', width: 42 },
      { header: 'Incident ID', key: 'incidentId', width: 18 },
      { header: 'Incident reports', key: 'incidentReports', width: 16 },
      { header: 'Affected students', key: 'affectedStudents', width: 18 },
      { header: 'Urgent incident', key: 'urgentIncident', width: 16 },
      { header: 'AI category', key: 'aiCategory', width: 22 },
      { header: 'AI confidence (%)', key: 'aiConfidence', width: 18 },
      { header: 'AI summary', key: 'aiSummary', width: 42 },
      { header: 'AI keywords', key: 'aiKeywords', width: 30 },
      { header: 'Suggested resolution', key: 'aiSuggestedResolution', width: 48 },
      { header: 'Possible duplicate (%)', key: 'duplicateSimilarity', width: 22 },
      { header: 'Feedback rating', key: 'feedbackRating', width: 16 },
      { header: 'Feedback comments', key: 'feedbackComments', width: 42 }
    ];

    worksheet.getRow(1).height = 26;
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FF1C2541' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3EEE0' } };
    worksheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
    worksheet.autoFilter = { from: 'A1', to: `${worksheet.getColumn(worksheet.columnCount).letter}1` };
    for (const key of ['description', 'priorityReason', 'note', 'aiSummary', 'aiSuggestedResolution', 'feedbackComments']) {
      worksheet.getColumn(key).alignment = { vertical: 'top', wrapText: true };
    }

    for (const complaint of complaints) {
      worksheet.addRow({
        id: complaint.id,
        category: complaint.category,
        title: complaint.title,
        description: complaint.description,
        location: complaint.location,
        status: STAGES[complaint.stageIndex] || 'Unknown',
        priority: complaint.aiPriority,
        priorityReason: complaint.aiPriorityReason,
        officer: complaint.officer,
        createdAt: complaint.createdAt ? new Date(complaint.createdAt) : null,
        slaDeadline: complaint.slaDeadline ? new Date(complaint.slaDeadline) : null,
        overdue: complaint.overdue ? 'Yes' : 'No',
        note: complaint.note,
        incidentId: complaint.incident?.id,
        incidentReports: complaint.incident?.reportCount,
        affectedStudents: complaint.incident?.affectedStudents,
        urgentIncident: complaint.incident?.urgent ? 'Yes' : 'No',
        aiCategory: complaint.aiCategory,
        aiConfidence: complaint.aiConfidence,
        aiSummary: complaint.aiSummary,
        aiKeywords: Array.isArray(complaint.aiKeywords) ? complaint.aiKeywords.join(', ') : '',
        aiSuggestedResolution: Array.isArray(complaint.aiSuggestedResolution) ? complaint.aiSuggestedResolution.join('\n') : '',
        duplicateSimilarity: complaint.possibleDuplicate?.similarity,
        feedbackRating: complaint.feedback?.rating,
        feedbackComments: complaint.feedback?.comments
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const date = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="campusdesk-${scope}-complaints-${date}.xlsx"`,
      'Cache-Control': 'no-store'
    });
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Complaint workbook export failed:', error);
    res.status(500).json({ error: 'Could not create the complaint workbook.' });
  }
}

function cleanRequired(value, maxLength = 5000) {
  const clean = String(value ?? '').trim();
  return clean && clean.length <= maxLength ? clean : null;
}

function validPhoto(value) {
  if (value == null || value === '') return true;
  if (typeof value !== 'string' || !/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return false;
  return Buffer.byteLength(value, 'utf8') <= 4 * 1024 * 1024;
}

/* ---------------- auth routes ---------------- */

app.post('/api/register', authLimit, async (req, res) => {
  const { name, email, collegeId, studentType, hostel: requestedHostel, password } = req.body || {};

  if (!name || !email || !collegeId || !studentType || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const cleanId = String(collegeId).trim().toUpperCase();
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanName = cleanRequired(name, 100);
  const hostel = studentType === 'dayscholar' ? 'Day Scholar' : requestedHostel;

  if (!isValidCollegeId(cleanId)) {
    return res.status(400).json({ error: 'College ID must be VTU followed by exactly five digits (e.g. VTU28243).' });
  }
  if (cleanEmail !== `${cleanId.toLowerCase()}@veltech.edu.in`) {
    return res.status(400).json({ error: 'Email must match your College ID and end with @veltech.edu.in.' });
  }
  if (!cleanName) return res.status(400).json({ error: 'Enter a valid name.' });
  if (String(password).length < MIN_PASSWORD_LENGTH) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  if (!['dayscholar', 'hostel'].includes(studentType)) {
    return res.status(400).json({ error: 'Choose Day scholar or Hostel.' });
  }
  if (studentType === 'hostel' && !HOSTELS.includes(hostel)) {
    return res.status(400).json({ error: 'Please select a hostel from the list.' });
  }

  const existing = await db.get('SELECT id FROM users WHERE college_id = ?', cleanId);
  if (existing) {
    return res.status(409).json({ error: 'An account with that College ID already exists — please log in instead.' });
  }
  const existingEmail = await db.get('SELECT id FROM users WHERE email = ?', cleanEmail);
  if (existingEmail) return res.status(409).json({ error: 'An account with that email already exists.' });

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = await db.run(
    'INSERT INTO users (college_id, name, email, hostel, password_hash) VALUES (?, ?, ?, ?, ?) RETURNING id'
  , cleanId, cleanName, cleanEmail, hostel, passwordHash);

  const user = await db.get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid);

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start a session.' });
    req.session.userId = user.id;
    req.session.authVersion = user.auth_version || 0;
    res.status(201).json({ user: publicUser(user) });
  });
});

app.post('/api/login', authLimit, async (req, res) => {
  const { collegeId, password } = req.body || {};
  if (!collegeId || !password) {
    return res.status(400).json({ error: 'College ID and password are required.' });
  }

  const user = await db.get('SELECT * FROM users WHERE college_id = ?', String(collegeId).trim().toUpperCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid College ID or password.' });
  }
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({
      code: 'WRONG_PASSWORD',
      error: 'Invalid College ID or password.'
    });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start a session.' });
    req.session.userId = user.id;
    req.session.authVersion = user.auth_version || 0;
    res.json({ user: publicUser(user) });
  });
});

app.post('/api/logout', async (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Not gated by requireAuth on purpose: the frontend calls this on every
// page load just to check "is there a valid session?" — that's a normal
// query, not an authorization failure, so it always answers 200. Actions
// that actually require login (PATCH /api/me, /api/complaints, etc.) still
// go through requireAuth and correctly 401 when there's no session.
app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.session.userId);
  if (!user || (req.session.authVersion ?? 0) !== (user.auth_version || 0)) {
    req.session.destroy(() => {});
    return res.json({ user: null });
  }
  res.json({ user: publicUser(user) });
});

app.get('/api/session', async (req, res) => {
  if (req.session.userId) {
    const user = await db.get('SELECT * FROM users WHERE id = ?', req.session.userId);
    if (!user || (req.session.authVersion ?? 0) !== (user.auth_version || 0)) {
      req.session.destroy(() => {});
      return res.json({ user: null, admin: null });
    }
    return res.json({ user: publicUser(user), admin: null });
  }

  if (req.session.adminId) {
    const admin = await db.get('SELECT * FROM admins WHERE id = ?', req.session.adminId);
    if (!admin || admin.status !== 'approved' || (req.session.authVersion ?? 0) !== (admin.auth_version || 0)) {
      req.session.destroy(() => {});
      return res.json({ user: null, admin: null });
    }
    return res.json({ user: null, admin: publicAdmin(admin) });
  }

  res.json({ user: null, admin: null });
});

app.patch('/api/me', requireAuth, async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.session.userId);
  if (!user) return res.status(401).json({ error: 'Session invalid.' });

  const { name, hostel, password } = req.body || {};
  const cleanName = cleanRequired(name, 100);
  if (!cleanName || !hostel) {
    return res.status(400).json({ error: "Name and residence can't be empty." });
  }
  if (!RESIDENCES.includes(hostel)) {
    return res.status(400).json({ error: 'Please select a valid residence.' });
  }
  if (password && String(password).length < MIN_PASSWORD_LENGTH) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });

  if (password) {
    const passwordHash = bcrypt.hashSync(password, 10);
    await db.run('UPDATE users SET name = ?, hostel = ?, password_hash = ?, auth_version = auth_version + 1 WHERE id = ?', cleanName, hostel, passwordHash, user.id);
    req.session.authVersion = (user.auth_version || 0) + 1;
  } else {
    await db.run('UPDATE users SET name = ?, hostel = ? WHERE id = ?', cleanName, hostel, user.id);
  }

  const updated = await db.get('SELECT * FROM users WHERE id = ?', user.id);
  res.json({ user: publicUser(updated) });
});

/* ---------------- forgot password (OTP over real email) ----------------
   The OTP is generated here, stored (hashed match against the plain value
   is fine since it's single-use + short-lived), and emailed via
   lib/mailer.js. It is NEVER included in the HTTP response — see the
   MAX_OTP_ATTEMPTS check in /verify below for the brute-force guard. */

const MAX_OTP_ATTEMPTS = 5;

app.post('/api/forgot', otpLimit, asyncRoute(async (req, res) => {
  const { collegeId } = req.body || {};
  if (!collegeId) return res.status(400).json({ error: 'College ID is required.' });

  const user = await db.get('SELECT * FROM users WHERE college_id = ?', String(collegeId).trim().toUpperCase());
  const emailConfigured = isMailerConfigured();
  if (!user) return res.json({ ok: true, emailConfigured });

  const otp = String(crypto.randomInt(100000, 1000000));
  const mailResult = await sendOtpEmail({ to: user.email, name: user.name, otp });
  if (!mailResult.sent && !mailResult.development) return res.json({ ok: true, emailConfigured });

  // Invalidate earlier unused codes only after the replacement was delivered.
  await db.run('DELETE FROM password_resets WHERE user_id = ? AND otp_used = 0', user.id);
  await db.run(
    'INSERT INTO password_resets (user_id, otp, otp_expires_at) VALUES (?, ?, ?)'
  , user.id, bcrypt.hashSync(otp, 10), Date.now() + OTP_TTL_MS);

  res.json({ ok: true, emailConfigured });
}));

app.post('/api/forgot/verify', authLimit, async (req, res) => {
  const { collegeId, otp } = req.body || {};
  if (!collegeId || !otp) return res.status(400).json({ error: 'College ID and code are required.' });

  const user = await db.get('SELECT * FROM users WHERE college_id = ?', String(collegeId).trim().toUpperCase());
  if (!user) return res.status(400).json({ error: 'That code is invalid or expired.' });

  const row = await db.get(
    'SELECT * FROM password_resets WHERE user_id = ? AND otp_used = 0 ORDER BY id DESC LIMIT 1'
  , user.id);

  if (!row || row.otp_expires_at < Date.now() || row.attempts >= MAX_OTP_ATTEMPTS) {
    return res.status(400).json({ error: 'That code is invalid or expired.' });
  }

  if (!bcrypt.compareSync(String(otp).trim(), row.otp)) {
    await db.run('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', row.id);
    return res.status(400).json({ error: 'That code is invalid or expired.' });
  }

  const resetToken = crypto.randomBytes(24).toString('hex');
  await db.run(
    'UPDATE password_resets SET otp_used = 1, reset_token = ?, token_expires_at = ? WHERE id = ?'
  , resetToken, Date.now() + RESET_TOKEN_TTL_MS, row.id);

  res.json({ ok: true, resetToken });
});

app.post('/api/reset-password', async (req, res) => {
  const { collegeId, resetToken, newPassword } = req.body || {};
  if (!collegeId || !resetToken || !newPassword) {
    return res.status(400).json({ error: 'Missing fields.' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }

  const user = await db.get('SELECT * FROM users WHERE college_id = ?', String(collegeId).trim().toUpperCase());
  if (!user) return res.status(400).json({ error: 'The reset request is invalid or expired.' });

  const row = await db.get(
    'SELECT * FROM password_resets WHERE user_id = ? AND reset_token = ? ORDER BY id DESC LIMIT 1'
  , user.id, resetToken);

  if (!row || !row.token_expires_at || row.token_expires_at < Date.now()) {
    return res.status(400).json({ error: 'The reset request is invalid or expired.' });
  }

  const passwordHash = bcrypt.hashSync(newPassword, 10);
  await db.run('UPDATE users SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ?', passwordHash, user.id);
  await db.run('DELETE FROM password_resets WHERE user_id = ?', user.id);

  res.json({ ok: true });
});

/* ---------------- complaint routes (always scoped to req.session.userId) ---------------- */

app.get('/api/complaints', requireAuth, async (req, res) => {
  const rows = await db.all(
    'SELECT * FROM complaints WHERE user_id = ? ORDER BY id DESC'
  , req.session.userId);

  res.json({ complaints: await publicComplaints(rows) });
});

app.get('/api/complaints/deleted', requireAuth, async (req, res) => {
  const rows = await db.deletedComplaintRows({ userId: req.session.userId });
  res.json({ complaints: await publicComplaints(rows) });
});

app.post('/api/complaints/analyze', requireAuth, analysisLimit, async (req, res) => {
  const { title, description, location } = req.body || {};
  const cleanTitle = cleanRequired(title, 200);
  const cleanDescription = cleanRequired(description, 5000);
  if (!cleanTitle || !cleanDescription) return res.status(400).json({ error: 'Add a subject and description within the allowed length.' });
  const relevance = checkComplaintRelevance({ title: cleanTitle, description: cleanDescription, location });
  if (!relevance.allowed) return res.status(422).json({ error: relevance.message, code: relevance.code });
  const complaints = await db.recentOpenComplaints(500);
  const categoryPrediction = await predictCategoryWithFastApi(`${cleanTitle} ${cleanDescription}`);
  const analysis = analyzeComplaint({ title: cleanTitle, description: cleanDescription, complaints, categoryPrediction });
  if (analysis.duplicate) analysis.duplicate = { similarity: analysis.duplicate.similarity };
  res.json({ analysis });
});

app.post('/api/complaints', requireAuth, async (req, res) => {
  const { category, title, description, location, photo } = req.body || {};

  const cleanTitle = cleanRequired(title, 200); const cleanDescription = cleanRequired(description, 5000);
  if (!cleanTitle || !cleanDescription || !category) {
    return res.status(400).json({ error: 'Category, subject, and details are all required.' });
  }
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Unrecognized category.' });
  }
  if (!validPhoto(photo)) return res.status(400).json({ error: 'Photo must be a PNG, JPEG, GIF, or WebP image under 4 MB.' });
  const relevance = checkComplaintRelevance({ title: cleanTitle, description: cleanDescription, location });
  if (!relevance.allowed) return res.status(422).json({ error: relevance.message, code: relevance.code });

  const [code, routing, complaints, categoryPrediction] = await Promise.all([
    genComplaintCode(),
    getRoutingDetails(category),
    db.recentOpenComplaints(500),
    predictCategoryWithFastApi(`${cleanTitle} ${cleanDescription}`)
  ]);
  const analysis = analyzeComplaint({ title: cleanTitle, description: cleanDescription, complaints, categoryPrediction });
  const slaDeadline = new Date(Date.now() + SLA_HOURS[analysis.priority] * 60 * 60 * 1000);

  const info = await db.run(
    `INSERT INTO complaints (complaint_code, user_id, category, title, description, location, officer, stage_index, note, photo, ai_category, ai_confidence, ai_priority, ai_priority_reason, ai_summary, ai_keywords, ai_detected_location, ai_suggested_resolution, possible_duplicate, sla_deadline)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  , code, req.session.userId, category, cleanTitle, cleanDescription, String(location || '').trim().slice(0, 200) || analysis.entities.location,
    routing.officer, routing.note, photo || null, analysis.category, analysis.confidence, analysis.priority, analysis.reason, analysis.summary,
    analysis.entities.keywords, analysis.entities.location, analysis.suggestedResolution, analysis.duplicate, slaDeadline);

  res.status(201).json({ complaint: await publicComplaint(info.row, routing) });
});

app.get('/api/complaints/:code/history', requireAuth, async (req, res) => {
  const complaint = await db.get('SELECT * FROM complaints WHERE complaint_code = ?', req.params.code);
  if (!complaint || complaint.user_id !== req.session.userId) return res.status(404).json({ error: 'Complaint not found.' });
  const history = await db.all('SELECT * FROM complaint_history WHERE complaint_id = ? ORDER BY id DESC', complaint.id);
  res.json({ history });
});

app.post('/api/complaints/:code/information', requireAuth, async (req, res) => {
  const complaint = await db.get('SELECT * FROM complaints WHERE complaint_code = ?', req.params.code);
  const message = String(req.body?.message || '').trim();
  if (!complaint || complaint.user_id !== req.session.userId) return res.status(404).json({ error: 'Complaint not found.' });
  if (!message) return res.status(400).json({ error: 'Additional information is required.' });
  const updates = [...(complaint.student_updates || []), { message, createdAt: new Date() }];
  await db.run('UPDATE complaints SET student_updates = ? WHERE id = ?', updates, complaint.id);
  await db.run('INSERT INTO complaint_history (complaint_id, previous_status, new_status, updated_by, remarks) VALUES (?, ?, ?, ?, ?)', complaint.id, null, null, req.session.userId, `Student added information: ${message}`);
  res.json({ ok: true });
});

app.post('/api/complaints/:code/feedback', requireAuth, async (req, res) => {
  const complaint = await db.get('SELECT * FROM complaints WHERE complaint_code = ?', req.params.code);
  const rating = Number(req.body?.rating); const comments = String(req.body?.comments || '').trim();
  if (!complaint || complaint.user_id !== req.session.userId) return res.status(404).json({ error: 'Complaint not found.' });
  if (complaint.stage_index < 3) return res.status(400).json({ error: 'Feedback is available after resolution.' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
  if (await db.get('SELECT * FROM feedback WHERE complaint_id = ?', complaint.id)) return res.status(409).json({ error: 'Feedback already submitted.' });
  await db.run('INSERT INTO feedback (complaint_id, user_id, rating, comments) VALUES (?, ?, ?, ?)', complaint.id, req.session.userId, rating, comments);
  await db.run('UPDATE complaints SET feedback = ?, stage_index = ? WHERE id = ?', { rating, comments }, 4, complaint.id);
  await db.run('INSERT INTO complaint_history (complaint_id, previous_status, new_status, updated_by, remarks) VALUES (?, ?, ?, ?, ?)', complaint.id, 'Resolved', 'Closed', req.session.userId, 'Student submitted feedback and closed the complaint.');
  res.json({ ok: true });
});

app.delete('/api/complaints/:code', requireAuth, async (req, res) => {
  const deleted = await db.softDeleteComplaint({ complaintCode: req.params.code, userId: req.session.userId,
    deletedByRole: 'student', deletedById: req.session.userId });
  if (!deleted) return res.status(404).json({ error: 'Complaint not found.' });
  res.json({ ok: true });
});

/* ---------------- admin auth routes (department staff) ----------------
   Registration never logs the account in — it always lands in 'pending'
   with no department, and only /api/superadmin/admins/:id can approve it
   and assign a department. */

app.post('/api/admin/register', authLimit, async (req, res) => {
  const { name, email, collegeId, password, requestedDepartment } = req.body || {};

  if (!name || !email || !collegeId || !password || !requestedDepartment) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanName = cleanRequired(name, 100);
  const cleanId = String(collegeId).trim().toUpperCase();

  if (!isValidStaffCollegeId(cleanId)) {
    if (cleanId.startsWith('VTU')) {
      return res.status(400).json({ error: "That's a student ID. Staff must register with a TTS College ID, e.g. TTS12345." });
    }
    return res.status(400).json({ error: 'College ID must be TTS followed by exactly five digits (e.g. TTS12345).' });
  }
  if (cleanEmail !== `${cleanId.toLowerCase()}@veltech.edu.in`) {
    return res.status(400).json({ error: 'Email must match the staff ID and end with @veltech.edu.in.' });
  }
  if (!cleanName) return res.status(400).json({ error: 'Enter a valid name.' });
  if (String(password).length < MIN_PASSWORD_LENGTH) return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  if (!CATEGORIES.includes(requestedDepartment)) {
    return res.status(400).json({ error: 'Please select a department from the list.' });
  }

  const existingEmail = await db.get('SELECT id FROM admins WHERE email = ?', cleanEmail);
  if (existingEmail) {
    return res.status(409).json({ error: 'An account with that email is already registered.' });
  }
  const existingId = await db.get('SELECT id FROM admins WHERE college_id = ?', cleanId);
  if (existingId) {
    return res.status(409).json({ error: 'An account with that College ID is already registered.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  await db.run(
    // Keep the requested department in `department` until approval as well.
    // This remains compatible with older databases where that column is NOT NULL;
    // `status` still prevents the account from receiving complaints or logging in.
    'INSERT INTO admins (name, email, college_id, password_hash, requested_department, department, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  , cleanName, cleanEmail, cleanId, passwordHash, requestedDepartment, requestedDepartment, 'pending');

  res.status(201).json({ ok: true });
});

app.post('/api/admin/login', authLimit, async (req, res) => {
  const { collegeId, password } = req.body || {};
  if (!collegeId || !password) {
    return res.status(400).json({ error: 'College ID and password are required.' });
  }

  const admin = await db.get('SELECT * FROM admins WHERE college_id = ?', String(collegeId).trim().toUpperCase());
  if (!admin) {
    return res.status(401).json({ error: 'Invalid College ID or password.' });
  }
  if (!bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid College ID or password.' });
  }
  if (admin.status !== 'approved') {
    return res.status(403).json({
      code: 'PENDING_APPROVAL',
      error: 'Your account is still awaiting approval and a department assignment from the super admin.'
    });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start a session.' });
    req.session.adminId = admin.id;
    req.session.authVersion = admin.auth_version || 0;
    res.json({ admin: publicAdmin(admin) });
  });
});

app.post('/api/admin/logout', async (req, res) => {
  req.session.adminId = null;
  res.json({ ok: true });
});

app.get('/api/admin/me', async (req, res) => {
  if (!req.session.adminId) return res.json({ admin: null });
  const admin = await db.get('SELECT * FROM admins WHERE id = ?', req.session.adminId);
  if (!admin || admin.status !== 'approved' || (req.session.authVersion ?? 0) !== (admin.auth_version || 0)) {
    req.session.destroy(() => {});
    return res.json({ admin: null });
  }
  res.json({ admin: publicAdmin(admin) });
});

/* ---------------- admin complaint routes (scoped to admin.department) ---------------- */

app.get('/api/admin/complaints', requireAdminAuth, async (req, res) => {
  const rows = await departmentComplaintRows(req.admin.department);
  res.json({ complaints: await publicComplaints(rows) });
});

app.get('/api/admin/complaints/deleted', requireAdminAuth, async (req, res) => {
  const rows = await db.deletedComplaintRows({ category: req.admin.department });
  res.json({ complaints: await publicComplaints(rows) });
});

app.get('/api/admin/complaints/export.xlsx', requireAdminAuth, asyncRoute(async (req, res) => {
  const rows = await departmentComplaintRows(req.admin.department);
  await sendComplaintWorkbook(res, rows, 'department');
}));

app.patch('/api/admin/complaints/:code', requireAdminAuth, async (req, res) => {
  const complaint = await db.get('SELECT * FROM complaints WHERE complaint_code = ?', req.params.code);
  if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });
  if (complaint.category !== req.admin.department) {
    return res.status(403).json({ error: 'This complaint isn\u2019t routed to your department.' });
  }

  const { stageIndex, note, category, priority } = req.body || {};
  const idx = Number(stageIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx > 4) {
    return res.status(400).json({ error: 'Invalid stage.' });
  }
  if (category && !CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category.' });
  if (priority && !Object.hasOwn(SLA_HOURS, priority)) return res.status(400).json({ error: 'Invalid priority.' });

  const finalNote = note && String(note).trim() ? String(note).trim() : complaint.note;
  const finalCategory = category || complaint.category;
  const finalPriority = priority || complaint.ai_priority;
  const deadline = priority && priority !== complaint.ai_priority ? new Date(Date.now() + SLA_HOURS[finalPriority] * 3600000) : complaint.sla_deadline;
  await db.updateIncident(complaint, { stage_index: idx, note: finalNote, category: finalCategory,
    ai_priority: finalPriority, ai_reviewed: true, sla_deadline: deadline }, req.admin.id);

  const updated = await db.get('SELECT * FROM complaints WHERE id = ?', complaint.id);
  res.json({ complaint: await publicComplaint(updated) });
});

app.get('/api/admin/complaints/:code/history', requireAdminAuth, async (req, res) => {
  const complaint = await db.get('SELECT * FROM complaints WHERE complaint_code = ?', req.params.code);
  if (!complaint || complaint.category !== req.admin.department) return res.status(404).json({ error: 'Complaint not found.' });
  const history = await db.all('SELECT * FROM complaint_history WHERE complaint_id = ? ORDER BY id DESC', complaint.id);
  res.json({ history });
});

app.get('/api/admin/complaints/:code/recommendations', requireAdminAuth, async (req, res) => {
  const complaint = await db.get('SELECT * FROM complaints WHERE complaint_code = ?', req.params.code);
  if (!complaint || complaint.category !== req.admin.department) return res.status(404).json({ error: 'Complaint not found.' });
  const rows = await db.recentResolvedComplaints(req.admin.department, 150);
  const text = `${complaint.title} ${complaint.description}`;
  const similar = rows.filter(row => row.id !== complaint.id && row.stage_index >= 3)
    .map(row => ({ id: row.complaint_code, title: row.title, category: row.category, resolution: row.note, similarity: Math.round(similarity(text, `${row.title} ${row.description}`) * 100) }))
    .filter(row => row.similarity >= 25).sort((a, b) => b.similarity - a.similarity).slice(0, 3);
  res.json({ similar, suggestedResolution: complaint.ai_suggested_resolution || [], suggestedResponse: `Your complaint regarding “${complaint.title}” has been acknowledged and assigned to the ${complaint.category} department. The team is reviewing the issue.` });
});

app.delete('/api/admin/complaints/:code', requireAdminAuth, async (req, res) => {
  const deleted = await db.softDeleteComplaint({ complaintCode: req.params.code, category: req.admin.department,
    deletedByRole: 'staff', deletedById: req.admin.id });
  if (!deleted) return res.status(404).json({ error: 'Complaint not found.' });
  res.json({ ok: true });
});

/* ---------------- super admin routes ----------------
   Gated by SUPERADMIN_KEY rather than a users-table account — this is a
   single shared key for whoever administers the deployment, not a
   per-person login. */

app.post('/api/superadmin/login', authLimit, async (req, res) => {
  const { key } = req.body || {};
  if (!key || key !== SUPERADMIN_KEY) {
    return res.status(401).json({ error: 'Incorrect super admin key.' });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start a session.' });
    req.session.isSuperAdmin = true;
    res.json({ ok: true });
  });
});

app.post('/api/superadmin/logout', async (req, res) => {
  req.session.isSuperAdmin = null;
  res.json({ ok: true });
});

app.get('/api/superadmin/me', async (req, res) => {
  res.json({ isSuperAdmin: !!req.session.isSuperAdmin });
});

app.get('/api/superadmin/admins', requireSuperAdmin, async (req, res) => {
  const rows = await db.all(
    "SELECT * FROM admins ORDER BY (status = 'pending') DESC, id DESC"
  );
  res.json({ admins: rows.map(publicAdmin) });
});

app.get('/api/superadmin/complaints', requireSuperAdmin, async (req, res) => {
  const page = requestedPage(req);
  if (!page) return res.status(400).json({ error: 'Invalid complaint page.' });
  const result = await db.complaintPage(page);
  res.json({ complaints: await publicComplaints(result.rows), pagination: pageInfo(page.page, page.pageSize, result.total) });
});

app.get('/api/superadmin/complaints/export.xlsx', requireSuperAdmin, asyncRoute(async (req, res) => {
  const rows = await allComplaintRows();
  await sendComplaintWorkbook(res, rows, 'all');
}));

app.get('/api/superadmin/complaints/:code', requireSuperAdmin, asyncRoute(async (req, res) => {
  const complaint = await db.get('SELECT * FROM complaints WHERE complaint_code = ?', req.params.code);
  if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });
  const student = complaint.user_id ? await db.get('SELECT * FROM users WHERE id = ?', complaint.user_id) : null;
  const row = {
    ...complaint,
    student_name: student?.name,
    student_college_id: student?.college_id,
    student_email: student?.email,
    student_hostel: student?.hostel
  };
  res.json({ complaint: await publicComplaint(row, undefined, { includeSensitive: true }) });
}));

app.get('/api/superadmin/students/complaints', requireSuperAdmin, asyncRoute(async (req, res) => {
  const page = requestedPage(req);
  if (!page) return res.status(400).json({ error: 'Invalid student page.' });
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 80) : '';
  const result = await db.studentComplaintSummaryPage({ ...page, search });
  res.json({ students: result.students, pagination: pageInfo(page.page, page.pageSize, result.total) });
}));

app.get('/api/superadmin/students/:studentId/complaints', requireSuperAdmin, asyncRoute(async (req, res) => {
  const studentId = Number(req.params.studentId);
  if (!Number.isSafeInteger(studentId) || studentId < 1) return res.status(400).json({ error: 'Invalid student.' });
  const student = await db.get('SELECT id FROM users WHERE id = ?', studentId);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  const page = requestedPage(req, 25);
  if (!page) return res.status(400).json({ error: 'Invalid complaint page.' });
  const result = await db.complaintPage({ ...page, userId: studentId });
  res.json({ complaints: await publicComplaints(result.rows), pagination: pageInfo(page.page, page.pageSize, result.total) });
}));

app.get('/api/superadmin/analytics', requireSuperAdmin, async (req, res) => {
  const rows = await db.all('SELECT * FROM complaints ORDER BY id DESC');
  const countBy = key => rows.reduce((out, row) => ((out[row[key] || 'Unknown'] = (out[row[key] || 'Unknown'] || 0) + 1), out), {});
  const resolved = rows.filter(row => row.stage_index >= 3);
  const feedback = rows.map(row => row.feedback?.rating).filter(Number.isFinite);
  res.json({
    total: rows.length,
    resolved: resolved.length,
    pending: rows.length - resolved.length,
    overdue: rows.filter(row => row.sla_deadline && Date.now() > new Date(row.sla_deadline).getTime() && row.stage_index < 3).length,
    resolutionRate: rows.length ? Math.round(resolved.length / rows.length * 100) : 0,
    averageFeedback: feedback.length ? Math.round(feedback.reduce((a, b) => a + b, 0) / feedback.length * 10) / 10 : null,
    byDepartment: countBy('category'),
    byPriority: countBy('ai_priority'),
    byLocation: countBy('location')
  });
});

app.delete('/api/superadmin/complaints/:code', requireSuperAdmin, async (req, res) => {
  const deleted = await db.softDeleteComplaint({ complaintCode: req.params.code,
    deletedByRole: 'superadmin', deletedById: null });
  if (!deleted) return res.status(404).json({ error: 'Complaint not found.' });
  res.json({ ok: true });
});

app.patch('/api/superadmin/admins/:id', requireSuperAdmin, async (req, res) => {
  const admin = await db.get('SELECT * FROM admins WHERE id = ?', req.params.id);
  if (!admin) return res.status(404).json({ error: 'Account not found.' });

  const { department, status } = req.body || {};
  const nextStatus = status || admin.status;

  if (nextStatus === 'approved') {
    if (!department || !CATEGORIES.includes(department)) {
      return res.status(400).json({ error: 'Choose a department to approve this account.' });
    }
    await db.run('UPDATE admins SET department = ?, status = ? WHERE id = ?', department, 'approved', admin.id);
  } else if (nextStatus === 'pending') {
    await db.run('UPDATE admins SET status = ?, department = NULL WHERE id = ?', 'pending', admin.id);
  } else {
    return res.status(400).json({ error: 'Unrecognized status.' });
  }

  const updated = await db.get('SELECT * FROM admins WHERE id = ?', admin.id);
  res.json({ admin: publicAdmin(updated) });
});

// Rejecting a still-pending registration just deletes it outright (there's
// nothing else referencing an admin row yet, unlike users/complaints).
app.delete('/api/superadmin/admins/:id', requireSuperAdmin, async (req, res) => {
  await db.run('DELETE FROM admins WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

/* ---------------- super admin: student/staff lookup + credential edits ----------------
   Lets the super admin find a person by (partial) College ID across both the
   students table (users) and the staff table (admins), then update the
   username (College ID), email, and/or password on either account. This is
   deliberately a separate pair of routes from the department-approval ones
   above so credential changes never accidentally touch status/department. */

app.get('/api/superadmin/people/search', requireSuperAdmin, asyncRoute(async (req, res) => {
  const q = String(req.query.collegeId || '').trim().toUpperCase();
  if (!q) return res.json({ students: [], staff: [] });

  const students = (await db.all(
    'SELECT * FROM users WHERE UPPER(college_id) LIKE ? ORDER BY name ASC LIMIT 25'
  , `%${q}%`)).map(publicUser);

  const staff = (await db.all(
    'SELECT * FROM admins WHERE UPPER(college_id) LIKE ? ORDER BY name ASC LIMIT 25'
  , `%${q}%`)).map(publicAdmin);

  res.json({ students, staff });
}));

app.patch('/api/superadmin/students/:id/credentials', requireSuperAdmin, async (req, res) => {
  const student = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const { collegeId, email, password } = req.body || {};
  if (!collegeId || !email) {
    return res.status(400).json({ error: 'College ID and email are required.' });
  }

  const cleanId = String(collegeId).trim().toUpperCase();
  const cleanEmail = String(email).trim().toLowerCase();

  if (!isValidCollegeId(cleanId)) {
    return res.status(400).json({ error: 'College ID must be VTU followed by exactly five digits (e.g. VTU28243).' });
  }
  if (cleanEmail !== `${cleanId.toLowerCase()}@veltech.edu.in`) {
    return res.status(400).json({ error: 'Email must match the College ID and end with @veltech.edu.in.' });
  }
  const idConflict = await db.get('SELECT id FROM users WHERE college_id = ? AND id != ?', cleanId, student.id);
  if (idConflict) return res.status(409).json({ error: 'That College ID is already used by another student.' });
  const emailConflict = await db.get('SELECT id FROM users WHERE email = ? AND id != ?', cleanEmail, student.id);
  if (emailConflict) return res.status(409).json({ error: 'That email is already used by another student.' });

  if (password) {
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }
    const passwordHash = bcrypt.hashSync(password, 10);
    await db.run('UPDATE users SET college_id = ?, email = ?, password_hash = ?, auth_version = auth_version + 1 WHERE id = ?', cleanId, cleanEmail, passwordHash, student.id);
  } else {
    await db.run('UPDATE users SET college_id = ?, email = ? WHERE id = ?', cleanId, cleanEmail, student.id);
  }

  const updated = await db.get('SELECT * FROM users WHERE id = ?', student.id);
  res.json({ student: publicUser(updated) });
});

app.patch('/api/superadmin/staff/:id/credentials', requireSuperAdmin, async (req, res) => {
  const staff = await db.get('SELECT * FROM admins WHERE id = ?', req.params.id);
  if (!staff) return res.status(404).json({ error: 'Staff account not found.' });

  const { collegeId, email, password } = req.body || {};
  if (!collegeId || !email) {
    return res.status(400).json({ error: 'College ID and email are required.' });
  }

  const cleanId = String(collegeId).trim().toUpperCase();
  const cleanEmail = String(email).trim().toLowerCase();

  if (!isValidStaffCollegeId(cleanId)) {
    return res.status(400).json({ error: 'College ID must be TTS followed by exactly five digits (e.g. TTS12345).' });
  }
  if (cleanEmail !== `${cleanId.toLowerCase()}@veltech.edu.in`) {
    return res.status(400).json({ error: 'Email must match the staff ID and end with @veltech.edu.in.' });
  }
  const idConflict = await db.get('SELECT id FROM admins WHERE college_id = ? AND id != ?', cleanId, staff.id);
  if (idConflict) return res.status(409).json({ error: 'That College ID is already used by another staff account.' });
  const emailConflict = await db.get('SELECT id FROM admins WHERE email = ? AND id != ?', cleanEmail, staff.id);
  if (emailConflict) return res.status(409).json({ error: 'That email is already used by another staff account.' });

  if (password) {
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }
    const passwordHash = bcrypt.hashSync(password, 10);
    await db.run('UPDATE admins SET college_id = ?, email = ?, password_hash = ?, auth_version = auth_version + 1 WHERE id = ?', cleanId, cleanEmail, passwordHash, staff.id);
  } else {
    await db.run('UPDATE admins SET college_id = ?, email = ? WHERE id = ?', cleanId, cleanEmail, staff.id);
  }

  const updated = await db.get('SELECT * FROM admins WHERE id = ?', staff.id);
  res.json({ staff: publicAdmin(updated) });
});

// Catches any error thrown inside a route (e.g. a database problem) and
// logs the full stack trace to this terminal — the browser only ever
// sees a generic message, but you'll see exactly what broke here.
app.use((err, req, res, next) => {
  console.error('Unhandled error on', req.method, req.path, '\n', err.stack);
  res.status(500).json({ error: 'Server error — check the terminal for details.' });
});

initDb()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`CampusDesk server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Could not initialize MongoDB:', err);
    process.exit(1);
  });
