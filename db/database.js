const { MongoClient } = require('mongodb');

if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI must be set to a MongoDB Atlas connection URL.');

const client = new MongoClient(process.env.MONGODB_URI);
const databaseName = process.env.MONGODB_DB || 'college_complaints';
let database;

function collection(name) {
  if (!database) throw new Error('MongoDB has not been initialized.');
  return database.collection(name);
}

function normalize(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseAssignments(assignments, params) {
  const set = {}; const inc = {}; let paramIndex = 0;
  for (const part of assignments.split(',').map(value => value.trim())) {
    const increment = part.match(/^(\w+) = \1 \+ (\d+)$/i);
    if (increment) inc[increment[1]] = Number(increment[2]);
    else {
      const [field, token] = part.split('=').map(value => value.trim());
      if (token === '?') set[field] = params[paramIndex++];
      else if (/^NULL$/i.test(token)) set[field] = null;
      else if (/^\d+$/.test(token)) set[field] = Number(token);
      else throw new Error(`Unsupported MongoDB assignment: ${part}`);
    }
  }
  return { set, inc, paramIndex };
}

async function nextId(name) {
  const result = await collection('counters').findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return (result.value || result).seq;
}

function tableFrom(sql) {
  const match = sql.match(/\bFROM\s+(users|admins|complaints|password_resets)\b/i);
  if (!match) throw new Error(`Unsupported MongoDB query: ${sql}`);
  return match[1].toLowerCase();
}

function selectFilter(sql, params) {
  if (/college_id = \? AND id != \?/i.test(sql)) return { college_id: params[0], id: { $ne: Number(params[1]) } };
  if (/email = \? AND id != \?/i.test(sql)) return { email: params[0], id: { $ne: Number(params[1]) } };
  if (/user_id = \? AND reset_token = \?/i.test(sql)) return { user_id: Number(params[0]), reset_token: params[1] };
  if (/user_id = \? AND otp_used = 0/i.test(sql)) return { user_id: Number(params[0]), otp_used: 0 };
  if (/complaint_code = \?/i.test(sql)) return { complaint_code: params[0] };
  if (/college_id = \?/i.test(sql)) return { college_id: params[0] };
  if (/email = \?/i.test(sql)) return { email: params[0] };
  if (/user_id = \?/i.test(sql)) return { user_id: Number(params[0]) };
  if (/id = \?/i.test(sql)) return { id: Number(params[0]) };
  return {};
}

async function joinedComplaints(category) {
  const filter = category ? { category } : {};
  const complaints = await collection('complaints').find(filter).sort({ id: -1 }).toArray();
  const userIds = [...new Set(complaints.map(item => item.user_id))];
  const users = await collection('users').find({ id: { $in: userIds } }).toArray();
  const byId = new Map(users.map(user => [user.id, user]));
  return complaints.map(item => {
    const user = byId.get(item.user_id) || {};
    return { ...item, student_name: user.name, student_college_id: user.college_id, student_email: user.email, student_hostel: user.hostel };
  });
}

const db = {
  async get(rawSql, ...params) {
    const sql = normalize(rawSql);
    const name = tableFrom(sql);
    let cursor = collection(name).find(selectFilter(sql, params));
    if (/ORDER BY id DESC/i.test(sql)) cursor = cursor.sort({ id: -1 });
    return cursor.limit(1).next();
  },

  async all(rawSql, ...params) {
    const sql = normalize(rawSql);
    if (/FROM complaints c LEFT JOIN users u/i.test(sql)) return joinedComplaints(/WHERE c.category = \?/i.test(sql) ? params[0] : null);
    if (/FROM admins WHERE department = \?/i.test(sql)) {
      return collection('admins').find({ department: params[0], status: 'approved', name: { $ne: '' } }).sort({ id: 1 }).toArray();
    }
    if (/UPPER\(college_id\) LIKE \?/i.test(sql)) {
      const term = escapeRegex(String(params[0]).replaceAll('%', ''));
      return collection(tableFrom(sql)).find({ college_id: { $regex: term, $options: 'i' } }).sort({ name: 1 }).limit(25).toArray();
    }
    if (/FROM admins ORDER BY \(status = 'pending'\) DESC, id DESC/i.test(sql)) {
      const rows = await collection('admins').find().sort({ id: -1 }).toArray();
      return rows.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
    }
    const name = tableFrom(sql);
    let cursor = collection(name).find(selectFilter(sql, params));
    if (/ORDER BY id DESC/i.test(sql)) cursor = cursor.sort({ id: -1 });
    return cursor.toArray();
  },

  async run(rawSql, ...params) {
    const sql = normalize(rawSql).replace(/\s+RETURNING\s+id$/i, '');
    const insert = sql.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/i);
    if (insert) {
      const [, name, columnText, valueText] = insert;
      const columns = columnText.split(',').map(value => value.trim());
      const values = valueText.split(',').map(value => value.trim());
      let paramIndex = 0;
      const document = { id: await nextId(name), created_at: new Date() };
      columns.forEach((column, index) => {
        const token = values[index];
        if (token === '?') document[column] = params[paramIndex++];
        else if (/^NULL$/i.test(token)) document[column] = null;
        else if (/^\d+$/.test(token)) document[column] = Number(token);
        else document[column] = token.replace(/^['"]|['"]$/g, '');
      });
      await collection(name).insertOne(document);
      return { changes: 1, lastInsertRowid: document.id };
    }

    const update = sql.match(/^UPDATE (\w+) SET (.+) WHERE id = \?$/i);
    if (update) {
      const [, name, assignments] = update;
      const { set, inc, paramIndex } = parseAssignments(assignments, params);
      const id = Number(params[paramIndex]);
      const changes = await collection(name).updateOne({ id }, { ...(Object.keys(set).length && { $set: set }), ...(Object.keys(inc).length && { $inc: inc }) });
      return { changes: changes.modifiedCount, lastInsertRowid: undefined };
    }

    const deletion = sql.match(/^DELETE FROM (\w+) WHERE (.+)$/i);
    if (deletion) {
      const [, name, where] = deletion;
      let filter;
      if (/complaint_code = \? AND user_id = \?/i.test(where)) filter = { complaint_code: params[0], user_id: Number(params[1]) };
      else if (/complaint_code = \? AND category = \?/i.test(where)) filter = { complaint_code: params[0], category: params[1] };
      else if (/complaint_code = \?/i.test(where)) filter = { complaint_code: params[0] };
      else if (/user_id = \? AND otp_used = 0/i.test(where)) filter = { user_id: Number(params[0]), otp_used: 0 };
      else if (/user_id = \?/i.test(where)) filter = { user_id: Number(params[0]) };
      else if (/id = \?/i.test(where)) filter = { id: Number(params[0]) };
      else throw new Error(`Unsupported MongoDB delete: ${sql}`);
      const result = await collection(name).deleteMany(filter);
      return { changes: result.deletedCount, lastInsertRowid: undefined };
    }
    throw new Error(`Unsupported MongoDB write: ${sql}`);
  }
};

async function initDb() {
  await client.connect();
  database = client.db(databaseName);
  await Promise.all([
    collection('users').createIndex({ college_id: 1 }, { unique: true }),
    collection('admins').createIndex({ email: 1 }, { unique: true }),
    collection('admins').createIndex({ college_id: 1 }, { unique: true, sparse: true }),
    collection('complaints').createIndex({ complaint_code: 1 }, { unique: true }),
    collection('complaints').createIndex({ user_id: 1 }),
    collection('password_resets').createIndex({ user_id: 1 })
  ]);
}

module.exports = { db, initDb, client, _test: { normalize, escapeRegex, selectFilter, parseAssignments } };
