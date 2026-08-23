/* =======================================================================
   Vel Tech Complaint Box — frontend logic, backed by the real Express +
   SQLite API in server.js (see /api/* routes). No more in-memory mock data:
   every register/login/complaint call actually hits the server and persists
   to campusdesk.db.
   ======================================================================= */

/* ---------------- Reference data (kept in sync with server.js) ---------------- */
const CATEGORIES = ['Hostel', 'Mess', 'Academic', 'Wi-Fi & Network', 'Transport', 'Library', 'General'];

const STAGES = ['Submitted', 'Routed', 'In Progress', 'Resolved'];

const HOSTELS = ['Leaders', 'Kings', 'Queens', 'B3', 'IGH', 'VVH'];

const DROPDOWN_ICONS = {
  'Hostel': '🏠', 'Mess': '🍽️', 'Academic': '🎓', 'Wi-Fi & Network': '📶',
  'Transport': '🚌', 'Library': '📚', 'General': '✨',
  'Leaders': '🏆', 'Kings': '👑', 'Queens': '👑', 'B3': '🛏️', 'IGH': '🏢', 'VVH': '🏢',
  'Submitted': '📨', 'Routed': '📍', 'In Progress': '⚙️', 'Resolved': '✅'
};

function dropdownLabel(name) {
  return `${DROPDOWN_ICONS[name] || '•'} ${name}`;
}

/* ---------------- Category colors + icons (vivid accent set) ---------------- */
const CATEGORY_META = {
  'Hostel':          { color: '#2F6FED', icon: 'home' },
  'Mess':            { color: '#FB923C', icon: 'utensils' },
  'Academic':        { color: '#22C55E', icon: 'cap' },
  'Wi-Fi & Network': { color: '#A855F7', icon: 'wifi' },
  'Transport':       { color: '#F43F5E', icon: 'bus' },
  'Library':         { color: '#14B8A6', icon: 'book' },
  'General':         { color: '#EC4899', icon: 'spark' }
};

const CATEGORY_ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>',
  utensils: '<path d="M7 2.5v7a2 2 0 0 0 2 2v10"/><path d="M7 2.5v7"/><path d="M11 2.5v7"/><path d="M17 2.5c-1.5 0-2 2.2-2 4.5s.5 5 2 5 2-2.7 2-5-.5-4.5-2-4.5Z"/><path d="M17 12v9.5"/>',
  cap: '<path d="M2 9 12 4l10 5-10 5-10-5Z"/><path d="M6 11.5V17c0 1 2.5 3 6 3s6-2 6-3v-5.5"/><path d="M22 9v6"/>',
  wifi: '<path d="M2 8.5a16 16 0 0 1 20 0"/><path d="M5 12.5a11 11 0 0 1 14 0"/><path d="M8.5 16.5a6 6 0 0 1 7 0"/><circle cx="12" cy="20" r="1.2" fill="currentColor" stroke="none"/>',
  bus: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M3 11h18"/><circle cx="7.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>',
  book: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5v-13Z"/>',
  spark: '<path d="M12 2.5v4"/><path d="M12 17.5v4"/><path d="M2.5 12h4"/><path d="M17.5 12h4"/><path d="M5.6 5.6l2.8 2.8"/><path d="M15.6 15.6l2.8 2.8"/><path d="M18.4 5.6l-2.8 2.8"/><path d="M8.4 15.6l-2.8 2.8"/>'
};

function categoryIcon(cat, size) {
  const meta = CATEGORY_META[cat] || CATEGORY_META['General'];
  const px = size || 14;
  return `<svg class="cat-icon" viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:${meta.color}">${CATEGORY_ICONS[meta.icon]}</svg>`;
}

/* "In progress" indicator — a partial progress ring instead of a flat dot,
   reads as "work under way" rather than just a status color. */
