# Admin System Implementation - Complete Code Changes

## Overview
Added a complete admin system with login, registration, and complaint management capabilities.

## Database Changes

### File: `db/database.js`
Added new `admins` table:
```sql
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  department TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Server Changes

### File: `server.js`

#### 1. Added Admin Auth Middleware (line ~70)
```javascript
function requireAdminAuth(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({ error: 'Not logged in as admin.' });
  }
  next();
}
```

#### 2. Added Admin Routes (after line ~342)

**Admin Registration:**
```javascript
app.post('/api/admin/register', (req, res) => {
  const { email, name, password, department } = req.body || {};
  // Validates email, checks for existing admin, hashes password
  // Creates admin account and starts session
});
```

**Admin Login:**
```javascript
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  // Validates credentials and starts admin session
});
```

**Get Admin Profile:**
```javascript
app.get('/api/admin/me', (req, res) => {
  // Returns current admin info or null
});
```

**Admin Logout:**
```javascript
app.post('/api/admin/logout', (req, res) => {
  // Destroys admin session
});
```

**Get All Complaints (Admin):**
```javascript
app.get('/api/admin/complaints', requireAdminAuth, (req, res) => {
  // Returns all complaints with student information
  // Includes: studentName, collegeId, studentEmail, hostel
});
```

**Update Complaint Progress:**
```javascript
app.patch('/api/admin/complaints/:complaintCode', requireAdminAuth, (req, res) => {
  const { stageIndex, note } = req.body || {};
  // Updates complaint stage and progress note
});
```

## Frontend Changes

### File: `public/structure.html`

#### 1. Updated Landing Page Navigation (line ~17)
Added "Admin" link to main navigation:
```html
<div class="nav-links">
  <a href="#how">How it works</a>
  <a href="#about">About</a>
  <a href="#" onclick="switchView('view-landing','view-admin-login'); return false;">Admin</a>
</div>
```

#### 2. Added Admin Login View (before closing body tag)
Complete admin login form with email/password and link to registration.

#### 3. Added Admin Registration View
Form with fields: name, email, department, password

Department options:
- Hostel Office
- Mess Committee
- Academic Office
- IT Support
- Transport Desk
- Library Staff
- Administration
- Maintenance

#### 4. Added Admin Dashboard View
Features:
- Sidebar with navigation
- Statistics grid
- All complaints list
- Search functionality
- Category filters
- Update progress button on each complaint

### File: `public/Script.js`

#### Added Admin State Variables (line ~827)
```javascript
let currentAdmin = null;         // { id, name, email, department }
let adminTicketsCache = [];      // All complaints (admin view)
let adminActiveFilterCategory = 'All';
let adminActiveSearch = '';
```

#### Added Admin Functions

**handleAdminLogin(event)**
- Authenticates admin
- Loads all complaints
- Enters admin dashboard

**handleAdminRegister(event)**
- Registers new admin account
- Validates email and required fields
- Auto-login after registration

**handleAdminLogout()**
- Logs out admin
- Clears admin state
- Returns to landing page

**enterAdminDashboard()**
- Shows admin dashboard
- Hides all other views
- Renders statistics and complaint list

**loadAllAdminTickets()**
- Fetches all complaints from API
- Includes student information

**adminRefreshComplaints()**
- Reloads complaint data
- Updates statistics and list

**renderAdminStatGrid()**
- Shows total, open, in progress, resolved counts

**renderAdminFilterRow()**
- Category filter pills

**renderAdminTicketList()**
- Displays all complaints with student info
- Includes search and filter support
- "Update Progress" button on each complaint

**openAdminUpdateModal(complaintId)**
- Opens modal to update complaint
- Stage selector (Submitted → Routed → In Progress → Resolved)
- Progress note textarea

**submitAdminUpdate(complaintId)**
- Sends PATCH request to update complaint
- Updates local cache
- Refreshes dashboard

**openAdminStatsModal()**
- Shows statistics overview
- Breakdown by category

#### Updated Boot Section (line ~1040)
Added admin session check:
```javascript
document.addEventListener('DOMContentLoaded', async () => {
  renderCategoryChips();
  startHeroDemo();
  startWorkflowReveal();

  // Check for existing admin session first
  try {
    const adminData = await api('/api/admin/me');
    if (adminData.admin) {
      currentAdmin = adminData.admin;
      await loadAllAdminTickets();
      enterAdminDashboard();
      return;
    }
  } catch (err) {
    // Not an admin session, continue to check student session
  }

  // Check for existing student session...
});
```

### File: `public/styles.css`

Added admin-specific styles at the end:

```css
/* Admin Dashboard Styles */
.admin-stat-grid{
  display:grid; 
  grid-template-columns:repeat(4,1fr); 
  gap:14px; 
  margin-bottom:30px;
}

.tk-student-info{
  font-size:12px; 
  color:var(--text-soft); 
  margin-top:8px; 
  padding:8px 10px;
  background:var(--parchment); 
  border-radius:6px; 
  border:1px solid var(--line);
}

.site-nav .nav-inner{
  display:flex; 
  align-items:center; 
  justify-content:space-between; 
  width:100%;
}

.modal .field{margin-bottom:12px;}
.modal .field label{margin-top:0;}
```

## How to Use

### 1. Start the Server
```bash
npm start
```

### 2. Access Admin Panel
- Click "Admin" link in navigation
- Or go to: http://localhost:3000 and click Admin

### 3. Register First Admin
- Email: admin@college.edu
- Name: Admin Name
- Department: Select from dropdown
- Password: Create secure password

### 4. Admin Dashboard Features
- **View All Complaints**: See every complaint from all students
- **Search**: Search by title, description, category, student name, or college ID
- **Filter by Category**: Filter complaints by category
- **Update Progress**: Click "Update Progress" on any complaint to:
  - Change stage (Submitted → Routed → In Progress → Resolved)
  - Add progress notes
- **Statistics**: View complaint statistics by status and category

## API Endpoints Summary

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/admin/register` | None | Register new admin |
| POST | `/api/admin/login` | None | Admin login |
| GET | `/api/admin/me` | None | Get current admin |
| POST | `/api/admin/logout` | Admin | Logout admin |
| GET | `/api/admin/complaints` | Admin | Get all complaints |
| PATCH | `/api/admin/complaints/:code` | Admin | Update complaint progress |

## Security Notes

1. Admin sessions are separate from student sessions
2. Password hashing with bcryptjs (10 rounds)
3. Session-based authentication
4. Protected admin routes require authentication
5. Admin actions are logged via session tracking

## Testing

### Test Admin Registration
```bash
curl -X POST http://localhost:3000/api/admin/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","name":"Test Admin","department":"IT Support","password":"test123"}'
```

### Test Admin Login
```bash
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"test123"}'
```

## Student Info Displayed to Admin

For each complaint, admins can see:
- Complaint details (title, description, category, stage, note)
- Student name
- College ID
- Student email
- Hostel
- Created date
- Attached photo (if any)

## Workflow Stages

Admins can update complaints through these stages:
1. **Submitted** (Stage 0) - Just filed, awaiting routing
2. **Routed** (Stage 1) - Assigned to department
3. **In Progress** (Stage 2) - Being worked on
4. **Resolved** (Stage 3) - Completed and verified
