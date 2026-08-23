const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { db, initDb } = require('./db/database');
const { sendOtpEmail } = require('./lib/mailer');
const { analyzeComplaint } = require('./lib/complaint-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// Gate for the super admin panel that approves staff accounts and assigns
// departments. Change this via env var in any real deployment — same spirit
// as SESSION_SECRET above.
const SUPERADMIN_KEY = process.env.SUPERADMIN_KEY || 'campusdesk-superadmin-dev-key';

// Photos are sent as base64 data URLs in the JSON body, so the default
// ~100kb express.json() limit is too small — bump it.
app.use(express.json({ limit: '5mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'campusdesk-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 8 // 8 hour session
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Browsers auto-request this; there's no favicon asset yet, so just
// answer quietly instead of letting it 404 in the console.
app.get('/favicon.ico', async (req, res) => res.status(204).end());

app.get('/', async (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'structure.html'));
});

/* ---------------- constants (kept in sync with Script.js) ---------------- */

const CATEGORIES = ['Hostel', 'Mess', 'Academic', 'Wi-Fi & Network', 'Transport', 'Library', 'General'];
const HOSTELS = ['Leaders', 'Kings', 'Queens', 'B3', 'IGH', 'VVH'];

const OTP_TTL_MS = 10 * 60 * 1000;   // 10 minutes
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;

/* ---------------- helpers ---------------- */

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  next();
}

function publicUser(u) {
  return { id: u.id, name: u.name, collegeId: u.college_id, hostel: u.hostel, email: u.email };
}

function isValidCollegeId(id) {
  return /^VTU.{5}$/i.test(id) && id.length === 8;
}

/* Department staff use a separate TTS-prefixed College ID — never VTU. */
function isValidStaffCollegeId(id) {
  return /^TTS.{5}$/i.test(id) && id.length === 8;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function genComplaintCode() {
  for (let i = 0; i < 20; i++) {
    const code = 'CDT-' + Math.floor(1000 + Math.random() * 9000);
    const exists = await db.get('SELECT id FROM complaints WHERE complaint_code = ?', code);
    if (!exists) return code;
  }
  return 'CDT-' + Date.now().toString().slice(-6); // astronomically unlikely fallback
}

function maskEmail(email) {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  return user.slice(0, 2) + '***@' + domain;
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
  if (!admin || admin.status !== 'approved') {
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

async function publicComplaint(c) {
  const routing = await getRoutingDetails(c.category);
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
    photo: c.photo || null,
    createdAt: c.created_at,
    studentName: c.student_name || null,
    studentCollegeId: c.student_college_id || null,
    studentEmail: c.student_email || null,
    studentHostel: c.student_hostel || null,
    aiCategory: c.ai_category || null,
    aiConfidence: c.ai_confidence || null,
    aiPriority: c.ai_priority || null,
    aiPriorityReason: c.ai_priority_reason || null,
    aiSummary: c.ai_summary || null,
    possibleDuplicate: c.possible_duplicate || null
  };
}

/* ---------------- auth routes ---------------- */

app.post('/api/register', async (req, res) => {
  const { name, email, collegeId, hostel, password } = req.body || {};

  if (!name || !email || !collegeId || !hostel || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const cleanId = String(collegeId).trim().toUpperCase();
  const cleanEmail = String(email).trim();

  if (!isValidCollegeId(cleanId)) {
    return res.status(400).json({ error: 'College ID must start with VTU and be exactly 8 characters.' });
  }
  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (!HOSTELS.includes(hostel)) {
    return res.status(400).json({ error: 'Please select a hostel from the list.' });
  }

  const existing = await db.get('SELECT id FROM users WHERE college_id = ?', cleanId);
  if (existing) {
    return res.status(409).json({ error: 'An account with that College ID already exists — please log in instead.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = await db.run(
    'INSERT INTO users (college_id, name, email, hostel, password_hash) VALUES (?, ?, ?, ?, ?) RETURNING id'
  , cleanId, String(name).trim(), cleanEmail, hostel, passwordHash);

  const user = await db.get('SELECT * FROM users WHERE id = ?', info.lastInsertRowid);

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start a session.' });
    req.session.userId = user.id;
    res.status(201).json({ user: publicUser(user) });
  });
});

app.post('/api/login', async (req, res) => {
  const { collegeId, password } = req.body || {};
  if (!collegeId || !password) {
    return res.status(400).json({ error: 'College ID and password are required.' });
  }

  const user = await db.get('SELECT * FROM users WHERE college_id = ?', String(collegeId).trim().toUpperCase());
  if (!user) {
    return res.status(404).json({
      code: 'NO_ACCOUNT',
      error: "We couldn't find an account with that College ID — please register first."
    });
  }
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({
      code: 'WRONG_PASSWORD',
      error: 'Incorrect password for that College ID. Please try again.'
    });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start a session.' });
    req.session.userId = user.id;
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
  if (!user) return res.json({ user: null });
  res.json({ user: publicUser(user) });
});

app.patch('/api/me', requireAuth, async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.session.userId);
  if (!user) return res.status(401).json({ error: 'Session invalid.' });

  const { name, hostel, password } = req.body || {};
  if (!name || !hostel) {
    return res.status(400).json({ error: "Name and hostel can't be empty." });
  }
  if (!HOSTELS.includes(hostel)) {
    return res.status(400).json({ error: 'Please select a hostel from the list.' });
  }

  if (password) {
    const passwordHash = bcrypt.hashSync(password, 10);
    await db.run('UPDATE users SET name = ?, hostel = ?, password_hash = ? WHERE id = ?', String(name).trim(), hostel, passwordHash, user.id);
  } else {
    await db.run('UPDATE users SET name = ?, hostel = ? WHERE id = ?', String(name).trim(), hostel, user.id);
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

app.post('/api/forgot', async (req, res) => {
  const { collegeId } = req.body || {};
  if (!collegeId) return res.status(400).json({ error: 'College ID is required.' });

  const user = await db.get('SELECT * FROM users WHERE college_id = ?', String(collegeId).trim().toUpperCase());
  if (!user) return res.status(404).json({ error: 'No account found with that college ID.' });

  const otp = String(crypto.randomInt(100000, 1000000));
  const mailResult = await sendOtpEmail({ to: user.email, name: user.name, otp });
  if (!mailResult.sent) {
    return res.status(503).json({ error: 'We could not send a verification code. Please try again later.' });
  }

  // Invalidate earlier unused codes only after the replacement was delivered.
  await db.run('DELETE FROM password_resets WHERE user_id = ? AND otp_used = 0', user.id);
  await db.run(
    'INSERT INTO password_resets (user_id, otp, otp_expires_at) VALUES (?, ?, ?)'
  , user.id, bcrypt.hashSync(otp, 10), Date.now() + OTP_TTL_MS);

  res.json({
    ok: true,
    maskedEmail: maskEmail(user.email),
    // Lets the frontend show a heads-up banner in local dev when SMTP isn't
    // configured — never carries the code itself, only whether it went out.
    emailed: true
  });
});

app.post('/api/forgot/verify', async (req, res) => {
  const { collegeId, otp } = req.body || {};
  if (!collegeId || !otp) return res.status(400).json({ error: 'College ID and code are required.' });

  const user = await db.get('SELECT * FROM users WHERE college_id = ?', String(collegeId).trim().toUpperCase());
  if (!user) return res.status(404).json({ error: 'No account found with that college ID.' });

  const row = await db.get(
    'SELECT * FROM password_resets WHERE user_id = ? AND otp_used = 0 ORDER BY id DESC LIMIT 1'
  , user.id);

  if (!row || row.otp_expires_at < Date.now()) {
    return res.status(400).json({ error: 'That code has expired — request a new one.' });
  }
  if (row.attempts >= MAX_OTP_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many incorrect attempts — request a new code.' });
  }

  if (!bcrypt.compareSync(String(otp).trim(), row.otp)) {
    await db.run('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', row.id);
    const remaining = MAX_OTP_ATTEMPTS - (row.attempts + 1);
    return res.status(400).json({
      error: remaining > 0
        ? `That code doesn\u2019t match. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
        : 'Too many incorrect attempts — request a new code.'
    });
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
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  }

  const user = await db.get('SELECT * FROM users WHERE college_id = ?', String(collegeId).trim().toUpperCase());
  if (!user) return res.status(404).json({ error: 'No account found with that college ID.' });

  const row = await db.get(
    'SELECT * FROM password_resets WHERE user_id = ? AND reset_token = ? ORDER BY id DESC LIMIT 1'
  , user.id, resetToken);

  if (!row || !row.token_expires_at || row.token_expires_at < Date.now()) {
    return res.status(400).json({ error: 'This reset link has expired — request a new code.' });
  }

  const passwordHash = bcrypt.hashSync(newPassword, 10);
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, user.id);
  await db.run('DELETE FROM password_resets WHERE user_id = ?', user.id);

  res.json({ ok: true });
});

/* ---------------- complaint routes (always scoped to req.session.userId) ---------------- */

app.get('/api/complaints', requireAuth, async (req, res) => {
  const rows = await db.all(
    'SELECT * FROM complaints WHERE user_id = ? ORDER BY id DESC'
  , req.session.userId);

  res.json({ complaints: await Promise.all(rows.map(publicComplaint)) });
});

app.post('/api/complaints/analyze', requireAuth, async (req, res) => {
  const { title, description } = req.body || {};
  if (!title || !description) return res.status(400).json({ error: 'Add a subject and description first.' });
  const complaints = await db.all('SELECT * FROM complaints ORDER BY id DESC');
  res.json({ analysis: analyzeComplaint({ title, description, complaints }) });
});

app.post('/api/complaints', requireAuth, async (req, res) => {
  const { category, title, description, photo } = req.body || {};

  if (!title || !description || !category) {
    return res.status(400).json({ error: 'Category, subject, and details are all required.' });
  }
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Unrecognized category.' });
  }

  const code = await genComplaintCode();
  const routing = await getRoutingDetails(category);
  const complaints = await db.all('SELECT * FROM complaints ORDER BY id DESC');
  const analysis = analyzeComplaint({ title, description, complaints });

  const info = await db.run(
    `INSERT INTO complaints (complaint_code, user_id, category, title, description, officer, stage_index, note, photo, ai_category, ai_confidence, ai_priority, ai_priority_reason, ai_summary, possible_duplicate)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  , code, req.session.userId, category, String(title).trim(), String(description).trim(), routing.officer, routing.note, photo || null,
    analysis.category, analysis.confidence, analysis.priority, analysis.reason, analysis.summary, analysis.duplicate);

  const row = await db.get('SELECT * FROM complaints WHERE id = ?', info.lastInsertRowid);
  res.status(201).json({ complaint: await publicComplaint(row) });
});

app.delete('/api/complaints/:code', requireAuth, async (req, res) => {
  const result = await db.run('DELETE FROM complaints WHERE complaint_code = ? AND user_id = ?', req.params.code, req.session.userId);
  if (!result.changes) return res.status(404).json({ error: 'Complaint not found.' });
  res.json({ ok: true });
});

/* ---------------- admin auth routes (department staff) ----------------
   Registration never logs the account in — it always lands in 'pending'
   with no department, and only /api/superadmin/admins/:id can approve it
   and assign a department. */

app.post('/api/admin/register', async (req, res) => {
  const { name, email, collegeId, password, requestedDepartment } = req.body || {};

  if (!name || !email || !collegeId || !password || !requestedDepartment) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const cleanEmail = String(email).trim();
  const cleanId = String(collegeId).trim().toUpperCase();

  if (!isValidStaffCollegeId(cleanId)) {
    if (cleanId.startsWith('VTU')) {
      return res.status(400).json({ error: "That's a student ID. Staff must register with a TTS College ID, e.g. TTS12345." });
    }
    return res.status(400).json({ error: 'College ID must start with TTS and be exactly 8 characters.' });
  }
  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
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
  , String(name).trim(), cleanEmail, cleanId, passwordHash, requestedDepartment, requestedDepartment, 'pending');

  res.status(201).json({ ok: true });
});

app.post('/api/admin/login', async (req, res) => {
  const { collegeId, password } = req.body || {};
  if (!collegeId || !password) {
    return res.status(400).json({ error: 'College ID and password are required.' });
  }

  const admin = await db.get('SELECT * FROM admins WHERE college_id = ?', String(collegeId).trim().toUpperCase());
  if (!admin) {
    return res.status(404).json({
      code: 'NO_ACCOUNT',
      error: "We couldn't find a staff account with that College ID — please register first."
    });
  }
  if (!bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ code: 'WRONG_PASSWORD', error: 'Incorrect password.' });
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
  if (!admin || admin.status !== 'approved') return res.json({ admin: null });
  res.json({ admin: publicAdmin(admin) });
});

/* ---------------- admin complaint routes (scoped to admin.department) ---------------- */

app.get('/api/admin/complaints', requireAdminAuth, async (req, res) => {
  const rows = await db.all(`
    SELECT c.*, u.name as student_name, u.college_id as student_college_id, u.email as student_email, u.hostel as student_hostel
    FROM complaints c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.category = ?
    ORDER BY c.id DESC
  `, req.admin.department);

  res.json({ complaints: await Promise.all(rows.map(publicComplaint)) });
});

app.patch('/api/admin/complaints/:code', requireAdminAuth, async (req, res) => {
  const complaint = await db.get('SELECT * FROM complaints WHERE complaint_code = ?', req.params.code);
  if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });
  if (complaint.category !== req.admin.department) {
    return res.status(403).json({ error: 'This complaint isn\u2019t routed to your department.' });
  }

  const { stageIndex, note } = req.body || {};
  const idx = Number(stageIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx > 3) {
    return res.status(400).json({ error: 'Invalid stage.' });
  }

  const finalNote = note && String(note).trim() ? String(note).trim() : complaint.note;
  await db.run('UPDATE complaints SET stage_index = ?, note = ? WHERE id = ?', idx, finalNote, complaint.id);

  const updated = await db.get('SELECT * FROM complaints WHERE id = ?', complaint.id);
  res.json({ complaint: await publicComplaint(updated) });
});

app.delete('/api/admin/complaints/:code', requireAdminAuth, async (req, res) => {
  const result = await db.run('DELETE FROM complaints WHERE complaint_code = ? AND category = ?', req.params.code, req.admin.department);
  if (!result.changes) return res.status(404).json({ error: 'Complaint not found.' });
  res.json({ ok: true });
});

/* ---------------- super admin routes ----------------
   Gated by SUPERADMIN_KEY rather than a users-table account — this is a
   single shared key for whoever administers the deployment, not a
   per-person login. */

app.post('/api/superadmin/login', async (req, res) => {
  const { key } = req.body || {};
  if (!key || key !== SUPERADMIN_KEY) {
    return res.status(401).json({ error: 'Incorrect super admin key.' });
  }
  req.session.isSuperAdmin = true;
  res.json({ ok: true });
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
  const rows = await db.all(`
    SELECT c.*, u.name as student_name, u.college_id as student_college_id, u.email as student_email, u.hostel as student_hostel
    FROM complaints c
    LEFT JOIN users u ON c.user_id = u.id
    ORDER BY c.id DESC
  `);
  res.json({ complaints: await Promise.all(rows.map(publicComplaint)) });
});

app.delete('/api/superadmin/complaints/:code', requireSuperAdmin, async (req, res) => {
  const result = await db.run('DELETE FROM complaints WHERE complaint_code = ?', req.params.code);
  if (!result.changes) return res.status(404).json({ error: 'Complaint not found.' });
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

app.get('/api/superadmin/people/search', requireSuperAdmin, async (req, res) => {
  const q = String(req.query.collegeId || '').trim().toUpperCase();
  if (!q) return res.json({ students: [], staff: [] });

  const students = await db.all(
    'SELECT * FROM users WHERE UPPER(college_id) LIKE ? ORDER BY name ASC LIMIT 25'
  , `%${q}%`).map(publicUser);

  const staff = await db.all(
    'SELECT * FROM admins WHERE UPPER(college_id) LIKE ? ORDER BY name ASC LIMIT 25'
  , `%${q}%`).map(publicAdmin);

  res.json({ students, staff });
});

app.patch('/api/superadmin/students/:id/credentials', requireSuperAdmin, async (req, res) => {
  const student = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const { collegeId, email, password } = req.body || {};
  if (!collegeId || !email) {
    return res.status(400).json({ error: 'College ID and email are required.' });
  }

  const cleanId = String(collegeId).trim().toUpperCase();
  const cleanEmail = String(email).trim();

  if (!isValidCollegeId(cleanId)) {
    return res.status(400).json({ error: 'College ID must start with VTU and be exactly 8 characters.' });
  }
  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  const idConflict = await db.get('SELECT id FROM users WHERE college_id = ? AND id != ?', cleanId, student.id);
  if (idConflict) return res.status(409).json({ error: 'That College ID is already used by another student.' });

  if (password) {
    if (String(password).length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    }
    const passwordHash = bcrypt.hashSync(password, 10);
    await db.run('UPDATE users SET college_id = ?, email = ?, password_hash = ? WHERE id = ?', cleanId, cleanEmail, passwordHash, student.id);
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
  const cleanEmail = String(email).trim();

  if (!isValidStaffCollegeId(cleanId)) {
    return res.status(400).json({ error: 'College ID must start with TTS and be exactly 8 characters.' });
  }
  if (!isValidEmail(cleanEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  const idConflict = await db.get('SELECT id FROM admins WHERE college_id = ? AND id != ?', cleanId, staff.id);
  if (idConflict) return res.status(409).json({ error: 'That College ID is already used by another staff account.' });
  const emailConflict = await db.get('SELECT id FROM admins WHERE email = ? AND id != ?', cleanEmail, staff.id);
  if (emailConflict) return res.status(409).json({ error: 'That email is already used by another staff account.' });

  if (password) {
    if (String(password).length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    }
    const passwordHash = bcrypt.hashSync(password, 10);
    await db.run('UPDATE admins SET college_id = ?, email = ?, password_hash = ? WHERE id = ?', cleanId, cleanEmail, passwordHash, staff.id);
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