function progressIcon() {
  return `<svg class="progress-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.22" stroke-width="3"/>
    <path d="M12 3a9 9 0 0 1 6.36 15.36" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ---------------- Tiny fetch wrapper ----------------
   Talks to the same-origin Express API. Throws an Error with a
   user-facing .message (and .code, when the server sends one, e.g.
   NO_ACCOUNT / WRONG_PASSWORD) so callers can just try/catch. */
async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (networkErr) {
    throw new Error('Could not reach the server — check that it\u2019s running and try again.');
  }

  let data = null;
  try { data = await res.json(); } catch (parseErr) { /* empty response body, e.g. 204 */ }

  if (!res.ok) {
    const err = new Error((data && data.error) || 'Something went wrong.');
    err.code = data && data.code;
    err.status = res.status;
    throw err;
  }
  return data || {};
}

function setBtnLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('is-loading', loading);
}

/* ---------------- Session state ---------------- */
let currentUser = null;      // { collegeId, name, hostel, email } — set from the server's response
let ticketsCache = [];       // this student's complaints, loaded from /api/complaints
let activeFilterCategory = 'All';
let activeSearch = '';
let stagedPhotoDataUrl = null;
let notifSeen = false;
let pendingReset = null;   // { collegeId, maskedEmail, resetToken? }

/* ---------------- Admin / super-admin session state ---------------- */
let currentAdmin = null;        // { id, name, email, department } — approved department staff
let adminTicketsCache = [];     // complaints routed to currentAdmin's department
let activeAdminFilterStage = 'All';
let activeAdminSearch = '';
let superAdminAdmins = [];      // all staff accounts, loaded in the super-admin panel
let superAdminComplaints = [];  // all complaints, loaded for super-admin deletion
let superAdminSearchResults = { students: [], staff: [] }; // last "Manage credentials" search

/* ---------------- View switching ---------------- */
function triggerPageShimmer() {
  const bar = document.getElementById('pageShimmer');
  if (!bar) return;
  bar.classList.remove('active');
  // eslint-disable-next-line no-unused-expressions
  void bar.offsetWidth; // restart animation
  bar.classList.add('active');
}

function switchView(fromId, toId) {
  closeMobileNav();
  const from = document.getElementById(fromId);
  const to = document.getElementById(toId);

  triggerPageShimmer();

  if (from) {
    from.classList.add('view-leave');
    setTimeout(() => {
      from.style.display = 'none';
      from.classList.remove('view-leave');
    }, 260);
  }
  if (to) {
    to.style.display = '';
    to.classList.remove('view-enter');
    // eslint-disable-next-line no-unused-expressions
    void to.offsetWidth; // restart animation
    to.classList.add('view-enter');
    // Re-trigger the auth card's own materialize animation too, in case
    // this same view was already mounted (e.g. switching login -> register -> login).
    const card = to.querySelector('.auth-card');
    if (card) {
      card.style.animation = 'none';
      // eslint-disable-next-line no-unused-expressions
      void card.offsetWidth;
      card.style.animation = '';
    }
    if (toId === 'view-forgot-otp') wireOtpBoxes();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------- Feature tabs (Students / Wardens & Maintenance / Admins) ----------------
   Simple, dependency-free tab switcher for the landing page "Features" block —
   mirrors the same active/inactive pattern used by .tab and .dash-nav elsewhere. */
function selectFeatureTab(key) {
  const tablist = document.querySelector('.feat-tablist');
  const panels = document.querySelectorAll('.feat-panel');
  if (!tablist) return;

  tablist.querySelectorAll('.feat-tab').forEach((btn, i) => {
    const match = btn.getAttribute('aria-controls') === `feat-panel-${key}`;
    btn.classList.toggle('active', match);
    btn.setAttribute('aria-selected', match ? 'true' : 'false');
  });

  panels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `feat-panel-${key}`);
  });
}

/* ---------------- Smooth in-page navigation (How it works / About) ----------------
   Scrolls to the section with a bit more polish than a bare anchor jump, and
   re-plays the heading's reveal animation each time so it feels alive even
   if the section was already on screen. */
function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  triggerPageShimmer();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const head = el.querySelector('.section-head');
  if (head) {
    head.classList.remove('pulse-in');
    // eslint-disable-next-line no-unused-expressions
    void head.offsetWidth;
    head.classList.add('pulse-in');
  }
}

/* ---------------- Toast ---------------- */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------------- Landing: category chips ---------------- */
function renderCategoryChips() {
  const wrap = document.getElementById('categoryChips');
  if (!wrap) return;
  wrap.innerHTML = CATEGORIES.map(c => {
    const meta = CATEGORY_META[c] || CATEGORY_META['General'];
    return `<span class="chip" style="--chip-color:${meta.color}">${categoryIcon(c, 14)}${c}</span>`;
  }).join('');
}

/* ---------------- Landing: hero ticket stage animation ----------------
   Same ticket (CDT-2481, Wi-Fi dead zone) — only the stage/progress cycles,
   one bar filling at a time: Submitted → Routed → In Progress → Resolved,
   then loops back around. */
const HERO_NOTES = [
  'The complaint is routed to the respective Wi-Fi & Network department.',
  'Department staff are checking signal strength on the 3rd floor.',
  'Repeater installed — waiting on your confirmation.',
  'Confirmed fixed by the reporting student.'
];

function heroStatusDotClass(stageIndex) {
  if (stageIndex >= 3) return 'dot-green';
  if (stageIndex === 2) return 'dot-orange';
  return 'dot-red';
}

function renderHeroStage(stageIndex) {
  const stampEl = document.getElementById('heroStamp');
  const trackEl = document.getElementById('heroTrack');
  const noteEl = document.getElementById('heroNote');
  if (!stampEl || !trackEl || !noteEl) return;

  const stageName = STAGES[stageIndex];
  const stampClass = stageIndex === 2 ? ' stage-progress' : stageIndex === 3 ? ' stage-resolved' : '';
  stampEl.className = 'stamp' + stampClass;
  stampEl.innerHTML = `<span class="status-dot ${heroStatusDotClass(stageIndex)}"></span>${stageName}`;

  trackEl.innerHTML = STAGES.map((_, i) => `<span class="dot${i <= stageIndex ? ' on' : ''}"></span>`).join('');
  noteEl.textContent = HERO_NOTES[stageIndex];
}

function startHeroDemo() {
  if (!document.getElementById('heroStamp')) return;
  let stageIndex = 0;
  renderHeroStage(stageIndex);
  setInterval(() => {
    stageIndex = (stageIndex + 1) % STAGES.length;
    renderHeroStage(stageIndex);
  }, 2200);
}

/* ---------------- Auth ---------------- */

function isValidCollegeId(id) {
  return /^VTU.{5}$/i.test(id) && id.length === 8;
}

function validateCollegeIdField(input, hintId) {
  const val = input.value.trim().toUpperCase();
  const hint = document.getElementById(hintId || 'regCollegeIdHint');
  if (!hint) return;
  if (val.length === 0) {
    hint.className = 'field-hint';
    hint.innerHTML = 'Starts with <b>VTU</b>, followed by 5 characters (8 total).';
    return;
  }
  if (isValidCollegeId(val)) {
    hint.className = 'field-hint ok';
    hint.textContent = 'Looks good.';
  } else {
    hint.className = 'field-hint err';
    hint.textContent = 'Must start with VTU followed by 5 characters — 8 total (e.g. VTU28243).';
  }
}

/* Staff (department) college IDs use a separate TTS prefix, e.g. TTS12345 —
   case doesn't matter, but staff must never register with a VTU (student) ID. */
function isValidStaffCollegeId(id) {
  return /^TTS.{5}$/i.test(id) && id.length === 8;
}

function validateStaffCollegeIdField(input, hintId) {
  const val = input.value.trim().toUpperCase();
  const hint = document.getElementById(hintId || 'adminRegCollegeIdHint');
  if (!hint) return;
  if (val.length === 0) {
    hint.className = 'field-hint';
    hint.innerHTML = 'Starts with <b>TTS</b>, followed by 5 characters (8 total).';
    return;
  }
  if (isValidStaffCollegeId(val)) {
    hint.className = 'field-hint ok';
    hint.textContent = 'Looks good.';
  } else if (val.startsWith('VTU')) {
    hint.className = 'field-hint err';
    hint.textContent = "That's a student ID. Staff accounts use a TTS ID, e.g. TTS12345.";
  } else {
    hint.className = 'field-hint err';
    hint.textContent = 'Must start with TTS followed by 5 characters — 8 total (e.g. TTS12345).';
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* Eye icon: toggle a password field between hidden/visible */
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.classList.toggle('is-visible', show);
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

async function handleLogin(event) {
  event.preventDefault();
  const collegeId = document.getElementById('loginCollegeId').value.trim().toUpperCase();
  const password = document.getElementById('loginPassword').value;
  const btn = document.querySelector('#loginForm .auth-submit');

  setBtnLoading(btn, true);
  try {
    const data = await api('/api/login', { method: 'POST', body: { collegeId, password } });
    currentUser = data.user;
    await loadMyTickets();
    enterDashboard();
  } catch (err) {
    showToast(err.message);
    shakeElement(document.getElementById('loginForm'));
  } finally {
    setBtnLoading(btn, false);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const collegeId = document.getElementById('regCollegeId').value.trim().toUpperCase();
  const hostel = document.getElementById('regHostel').value;
  const password = document.getElementById('regPassword').value;

  if (!name || !email || !collegeId || !hostel || !password) {
    showToast('Please fill in every field.');
    return;
  }
  if (!isValidCollegeId(collegeId)) {
    showToast('College ID must start with VTU and be exactly 8 characters.');
    validateCollegeIdField(document.getElementById('regCollegeId'));
    return;
  }
  if (!isValidEmail(email)) {
    showToast('Enter a valid email address.');
    return;
  }
  if (!HOSTELS.includes(hostel)) {
    showToast('Please select a hostel from the list.');
    return;
  }

  const btn = document.querySelector('#registerForm .auth-submit');
  setBtnLoading(btn, true);
  try {
    const data = await api('/api/register', { method: 'POST', body: { name, email, collegeId, hostel, password } });
    currentUser = data.user;
    ticketsCache = [];
    enterDashboard();
  } catch (err) {
    showToast(err.message);
    shakeElement(document.getElementById('registerForm'));
  } finally {
    setBtnLoading(btn, false);
  }
}

/* Step 1 — request a code */
async function handleForgot(event) {
  event.preventDefault();
  const collegeId = document.getElementById('forgotCollegeId').value.trim().toUpperCase();
  const btn = document.getElementById('forgotSubmitBtn');

  setBtnLoading(btn, true);
  btn.textContent = 'Sending…';
  try {
    const data = await api('/api/forgot', { method: 'POST', body: { collegeId } });
    pendingReset = { collegeId, maskedEmail: data.maskedEmail };

    const target = document.getElementById('otpEmailTarget');
    if (target) target.textContent = data.maskedEmail;
    resetOtpBoxes();

    // The code itself never comes back in this response — it only ever
    // travels over the real email the server just sent. If SMTP isn't
    // configured yet (local dev), the server logs it to its own terminal
    // instead; either way the browser only learns whether sending worked.
    showToast(
      data.emailed
        ? 'Code sent to ' + data.maskedEmail + ' — check your inbox.'
        : 'Email isn\u2019t configured yet — check the server terminal for the code (dev mode).'
    );
    switchView('view-forgot', 'view-forgot-otp');
  } catch (err) {
    showToast(err.message);
    shakeElement(document.getElementById('forgotForm'));
  } finally {
    setBtnLoading(btn, false);
    btn.textContent = 'Send code';
  }
}

/* Step 2 — verify the code, using individual OTP boxes */
function resetOtpBoxes() {
  const boxes = document.querySelectorAll('.otp-box');
  boxes.forEach(b => { b.value = ''; b.classList.remove('err'); });
  if (boxes[0]) boxes[0].focus();
}

function wireOtpBoxes() {
  const boxes = Array.from(document.querySelectorAll('.otp-box'));
  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/[^0-9]/g, '').slice(0, 1);
      box.classList.remove('err');
      if (box.value && boxes[i + 1]) boxes[i + 1].focus();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && boxes[i - 1]) {
        boxes[i - 1].focus();
      }
    });
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData.getData('text') || '').replace(/[^0-9]/g, '').slice(0, boxes.length);
      text.split('').forEach((ch, idx) => { if (boxes[idx]) boxes[idx].value = ch; });
      const next = boxes[Math.min(text.length, boxes.length - 1)];
      if (next) next.focus();
    });
  });
}

async function handleVerifyOtp(event) {
  event.preventDefault();
  if (!pendingReset) { switchView('view-forgot-otp', 'view-forgot'); return; }

  const boxes = Array.from(document.querySelectorAll('.otp-box'));
  const entered = boxes.map(b => b.value).join('');
  const btn = document.getElementById('otpSubmitBtn');

  if (entered.length < 6) {
    boxes.forEach(b => b.classList.add('err'));
    shakeElement(document.getElementById('otpRow'));
    showToast('Enter all 6 digits first.');
    return;
  }

  setBtnLoading(btn, true);
  try {
    const data = await api('/api/forgot/verify', { method: 'POST', body: { collegeId: pendingReset.collegeId, otp: entered } });
    pendingReset.resetToken = data.resetToken;
    showToast('Code verified.');
    switchView('view-forgot-otp', 'view-forgot-reset');
  } catch (err) {
    boxes.forEach(b => b.classList.add('err'));
    shakeElement(document.getElementById('otpRow'));
    showToast(err.message);
  } finally {
    setBtnLoading(btn, false);
  }
}

async function handleResendOtp() {
  if (!pendingReset) return;
  try {
    const data = await api('/api/forgot', { method: 'POST', body: { collegeId: pendingReset.collegeId } });
    pendingReset.maskedEmail = data.maskedEmail;
    resetOtpBoxes();
    showToast(
      data.emailed
        ? 'New code sent to ' + data.maskedEmail + ' — check your inbox.'
        : 'Email isn\u2019t configured yet — check the server terminal for the code (dev mode).'
    );
  } catch (err) {
    showToast(err.message);
  }
}

/* Step 3 — set the new password */
async function handleResetPassword(event) {
  event.preventDefault();
  if (!pendingReset || !pendingReset.resetToken) {
    showToast('Please verify your code first.');
    switchView('view-forgot-reset', 'view-forgot');
    return;
  }

  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (!newPassword || newPassword.length < 4) {
    showToast('Password must be at least 4 characters.');
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast('Passwords don\u2019t match.');
    shakeElement(document.getElementById('resetPasswordForm'));
    return;
  }

  const btn = document.querySelector('#resetPasswordForm .auth-submit');
  setBtnLoading(btn, true);
  try {
    await api('/api/reset-password', {
      method: 'POST',
      body: { collegeId: pendingReset.collegeId, resetToken: pendingReset.resetToken, newPassword }
    });
    showToast('Password updated — please log in.');

    const collegeId = pendingReset.collegeId;
    pendingReset = null;
    document.getElementById('resetPasswordForm').reset();
    document.getElementById('loginCollegeId').value = collegeId;
    switchView('view-forgot-reset', 'view-login');
  } catch (err) {
    showToast(err.message);
    shakeElement(document.getElementById('resetPasswordForm'));
    if (err.status === 400) switchView('view-forgot-reset', 'view-forgot'); // token expired — start over
  } finally {
    setBtnLoading(btn, false);
  }
}

function shakeElement(el) {
  if (!el) return;
  el.classList.remove('shake');
  // eslint-disable-next-line no-unused-expressions
  void el.offsetWidth; // restart animation
  el.classList.add('shake');
}

async function handleLogout() {
  try { await api('/api/logout', { method: 'POST' }); } catch (err) { /* clear local state regardless */ }
  currentUser = null;
  ticketsCache = [];
  switchView('view-dashboard', 'view-landing');
  showToast('Logged out.');
}

/* ---------------- Dashboard ---------------- */
function enterDashboard() {
  hideAllViewsExcept('view-dashboard');

  activeFilterCategory = 'All';
  activeSearch = '';
  document.getElementById('dashWelcome').textContent = 'Welcome back, ' + currentUser.name.split(' ')[0];
  document.getElementById('dashUserName').textContent = currentUser.name;
  document.getElementById('dashUserSub').textContent = 'Student · ' + currentUser.hostel;
  document.getElementById('dashAvatar').textContent = initials(currentUser.name);
  document.getElementById('dashSideFoot').textContent = 'Logged in as Student · College ID ' + currentUser.collegeId;

  renderStatGrid();
  renderFilterRow();
  renderTicketList();

  const badge = document.getElementById('bellBadge');
  if (badge) badge.classList.toggle('show', !notifSeen && myTickets().length > 0);
}

function initials(name) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function goToDashboardHome() {
  activeFilterCategory = 'All';
  activeSearch = '';
  const searchInput = document.querySelector('.search input');
  if (searchInput) searchInput.value = '';
  renderStatGrid();
  renderFilterRow();
  renderTicketList();
}

/* Loaded once at login/register/session-resume, refreshed after filing a
   new complaint. Filtering/searching below runs client-side against this
   cache — no need to round-trip to the server for every keystroke. */
async function loadMyTickets() {
  try {
    const data = await api('/api/complaints');
    ticketsCache = data.complaints || [];
  } catch (err) {
    ticketsCache = [];
    showToast(err.message || 'Could not load your complaints.');
  }
}

function myTickets() {
  return ticketsCache;
}

function renderStatGrid() {
  const tickets = myTickets();
  const counts = { total: tickets.length, open: 0, progress: 0, resolved: 0 };
  tickets.forEach(t => {
    if (t.stageIndex === 3) counts.resolved++;
    else if (t.stageIndex === 2) counts.progress++;
    else counts.open++;
  });

  const cards = [
    { label: 'Total complaints', num: counts.total, dot: null },
    { label: 'Awaiting routing', num: counts.open, dot: 'dot-red' },
    { label: 'In progress', num: counts.progress, dot: 'icon-progress' },
    { label: 'Resolved', num: counts.resolved, dot: 'dot-green' }
  ];

  document.getElementById('statGrid').innerHTML = cards.map(c => `
    <div class="stat-card">
      <div class="stat-num">${c.num}</div>
      <div class="stat-label">${c.dot === 'icon-progress' ? progressIcon() : c.dot ? `<span class="status-dot ${c.dot}"></span>` : ''}${c.label}</div>
    </div>
  `).join('');
}

function renderFilterRow() {
  const cats = ['All', ...CATEGORIES];
  document.getElementById('filterRow').innerHTML = cats.map(c => {
    const icon = c === 'All' ? '' : categoryIcon(c, 13);
    return `<span class="filter-pill${c === activeFilterCategory ? ' active' : ''}" onclick="setFilterCategory('${c.replace(/'/g, "\\'")}')">${icon}${c}</span>`;
  }).join('');
}

function setFilterCategory(cat) {
  activeFilterCategory = cat;
  renderFilterRow();
  renderTicketList();
}

function filterTickets(value) {
  activeSearch = value.toLowerCase();
  renderTicketList();
}

function tkStripClass(category) {
  const meta = CATEGORY_META[category] || CATEGORY_META['General'];
  return `linear-gradient(180deg, ${meta.color}, ${meta.color}cc)`;
}

function renderTicketList() {
  let tickets = myTickets();

  if (activeFilterCategory !== 'All') {
    tickets = tickets.filter(t => t.category === activeFilterCategory);
  }
  if (activeSearch) {
    tickets = tickets.filter(t =>
      t.title.toLowerCase().includes(activeSearch) ||
      t.description.toLowerCase().includes(activeSearch) ||
      t.category.toLowerCase().includes(activeSearch)
    );
  }
  tickets = [...tickets].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const list = document.getElementById('ticketList');
  if (tickets.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>No complaints match this view</h3>
        <div>Try a different filter, or raise a new complaint to get started.</div>
      </div>`;
    return;
  }

  list.innerHTML = tickets.map((t, i) => {
    const stageName = STAGES[t.stageIndex];
    const stampClass = t.stageIndex === 2 ? ' stage-progress' : t.stageIndex === 3 ? ' stage-resolved' : '';
    const dotClass = statusDotClass(t.stageIndex);
    const trackDots = STAGES.map((_, i) => `<span class="dot${i <= t.stageIndex ? ' on' : ''}"></span>`).join('');

    return `
    <div class="tk-card" style="animation-delay:${Math.min(i, 8) * 50}ms">
      <div class="tk-strip" style="background:${tkStripClass(t.category)}"></div>
      <div class="tk-body">
        <div class="tk-top">
          <div>
            <div class="tk-id mono">${t.id}</div>
            <div class="tk-title">${escapeHtml(t.title)}</div>
            <div class="tk-meta">
              <span class="tk-cat" style="--chip-color:${(CATEGORY_META[t.category] || CATEGORY_META['General']).color}">${categoryIcon(t.category, 12)}${t.category}</span>
              <span>${fmtDate(t.createdAt)}</span>
              <span>${escapeHtml(t.officer)}</span>
            </div>
          </div>
          <span class="stamp${stampClass}"><span class="status-dot ${dotClass}"></span>${stageName}</span>
        </div>
        <p class="tk-desc">${escapeHtml(t.description)}</p>
        ${t.aiSummary ? `<div class="ai-ticket-meta"><strong>AI summary:</strong> ${escapeHtml(t.aiSummary)} <span class="ai-priority">${escapeHtml(t.aiPriority || 'Unrated')} priority</span></div>` : ''}
        <div class="tk-track"><div class="stage-track">${trackDots}</div></div>
        <div class="ticket-note" style="border-top:1px solid var(--line); padding-top:10px; margin-top:4px;">${escapeHtml(t.note)}</div>
        <div class="admin-controls"><button class="btn btn-ghost small btn-delete" onclick="deleteStudentComplaint('${t.id.replace(/'/g, "\\'")}')">Delete</button></div>
      </div>
    </div>`;
  }).join('');
}

function toggleMobileNav() {
  const menu = document.getElementById('mobileNav');
  const toggle = document.getElementById('mobileNavToggle');
  if (!menu || !toggle) return;
  const open = menu.classList.toggle('open');
  toggle.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}

function closeMobileNav() {
  const menu = document.getElementById('mobileNav');
  const toggle = document.getElementById('mobileNavToggle');
  if (!menu || !toggle) return;
  menu.classList.remove('open');
  toggle.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open menu');
}

async function deleteStudentComplaint(code) {
  if (!confirm(`Delete ${code}? This cannot be undone.`)) return;
  try {
    await api('/api/complaints/' + encodeURIComponent(code), { method: 'DELETE' });
    ticketsCache = ticketsCache.filter(t => t.id !== code);
    goToDashboardHome();
    showToast(code + ' deleted.');
  } catch (err) { showToast(err.message); }
}

/* Traffic-light status color: red = not started yet, orange = work underway, green = done */
function statusDotClass(stageIndex) {
  if (stageIndex >= 3) return 'dot-green';
  if (stageIndex === 2) return 'dot-orange';
  return 'dot-red';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ---------------- Modals ---------------- */
function openModal(html, isWide = false) {
  const content = document.getElementById('modalContent');
  content.innerHTML = html;
  content.classList.toggle('modal-lg', Boolean(isWide));
  const backdrop = document.getElementById('modalBackdrop');
  backdrop.classList.remove('closing');
  backdrop.classList.add('show');
}
function closeModal() {
  const backdrop = document.getElementById('modalBackdrop');
  backdrop.classList.add('closing');
  setTimeout(() => {
    backdrop.classList.remove('show', 'closing');
    const content = document.getElementById('modalContent');
    content.innerHTML = '';
    content.classList.remove('modal-lg');
    stagedPhotoDataUrl = null;
  }, 160);
}

/* New complaint modal */
function openNewComplaintForm() {
  if (!currentUser) {
    showToast('Please log in to raise a complaint.');
    switchView('view-landing', 'view-login');
    return;
  }
  stagedPhotoDataUrl = null;
  openModal(`
    <h3>Raise a complaint</h3>
    <p class="modal-sub">This reaches the right department automatically — no need to pick who it goes to.</p>
    <div class="field">
      <label>Category</label>
      <select id="ncCategory">
        ${CATEGORIES.map(c => `<option value="${c}">${dropdownLabel(c)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Subject</label>
      <input type="text" id="ncTitle" placeholder="Short summary of the issue">
    </div>
    <div class="field">
      <label>Details</label>
      <textarea id="ncDesc" rows="4" placeholder="What happened, where, and when?"></textarea>
    </div>
    <button type="button" class="btn btn-ghost ai-analyze-btn" onclick="analyzeNewComplaint()">Analyze with AI</button>
    <div id="ncAiResult" class="ai-result" aria-live="polite"></div>
    <div class="field">
      <label>Photo (optional)</label>
      <div class="photo-drop" id="ncPhotoDrop" onclick="document.getElementById('ncPhotoInput').click()">Click to attach a photo</div>
      <input type="file" id="ncPhotoInput" accept="image/*" style="display:none" onchange="handleNcPhoto(event)">
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitNewComplaint()">Submit complaint</button>
    </div>
  `);
}

async function analyzeNewComplaint() {
  const title = document.getElementById('ncTitle').value.trim();
  const description = document.getElementById('ncDesc').value.trim();
  if (!title || !description) { showToast('Add a subject and description first.'); return; }
  const button = document.querySelector('.ai-analyze-btn');
  setBtnLoading(button, true);
  try {
    const { analysis } = await api('/api/complaints/analyze', { method: 'POST', body: { title, description } });
    document.getElementById('ncCategory').value = analysis.category;
    document.getElementById('ncAiResult').innerHTML = `
      <strong>AI suggestion</strong>
      <span>Category: ${escapeHtml(analysis.category)} (${analysis.confidence}% confidence)</span>
      <span>Priority: ${escapeHtml(analysis.priority)}</span>
      <span>Summary: ${escapeHtml(analysis.summary)}</span>
      ${analysis.duplicate ? `<span>Possible duplicate: ${escapeHtml(analysis.duplicate.complaintCode)} (${analysis.duplicate.similarity}% similar)</span>` : '<span>No similar open complaint found.</span>'}
      <small>You can change the suggested category before submitting.</small>`;
    document.getElementById('ncAiResult').classList.add('show');
  } catch (err) {
    showToast(err.message);
  } finally {
    setBtnLoading(button, false);
  }
}

function handleNcPhoto(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    stagedPhotoDataUrl = e.target.result;
    document.getElementById('ncPhotoDrop').textContent = 'Photo attached — ' + file.name;
  };
  reader.readAsDataURL(file);
}

async function submitNewComplaint() {
  if (!currentUser) {
    showToast('Please log in to raise a complaint.');
    closeModal();
    switchView('view-landing', 'view-login');
    return;
  }
  const category = document.getElementById('ncCategory').value;
  const title = document.getElementById('ncTitle').value.trim();
  const description = document.getElementById('ncDesc').value.trim();

  if (!title || !description) {
    showToast('Add a subject and description first.');
    return;
  }

  const btn = document.querySelector('.modal-actions .btn-primary');
  setBtnLoading(btn, true);
  try {
    const data = await api('/api/complaints', {
      method: 'POST',
      body: { category, title, description, photo: stagedPhotoDataUrl }
    });
    ticketsCache.unshift(data.complaint);
    closeModal();
    showToast('Complaint filed — ' + data.complaint.id);
    goToDashboardHome();
  } catch (err) {
    showToast(err.message);
    setBtnLoading(btn, false);
  }
}

/* Notifications modal */
function openNotificationsModal() {
  if (!currentUser) return;
  notifSeen = true;
  document.getElementById('bellBadge').classList.remove('show');

  const tickets = myTickets();
  const items = tickets.slice(0, 4).map(t => ({
    text: `${t.id} — now "${STAGES[t.stageIndex]}": ${t.note}`,
    time: fmtDate(t.createdAt)
  }));

  openModal(`
    <h3>Notifications</h3>
    <p class="modal-sub">Updates on complaints you've raised.</p>
    ${items.length === 0
      ? '<div class="empty-state"><h3>Nothing yet</h3><div>Updates on your complaints will show up here.</div></div>'
      : items.map(n => `
        <div class="notif-item">
          <span class="notif-dot"></span>
          <div>
            <div>${escapeHtml(n.text)}</div>
            <div class="notif-time">${n.time}</div>
          </div>
        </div>`).join('')
    }
    <div class="modal-actions"><button class="btn btn-ghost" style="width:100%" onclick="closeModal()">Close</button></div>
  `);
}

/* Settings modal */
function openSettingsModal() {
  if (!currentUser) return;
  openModal(`
    <h3>Settings</h3>
    <p class="modal-sub">Update your profile details.</p>
    <div class="field"><label>Full name</label><input type="text" id="setName" value="${escapeHtml(currentUser.name)}"></div>
    <div class="field">
      <label>Hostel</label>
      <select id="setHostel">
        ${HOSTELS.map(h => `<option value="${h}"${h === currentUser.hostel ? ' selected' : ''}>${dropdownLabel(h)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>New password</label>
      <div class="pw-wrap">
        <input type="password" id="setPassword" placeholder="Leave blank to keep current password">
        <button type="button" class="eye-toggle" aria-label="Show password" onclick="togglePasswordVisibility('setPassword', this)">
          <svg class="eye-icon" viewBox="0 0 24 24" fill="none"><path class="eye-open" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle class="eye-open" cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path class="eye-closed" d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M7.4 7.5C4.9 8.9 3 12 3 12s4 7 11 7c1.6 0 3-.35 4.2-.9M16.7 6.4C15.3 5.6 13.7 5 12 5c-.5 0-1 .04-1.5.13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveSettings()">Save changes</button>
    </div>
  `);
}

async function saveSettings() {
  const name = document.getElementById('setName').value.trim();
  const hostel = document.getElementById('setHostel').value;
  const password = document.getElementById('setPassword').value;

  if (!name || !hostel) { showToast('Name and hostel can\u2019t be empty.'); return; }

  const btn = document.querySelector('.modal-actions .btn-primary');
  setBtnLoading(btn, true);
  try {
    const data = await api('/api/me', {
      method: 'PATCH',
      body: { name, hostel, password: password || undefined }
    });
    currentUser = data.user;

    document.getElementById('dashUserName').textContent = currentUser.name;
    document.getElementById('dashUserSub').textContent = 'Student · ' + currentUser.hostel;
    document.getElementById('dashAvatar').textContent = initials(currentUser.name);

    closeModal();
    showToast('Settings saved.');
  } catch (err) {
    showToast(err.message);
    setBtnLoading(btn, false);
  }
}

/* =======================================================================
   DEPARTMENT STAFF (admin) — separate login from students. Registration
   always lands 'pending' with no department; only the super admin panel
   below can approve an account and assign it a department. An approved
   admin only ever sees /api/admin/complaints, which the server already
   scopes to their department — nothing category-based happens client-side.
   ======================================================================= */

async function handleAdminRegister(event) {
  event.preventDefault();
  const name = document.getElementById('adminRegName').value.trim();
  const email = document.getElementById('adminRegEmail').value.trim();
  const collegeId = document.getElementById('adminRegCollegeId').value.trim().toUpperCase();
  const requestedDepartment = document.getElementById('adminRegDepartment').value;
  const password = document.getElementById('adminRegPassword').value;

  if (!name || !email || !collegeId || !requestedDepartment || !password) {
    showToast('Please fill in every field.');
    return;
  }
  if (!isValidStaffCollegeId(collegeId)) {
    if (collegeId.startsWith('VTU')) {
      showToast("That's a student ID. Staff must register with a TTS College ID, e.g. TTS12345.");
    } else {
      showToast('College ID must start with TTS and be exactly 8 characters.');
    }
    validateStaffCollegeIdField(document.getElementById('adminRegCollegeId'), 'adminRegCollegeIdHint');
    return;
  }
  if (!isValidEmail(email)) {
    showToast('Enter a valid email address.');
    return;
  }

  const btn = document.querySelector('#adminRegisterForm .auth-submit');
  setBtnLoading(btn, true);
  try {
    await api('/api/admin/register', { method: 'POST', body: { name, email, collegeId, password, requestedDepartment } });
    document.getElementById('adminRegisterForm').reset();
    switchView('view-admin-register', 'view-admin-pending');
  } catch (err) {
    showToast(err.message);
    shakeElement(document.getElementById('adminRegisterForm'));
  } finally {
    setBtnLoading(btn, false);
  }
}

async function handleAdminLogin(event) {
  event.preventDefault();
  const collegeId = document.getElementById('adminLoginCollegeId').value.trim().toUpperCase();
  const password = document.getElementById('adminLoginPassword').value;
  const btn = document.querySelector('#adminLoginForm .auth-submit');

  setBtnLoading(btn, true);
  try {
    const data = await api('/api/admin/login', { method: 'POST', body: { collegeId, password } });
    currentAdmin = data.admin;
    await loadAdminTickets();
    enterAdminDashboard();
  } catch (err) {
    showToast(err.message);
    shakeElement(document.getElementById('adminLoginForm'));
  } finally {
    setBtnLoading(btn, false);
  }
}

async function handleAdminLogout() {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch (err) { /* clear local state regardless */ }
  currentAdmin = null;
  adminTicketsCache = [];
  switchView('view-admin-dashboard', 'view-admin-login');
  showToast('Logged out.');
}

const ALL_VIEW_IDS = [
  'view-landing', 'view-login', 'view-register', 'view-forgot', 'view-forgot-otp', 'view-forgot-reset',
  'view-dashboard', 'view-admin-login', 'view-admin-register', 'view-admin-pending', 'view-admin-dashboard',
  'view-superadmin-login', 'view-superadmin-dashboard', 'view-superadmin-search'
];

function hideAllViewsExcept(visibleId) {
  ALL_VIEW_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === visibleId) ? '' : 'none';
  });
}

function enterAdminDashboard() {
  hideAllViewsExcept('view-admin-dashboard');

  activeAdminFilterStage = 'All';
  activeAdminSearch = '';
  document.getElementById('adminWelcome').textContent = 'Welcome back, ' + currentAdmin.name.split(' ')[0];
  document.getElementById('adminUserName').textContent = currentAdmin.name;
  document.getElementById('adminUserSub').textContent = currentAdmin.department + ' desk';
  document.getElementById('adminAvatar').textContent = initials(currentAdmin.name);
  document.getElementById('adminSideFoot').textContent = 'Logged in as ' + currentAdmin.department + ' staff · College ID ' + currentAdmin.collegeId;

  renderAdminStatGrid();
  renderAdminFilterRow();
  renderAdminTicketList();
}

function goToAdminDashboardHome() {
  activeAdminFilterStage = 'All';
  activeAdminSearch = '';
  const searchInput = document.querySelector('#view-admin-dashboard .search input');
  if (searchInput) searchInput.value = '';
  renderAdminStatGrid();
  renderAdminFilterRow();
  renderAdminTicketList();
}

async function loadAdminTickets() {
  try {
    const data = await api('/api/admin/complaints');
    adminTicketsCache = data.complaints || [];
  } catch (err) {
    adminTicketsCache = [];
    showToast(err.message || 'Could not load department complaints.');
  }
}

function renderAdminStatGrid() {
  const tickets = adminTicketsCache;
  const counts = { total: tickets.length, open: 0, progress: 0, resolved: 0 };
  tickets.forEach(t => {
    if (t.stageIndex === 3) counts.resolved++;
    else if (t.stageIndex === 2) counts.progress++;
    else counts.open++;
  });

  const cards = [
    { label: 'Total complaints', num: counts.total, dot: null },
    { label: 'Awaiting action', num: counts.open, dot: 'dot-red' },
    { label: 'In progress', num: counts.progress, dot: 'icon-progress' },
    { label: 'Resolved', num: counts.resolved, dot: 'dot-green' }
  ];

  document.getElementById('adminStatGrid').innerHTML = cards.map(c => `
    <div class="stat-card">
      <div class="stat-num">${c.num}</div>
      <div class="stat-label">${c.dot === 'icon-progress' ? progressIcon() : c.dot ? `<span class="status-dot ${c.dot}"></span>` : ''}${c.label}</div>
    </div>
  `).join('');
}

function renderAdminFilterRow() {
  const stages = ['All', ...STAGES];
  document.getElementById('adminFilterRow').innerHTML = stages.map(s =>
    `<span class="filter-pill${s === activeAdminFilterStage ? ' active' : ''}" onclick="setAdminFilterStage('${s.replace(/'/g, "\\'")}')">${s}</span>`
  ).join('');
}

function setAdminFilterStage(stage) {
  activeAdminFilterStage = stage;
  renderAdminFilterRow();
  renderAdminTicketList();
}

function filterAdminTickets(value) {
  activeAdminSearch = value.toLowerCase();
  renderAdminTicketList();
}

function renderAdminTicketList() {
  let tickets = adminTicketsCache;

  if (activeAdminFilterStage !== 'All') {
    const stageIdx = STAGES.indexOf(activeAdminFilterStage);
    tickets = tickets.filter(t => t.stageIndex === stageIdx);
  }
  if (activeAdminSearch) {
    tickets = tickets.filter(t =>
      t.title.toLowerCase().includes(activeAdminSearch) ||
      t.description.toLowerCase().includes(activeAdminSearch) ||
      t.id.toLowerCase().includes(activeAdminSearch)
    );
  }
  tickets = [...tickets].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const list = document.getElementById('adminTicketList');
  if (tickets.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>No complaints match this view</h3>
        <div>Try a different filter — nothing routed to your department fits it right now.</div>
      </div>`;
    return;
  }

  list.innerHTML = tickets.map((t, i) => {
    const stageName = STAGES[t.stageIndex];
    const stampClass = t.stageIndex === 2 ? ' stage-progress' : t.stageIndex === 3 ? ' stage-resolved' : '';
    const dotClass = statusDotClass(t.stageIndex);
    const trackDots = STAGES.map((_, si) => `<span class="dot${si <= t.stageIndex ? ' on' : ''}"></span>`).join('');
    const safeId = t.id.replace(/[^A-Za-z0-9_-]/g, '');

    return `
    <div class="tk-card" style="animation-delay:${Math.min(i, 8) * 50}ms">
      <div class="tk-strip" style="background:${tkStripClass(t.category)}"></div>
      <div class="tk-body">
        <div class="tk-top">
          <div>
            <div class="tk-id mono">${t.id}</div>
            <div class="tk-title">${escapeHtml(t.title)}</div>
            <div class="tk-meta"><span>${fmtDate(t.createdAt)}</span></div>
          </div>
          <span class="stamp${stampClass}"><span class="status-dot ${dotClass}"></span>${stageName}</span>
        </div>
        <p class="tk-desc">${escapeHtml(t.description)}</p>
        ${t.aiSummary ? `<div class="ai-ticket-meta"><strong>AI summary:</strong> ${escapeHtml(t.aiSummary)} <span class="ai-priority">${escapeHtml(t.aiPriority || 'Unrated')} priority</span>${t.possibleDuplicate ? ` · Possible duplicate: ${escapeHtml(t.possibleDuplicate.complaintCode)}` : ''}</div>` : ''}
        <div class="tk-track"><div class="stage-track">${trackDots}</div></div>
        <div class="ticket-note" style="border-top:1px solid var(--line); padding-top:10px; margin-top:4px;">${escapeHtml(t.note)}</div>
        <div class="admin-controls">
          <select id="stageSelect-${safeId}">
            ${STAGES.map((s, si) => `<option value="${si}"${si === t.stageIndex ? ' selected' : ''}>${dropdownLabel(s)}</option>`).join('')}
          </select>
          <input type="text" id="noteInput-${safeId}" placeholder="Add an update note (optional)">
          <button class="btn btn-primary small" onclick="submitAdminStageUpdate('${t.id.replace(/'/g, "\\'")}')">Update</button>
          <button class="btn btn-ghost small btn-delete" onclick="deleteAdminComplaint('${t.id.replace(/'/g, "\\'")}')">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function deleteAdminComplaint(code) {
  if (!confirm(`Delete ${code}? This cannot be undone.`)) return;
  try {
    await api('/api/admin/complaints/' + encodeURIComponent(code), { method: 'DELETE' });
    adminTicketsCache = adminTicketsCache.filter(t => t.id !== code);
    renderAdminStatGrid();
    renderAdminTicketList();
    showToast(code + ' deleted.');
  } catch (err) { showToast(err.message); }
}

async function submitAdminStageUpdate(code) {
  const safeId = code.replace(/[^A-Za-z0-9_-]/g, '');
  const select = document.getElementById('stageSelect-' + safeId);
  const noteInput = document.getElementById('noteInput-' + safeId);
  const stageIndex = parseInt(select.value, 10);
  const note = noteInput.value.trim();

  try {
    const data = await api('/api/admin/complaints/' + encodeURIComponent(code), {
      method: 'PATCH',
      body: { stageIndex, note: note || undefined }
    });
    const idx = adminTicketsCache.findIndex(t => t.id === code);
    if (idx !== -1) adminTicketsCache[idx] = data.complaint;
    showToast(code + ' updated.');
    renderAdminStatGrid();
    renderAdminTicketList();
  } catch (err) {
    showToast(err.message);
  }
}

/* =======================================================================
   SUPER ADMIN — key-gated (not a per-person account) panel to approve
   pending staff registrations and assign/reassign their department.
   ======================================================================= */

async function handleSuperAdminLogin(event) {
  event.preventDefault();
  const key = document.getElementById('superAdminKey').value;
  const btn = document.querySelector('#superAdminLoginForm .auth-submit');

  setBtnLoading(btn, true);
  try {
    await api('/api/superadmin/login', { method: 'POST', body: { key } });
    document.getElementById('superAdminLoginForm').reset();
    await enterSuperAdminDashboard();
  } catch (err) {
    showToast(err.message);
    shakeElement(document.getElementById('superAdminLoginForm'));
  } finally {
    setBtnLoading(btn, false);
  }
}

async function handleSuperAdminLogout() {
  try { await api('/api/superadmin/logout', { method: 'POST' }); } catch (err) { /* clear local state regardless */ }
  switchView('view-superadmin-dashboard', 'view-admin-login');
  showToast('Logged out.');
}

async function enterSuperAdminDashboard() {
  hideAllViewsExcept('view-superadmin-dashboard');
  await Promise.all([loadSuperAdminAdmins(), loadSuperAdminComplaints()]);
  renderSuperAdminAdmins();
  renderSuperAdminComplaints();
}

async function loadSuperAdminAdmins() {
  try {
    const data = await api('/api/superadmin/admins');
    superAdminAdmins = data.admins || [];
  } catch (err) {
    superAdminAdmins = [];
    showToast(err.message || 'Could not load staff accounts.');
  }
}

async function loadSuperAdminComplaints() {
  try {
    const data = await api('/api/superadmin/complaints');
    superAdminComplaints = data.complaints || [];
  } catch (err) {
    superAdminComplaints = [];
    showToast(err.message || 'Could not load complaints.');
  }
}

function renderSuperAdminComplaints() {
  const list = document.getElementById('superComplaintList');
  if (!list) return;
  if (superAdminComplaints.length === 0) {
    list.innerHTML = '<div class="empty-state"><h3>No complaints</h3><div>Complaints will appear here.</div></div>';
    return;
  }

  list.innerHTML = superAdminComplaints.map(t => {
    const stageName = STAGES[t.stageIndex] || 'Submitted';
    const stampClass = t.stageIndex === 2 ? ' stage-progress' : t.stageIndex === 3 ? ' stage-resolved' : '';
    const dotClass = statusDotClass(t.stageIndex);
    const safeId = t.id.replace(/'/g, "\\'");
    const studentInfo = t.studentName ? `${escapeHtml(t.studentName)} (${escapeHtml(t.studentCollegeId || '')})` : '';

    return `
      <div class="tk-card clickable" onclick="openSuperAdminComplaintModal('${safeId}')">
        <div class="tk-strip" style="background:${tkStripClass(t.category)}"></div>
        <div class="tk-body">
          <div class="tk-top">
            <div>
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                <span class="tk-id mono">${t.id}</span>
                <span class="stamp${stampClass}"><span class="status-dot ${dotClass}"></span>${stageName}</span>
              </div>
              <div class="tk-title">${escapeHtml(t.title)}</div>
              <p class="tk-desc" style="display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; font-size:13px; color:var(--text-soft); margin:6px 0 8px; line-height:1.5;">${escapeHtml(t.description)}</p>
              <div class="tk-meta">
                <span class="tk-cat" style="--chip-color:${(CATEGORY_META[t.category] || CATEGORY_META['General']).color}">${categoryIcon(t.category, 12)}${escapeHtml(t.category)}</span>
                <span>📅 ${fmtDate(t.createdAt)}</span>
                ${studentInfo ? `<span>👤 ${studentInfo}</span>` : ''}
              </div>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-end; flex-shrink:0;">
              <button type="button" class="btn btn-ghost small" onclick="event.stopPropagation(); openSuperAdminComplaintModal('${safeId}')">View details →</button>
              <button type="button" class="btn btn-ghost small btn-delete" onclick="event.stopPropagation(); deleteSuperAdminComplaint('${safeId}')">Delete</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openSuperAdminComplaintModal(code) {
  const t = superAdminComplaints.find(c => c.id === code);
  if (!t) return;

  const stageName = STAGES[t.stageIndex] || 'Submitted';
  const stampClass = t.stageIndex === 2 ? ' stage-progress' : t.stageIndex === 3 ? ' stage-resolved' : '';
  const dotClass = statusDotClass(t.stageIndex);

  const studentInfoHtml = (t.studentName || t.studentCollegeId) ? `
    <div class="detail-section-title">Student Information</div>
    <div class="detail-student-card">
      <div class="detail-student-item">
        <label>Student Name</label>
        <span>${escapeHtml(t.studentName || 'N/A')}</span>
      </div>
      <div class="detail-student-item">
        <label>College ID</label>
        <span>${escapeHtml(t.studentCollegeId || 'N/A')}</span>
      </div>
      <div class="detail-student-item">
        <label>Email</label>
        <span>${escapeHtml(t.studentEmail || 'N/A')}</span>
      </div>
      <div class="detail-student-item">
        <label>Hostel</label>
        <span>${escapeHtml(t.studentHostel || 'N/A')}</span>
      </div>
    </div>
  ` : '';

  const photoHtml = t.photo ? `
    <div class="detail-section-title">Attached Photo</div>
    <div style="text-align:center;">
      <img src="${t.photo}" class="detail-photo-preview" alt="Complaint Attachment">
    </div>
  ` : '';

  openModal(`
    <div class="modal-header-row">
      <div style="display:flex; align-items:center; gap:10px;">
        <span class="tk-id mono" style="font-size:16px; font-weight:700;">${t.id}</span>
        <span class="stamp${stampClass}"><span class="status-dot ${dotClass}"></span>${stageName}</span>
      </div>
      <button type="button" class="close-x-btn" onclick="closeModal()" aria-label="Close modal" title="Close (x)">&times;</button>
    </div>

    <h3 style="font-size:20px; margin-bottom:8px;">${escapeHtml(t.title)}</h3>
    <div class="tk-meta" style="margin-bottom:16px;">
      <span class="tk-cat" style="--chip-color:${(CATEGORY_META[t.category] || CATEGORY_META['General']).color}">${categoryIcon(t.category, 12)}${escapeHtml(t.category)}</span>
      <span>📅 ${fmtDate(t.createdAt)}</span>
    </div>

    <div class="detail-section-title">Complaint Description</div>
    <div class="detail-desc-box">${escapeHtml(t.description)}</div>

    ${photoHtml}
    ${studentInfoHtml}

    <div class="detail-section-title">Routing & Status</div>
    <div class="tk-student-info" style="margin-top:0;">
      <div><strong>Assigned Officer / Handler:</strong> ${escapeHtml(t.officer)}</div>
      <div style="margin-top:4px;"><strong>Department:</strong> ${escapeHtml(t.category)}</div>
      <div style="margin-top:4px;"><strong>Latest Progress Note:</strong> ${escapeHtml(t.note)}</div>
    </div>

    <div class="modal-actions" style="margin-top:24px;">
      <button class="btn btn-ghost btn-delete" onclick="deleteSuperAdminComplaintFromModal('${t.id.replace(/'/g, "\\'")}')">Delete complaint</button>
      <button class="btn btn-primary" onclick="closeModal()">Close</button>
    </div>
  `, true);
}

async function deleteSuperAdminComplaintFromModal(code) {
  closeModal();
  await deleteSuperAdminComplaint(code);
}

async function deleteSuperAdminComplaint(code) {
  if (!confirm(`Delete ${code}? This cannot be undone.`)) return;
  try {
    await api('/api/superadmin/complaints/' + encodeURIComponent(code), { method: 'DELETE' });
    superAdminComplaints = superAdminComplaints.filter(t => t.id !== code);
    renderSuperAdminComplaints();
    showToast(code + ' deleted.');
  } catch (err) { showToast(err.message); }
}

function renderSuperAdminAdmins() {
  const pending = superAdminAdmins.filter(a => a.status === 'pending');
  const approved = superAdminAdmins.filter(a => a.status === 'approved');

  document.getElementById('superStatGrid').innerHTML = `
    <div class="stat-card"><div class="stat-num">${superAdminAdmins.length}</div><div class="stat-label">Total staff accounts</div></div>
    <div class="stat-card"><div class="stat-num">${pending.length}</div><div class="stat-label"><span class="status-dot dot-red"></span>Pending approval</div></div>
    <div class="stat-card"><div class="stat-num">${approved.length}</div><div class="stat-label"><span class="status-dot dot-green"></span>Approved</div></div>
    <div class="stat-card"><div class="stat-num">${CATEGORIES.length}</div><div class="stat-label">Departments</div></div>
  `;

  const pendingList = document.getElementById('superPendingList');
  pendingList.innerHTML = pending.length === 0
    ? '<div class="empty-state"><h3>Nothing pending</h3><div>New staff registrations will show up here.</div></div>'
    : pending.map(a => `
      <div class="tk-card">
        <div class="tk-strip" style="background:${(CATEGORY_META[a.requestedDepartment] || CATEGORY_META['General']).color}"></div>
        <div class="tk-body">
          <div class="tk-top">
            <div>
              <div class="tk-title">${escapeHtml(a.name)}</div>
              <div class="tk-meta"><span>${escapeHtml(a.collegeId || '—')}</span><span>${escapeHtml(a.email)}</span><span>Requested: ${escapeHtml(a.requestedDepartment || 'General')}</span></div>
            </div>
            <span class="stamp"><span class="status-dot dot-red"></span>Pending</span>
          </div>
          <div class="admin-controls">
            <select id="approveDept-${a.id}">
              ${CATEGORIES.map(c => `<option value="${c}"${c === a.requestedDepartment ? ' selected' : ''}>${dropdownLabel(c)}</option>`).join('')}
            </select>
            <button class="btn btn-primary small" onclick="approveAdmin(${a.id})">Approve</button>
            <button class="btn btn-ghost small" onclick="rejectAdmin(${a.id})">Reject</button>
          </div>
        </div>
      </div>`).join('');

  const approvedList = document.getElementById('superApprovedList');
  approvedList.innerHTML = approved.length === 0
    ? '<div class="empty-state"><h3>No approved staff yet</h3><div>Approved accounts will show up here.</div></div>'
    : approved.map(a => `
      <div class="tk-card">
        <div class="tk-strip" style="background:${(CATEGORY_META[a.department] || CATEGORY_META['General']).color}"></div>
        <div class="tk-body">
          <div class="tk-top">
            <div>
              <div class="tk-title">${escapeHtml(a.name)}</div>
              <div class="tk-meta">
                <span>${escapeHtml(a.collegeId || '—')}</span>
                <span>${escapeHtml(a.email)}</span>
                <span class="tk-cat" style="--chip-color:${(CATEGORY_META[a.department] || CATEGORY_META['General']).color}">${categoryIcon(a.department, 12)}${a.department}</span>
              </div>
            </div>
            <span class="stamp stage-resolved"><span class="status-dot dot-green"></span>Approved</span>
          </div>
          <div class="admin-controls">
            <select id="reassignDept-${a.id}">
              ${CATEGORIES.map(c => `<option value="${c}"${c === a.department ? ' selected' : ''}>${dropdownLabel(c)}</option>`).join('')}
            </select>
            <button class="btn btn-primary small" onclick="reassignAdmin(${a.id})">Reassign</button>
            <button class="btn btn-ghost small" onclick="revokeAdmin(${a.id})">Revoke</button>
          </div>
        </div>
      </div>`).join('');
}

async function approveAdmin(id) {
  const department = document.getElementById('approveDept-' + id).value;
  try {
    await api('/api/superadmin/admins/' + id, { method: 'PATCH', body: { department, status: 'approved' } });
    showToast('Approved.');
    await loadSuperAdminAdmins();
    renderSuperAdminAdmins();
  } catch (err) {
    showToast(err.message);
  }
}

async function rejectAdmin(id) {
  try {
    await api('/api/superadmin/admins/' + id, { method: 'DELETE' });
    showToast('Registration rejected.');
    await loadSuperAdminAdmins();
    renderSuperAdminAdmins();
  } catch (err) {
    showToast(err.message);
  }
}

async function reassignAdmin(id) {
  const department = document.getElementById('reassignDept-' + id).value;
  try {
    await api('/api/superadmin/admins/' + id, { method: 'PATCH', body: { department, status: 'approved' } });
    showToast('Department updated.');
    await loadSuperAdminAdmins();
    renderSuperAdminAdmins();
  } catch (err) {
    showToast(err.message);
  }
}

async function revokeAdmin(id) {
  try {
    await api('/api/superadmin/admins/' + id, { method: 'PATCH', body: { status: 'pending' } });
    showToast('Access revoked — account is back in the pending list.');
    await loadSuperAdminAdmins();
    renderSuperAdminAdmins();
  } catch (err) {
    showToast(err.message);
  }
}

/* ---------------- Super admin: manage student/staff credentials ---------------- */

function enterSuperAdminUserSearch() {
  hideAllViewsExcept('view-superadmin-search');
  const input = document.getElementById('superAdminSearchInput');
  if (input) {
    // Keep whatever was typed last time, but don't re-render stale results
    // until the admin searches again.
    setTimeout(() => input.focus(), 0);
  }
}

async function handleSuperAdminPeopleSearch(event) {
  event.preventDefault();
  const input = document.getElementById('superAdminSearchInput');
  const q = (input.value || '').trim();
  const resultsEl = document.getElementById('superAdminSearchResults');
  const btn = document.querySelector('#superAdminSearchForm button[type="submit"]');

  if (!q) {
    showToast('Enter a College ID to search.');
    return;
  }

  setBtnLoading(btn, true);
  try {
    const data = await api('/api/superadmin/people/search?collegeId=' + encodeURIComponent(q));
    superAdminSearchResults = { students: data.students || [], staff: data.staff || [] };
    renderSuperAdminSearchResults();
  } catch (err) {
    resultsEl.innerHTML = '';
    showToast(err.message || 'Search failed.');
  } finally {
    setBtnLoading(btn, false);
  }
}

function renderSuperAdminSearchResults() {
  const resultsEl = document.getElementById('superAdminSearchResults');
  if (!resultsEl) return;

  const { students, staff } = superAdminSearchResults;

  if (students.length === 0 && staff.length === 0) {
    resultsEl.innerHTML = '<div class="empty-state"><h3>No matches</h3><div>No student or staff account has a College ID matching that search.</div></div>';
    return;
  }

  const studentCards = students.map(s => `
    <div class="tk-card">
      <div class="tk-strip" style="background:${CATEGORY_META['Hostel'].color}"></div>
      <div class="tk-body">
        <div class="tk-top">
          <div>
            <div class="tk-title">${escapeHtml(s.name)}</div>
            <div class="tk-meta"><span class="mono">${escapeHtml(s.collegeId)}</span><span>${escapeHtml(s.email)}</span><span>Student · ${escapeHtml(s.hostel)}</span></div>
          </div>
        </div>
        <div class="cred-edit-form">
          <div class="field">
            <label>Username (College ID)</label>
            <input type="text" id="studCollegeId-${s.id}" value="${escapeHtml(s.collegeId)}">
          </div>
          <div class="field">
            <label>Email</label>
            <input type="email" id="studEmail-${s.id}" value="${escapeHtml(s.email)}">
          </div>
          <div class="field">
            <label>New password <span style="font-weight:400; color:var(--text-soft);">(leave blank to keep current)</span></label>
            <input type="password" id="studPassword-${s.id}" placeholder="••••••••">
          </div>
          <button class="btn btn-primary small" onclick="saveSuperAdminStudentCredentials(${s.id})">Save changes</button>
        </div>
      </div>
    </div>
  `).join('');

  const staffCards = staff.map(a => `
    <div class="tk-card">
      <div class="tk-strip" style="background:${(CATEGORY_META[a.department] || CATEGORY_META['General']).color}"></div>
      <div class="tk-body">
        <div class="tk-top">
          <div>
            <div class="tk-title">${escapeHtml(a.name)}</div>
            <div class="tk-meta"><span class="mono">${escapeHtml(a.collegeId || '—')}</span><span>${escapeHtml(a.email)}</span><span>Staff · ${escapeHtml(a.department || a.requestedDepartment || 'Unassigned')}</span></div>
          </div>
          <span class="stamp${a.status === 'approved' ? ' stage-resolved' : ''}"><span class="status-dot ${a.status === 'approved' ? 'dot-green' : 'dot-red'}"></span>${a.status === 'approved' ? 'Approved' : 'Pending'}</span>
        </div>
        <div class="cred-edit-form">
          <div class="field">
            <label>Username (College ID)</label>
            <input type="text" id="staffCollegeId-${a.id}" value="${escapeHtml(a.collegeId || '')}">
          </div>
          <div class="field">
            <label>Email</label>
            <input type="email" id="staffEmail-${a.id}" value="${escapeHtml(a.email)}">
          </div>
          <div class="field">
            <label>New password <span style="font-weight:400; color:var(--text-soft);">(leave blank to keep current)</span></label>
            <input type="password" id="staffPassword-${a.id}" placeholder="••••••••">
          </div>
          <button class="btn btn-primary small" onclick="saveSuperAdminStaffCredentials(${a.id})">Save changes</button>
        </div>
      </div>
    </div>
  `).join('');

  resultsEl.innerHTML = `
    ${students.length ? `<div class="list-head" style="margin-top:24px;"><h2>Students (${students.length})</h2></div>${studentCards}` : ''}
    ${staff.length ? `<div class="list-head" style="margin-top:24px;"><h2>Staff (${staff.length})</h2></div>${staffCards}` : ''}
  `;
}

async function saveSuperAdminStudentCredentials(id) {
  const collegeId = document.getElementById('studCollegeId-' + id).value;
  const email = document.getElementById('studEmail-' + id).value;
  const password = document.getElementById('studPassword-' + id).value;

  try {
    const data = await api('/api/superadmin/students/' + id + '/credentials', {
      method: 'PATCH',
      body: { collegeId, email, password: password || undefined }
    });
    const idx = superAdminSearchResults.students.findIndex(s => s.id === id);
    if (idx !== -1) superAdminSearchResults.students[idx] = data.student;
    renderSuperAdminSearchResults();
    showToast('Student credentials updated.');
  } catch (err) {
    showToast(err.message || 'Could not update student.');
  }
}

async function saveSuperAdminStaffCredentials(id) {
  const collegeId = document.getElementById('staffCollegeId-' + id).value;
  const email = document.getElementById('staffEmail-' + id).value;
  const password = document.getElementById('staffPassword-' + id).value;

  try {
    const data = await api('/api/superadmin/staff/' + id + '/credentials', {
      method: 'PATCH',
      body: { collegeId, email, password: password || undefined }
    });
    const idx = superAdminSearchResults.staff.findIndex(a => a.id === id);
    if (idx !== -1) superAdminSearchResults.staff[idx] = data.staff;
    renderSuperAdminSearchResults();
    showToast('Staff credentials updated.');
  } catch (err) {
    showToast(err.message || 'Could not update staff account.');
  }
}

/* ---------------- Landing: generic fade-up reveal ----------------
   Powers the "Features", "About", and closing CTA sections (anything tagged
   .reveal-up) so they fade/slide into view every time they're scrolled to —
   and fade back out if scrolled past, so it replays on the way back down too. */
function startScrollReveals() {
  const els = document.querySelectorAll('.reveal-up');
  if (!els.length) return;

  if (!('IntersectionObserver' in window)) {
    els.forEach(el => el.classList.add('in-view'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const el = entry.target;
      if (entry.isIntersecting) {
        // Restart the animation each time it re-enters, even if it never
        // fully left (rapid up/down scroll), by forcing a reflow.
        el.classList.remove('in-view');
        // eslint-disable-next-line no-unused-expressions
        void el.offsetWidth;
        el.classList.add('in-view');
      } else {
        el.classList.remove('in-view');
      }
    });
  }, { threshold: 0.2, rootMargin: '0px 0px -40px 0px' });

  els.forEach(el => observer.observe(el));
}

/* ---------------- Boot ---------------- */
function waitForPageLoad() {
  if (document.readyState === 'complete') return Promise.resolve();
  return new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
}

function hidePageLoader() {
  const loader = document.getElementById('pageLoader');
  if (!loader || loader.classList.contains('hidden')) return;
  loader.classList.add('hidden');
  document.body.classList.remove('page-loading');
}

/* Brighten only the dots near the pointer on authentication views. CSS draws
   the grid; JavaScript supplies the pointer position, keeping the effect light. */
function initAuthDotFields() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  document.querySelectorAll('.auth-view').forEach(view => {
    view.addEventListener('pointerenter', () => view.classList.add('dot-field-active'));
    view.addEventListener('pointerleave', () => view.classList.remove('dot-field-active'));
    view.addEventListener('pointermove', event => {
      const rect = view.getBoundingClientRect();
      view.style.setProperty('--dot-x', `${event.clientX - rect.left}px`);
      view.style.setProperty('--dot-y', `${event.clientY - rect.top}px`);
    });
  });
}

/* Brighten only the dots near the pointer on authentication views. CSS draws
   the grid; JavaScript supplies the pointer position, keeping the effect light. */
function initAuthDotFields() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  document.querySelectorAll('.auth-view').forEach(view => {
    view.addEventListener('pointerenter', () => view.classList.add('dot-field-active'));
    view.addEventListener('pointerleave', () => view.classList.remove('dot-field-active'));
    view.addEventListener('pointermove', event => {
      const rect = view.getBoundingClientRect();
      view.style.setProperty('--dot-x', `${event.clientX - rect.left}px`);
      view.style.setProperty('--dot-y', `${event.clientY - rect.top}px`);
    });
  });
}

async function bootApp() {
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMobileNav();
  });
  renderCategoryChips();
  startHeroDemo();
  startScrollReveals();

  const deptSelect = document.getElementById('adminRegDepartment');
  if (deptSelect) {
    deptSelect.insertAdjacentHTML('beforeend', CATEGORIES.map(c => `<option value="${c}">${dropdownLabel(c)}</option>`).join(''));
  }

  // If a session cookie from an earlier visit is still valid, skip straight
  // to the right dashboard instead of showing the landing page. Student and
  // admin sessions are mutually exclusive in practice, so try student first,
  // then admin — the super-admin panel always requires re-entering the key.
  try {
    const data = await api('/api/me');
    if (data.user) {
      currentUser = data.user;
      await loadMyTickets();
      enterDashboard();
      return;
    }
  } catch (err) {
    // Network error reaching /api/me — stay on the landing page.
  }

  try {
    const data = await api('/api/admin/me');
    if (data.admin) {
      currentAdmin = data.admin;
      await loadAdminTickets();
      enterAdminDashboard();
    }
  } catch (err) {
    // Not logged in as staff either — stay on the landing page.
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initAuthDotFields();
  Promise.all([bootApp(), waitForPageLoad()]).finally(hidePageLoader);
});
