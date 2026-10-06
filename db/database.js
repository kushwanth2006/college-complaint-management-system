const { MongoClient } = require('mongodb');
const { assignIncident } = require('../lib/incidents');

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

async function reserveIds(name, count, session) {
  if (!count) return [];
  const result = await collection('counters').findOneAndUpdate(
    { _id: name },
    { $inc: { seq: count } },
    { upsert: true, returnDocument: 'after', session }
  );
  const lastId = (result.value || result).seq;
  return Array.from({ length: count }, (_, index) => lastId - count + index + 1);
}

function tableFrom(sql) {
  const match = sql.match(/\bFROM\s+(users|admins|complaints|password_resets|complaint_history|feedback)\b/i);
  if (!match) throw new Error(`Unsupported MongoDB query: ${sql}`);
  return match[1].toLowerCase();
}

function selectFilter(sql, params) {
  if (/college_id = \? AND id != \?/i.test(sql)) return { college_id: params[0], id: { $ne: Number(params[1]) } };
  if (/email = \? AND id != \?/i.test(sql)) return { email: params[0], id: { $ne: Number(params[1]) } };
  if (/user_id = \? AND reset_token = \?/i.test(sql)) return { user_id: Number(params[0]), reset_token: params[1] };
  if (/user_id = \? AND otp_used = 0/i.test(sql)) return { user_id: Number(params[0]), otp_used: 0 };
  if (/complaint_code = \?/i.test(sql)) return { complaint_code: params[0] };
  if (/complaint_id = \?/i.test(sql)) return { complaint_id: Number(params[0]) };
  if (/category = \?/i.test(sql)) return { category: params[0] };
  if (/college_id = \?/i.test(sql)) return { college_id: params[0] };
  if (/email = \?/i.test(sql)) return { email: params[0] };
  if (/user_id = \?/i.test(sql)) return { user_id: Number(params[0]) };
  if (/id = \?/i.test(sql)) return { id: Number(params[0]) };
  return {};
}

async function attachComplaintStudents(complaints) {
  const userIds = [...new Set(complaints.map(item => item.user_id))];
  const users = await collection('users').find({ id: { $in: userIds } }).project({ id: 1, name: 1, college_id: 1 }).toArray();
  const byId = new Map(users.map(user => [user.id, user]));
  return complaints.map(item => {
    const user = byId.get(item.user_id) || {};
    return { ...item, student_name: user.name, student_college_id: user.college_id };
  });
}

async function joinedComplaints(category) {
  const filter = category ? { category } : {};
  const complaints = await collection('complaints').find(filter).project({ photo: 0 }).sort({ id: -1 }).toArray();
  return attachComplaintStudents(complaints);
}

async function pagedComplaints({ category, userId, page, pageSize }) {
  const filter = {};
  if (category) filter.category = category;
  if (userId != null) filter.user_id = Number(userId);
  const [complaints, total] = await Promise.all([
    collection('complaints').find(filter).sort({ id: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
    collection('complaints').countDocuments(filter)
  ]);
  return { rows: await attachComplaintStudents(complaints), total };
}

async function studentComplaintSummaryPage({ search, page, pageSize }) {
  const pipeline = [
    { $group: { _id: '$user_id', complaintCount: { $sum: 1 } } },
    { $lookup: { from: 'users', localField: '_id', foreignField: 'id', as: 'student' } },
    { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } }
  ];
  if (search) {
    const pattern = escapeRegex(search);
    pipeline.push({ $match: { $or: [
      { 'student.name': { $regex: pattern, $options: 'i' } },
      { 'student.college_id': { $regex: pattern, $options: 'i' } }
    ] } });
  }
  pipeline.push({ $facet: {
    students: [
      { $sort: { complaintCount: -1, 'student.name': 1 } },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize },
      { $project: { _id: 0, studentId: '$_id', name: '$student.name', collegeId: '$student.college_id', complaintCount: 1 } }
    ],
    total: [{ $count: 'count' }]
  } });
  const [result] = await collection('complaints').aggregate(pipeline).toArray();
  return { students: result?.students || [], total: result?.total?.[0]?.count || 0 };
}

const db = {
  complaintPage: pagedComplaints,
  studentComplaintSummaryPage,
  async updateIncident(complaint, values, actor) {
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await collection('counters').updateOne({ _id: 'incident_lock' }, { $inc: { seq: 1 } }, { upsert: true, session });
        const filter = complaint.incident_code ? { incident_code: complaint.incident_code } : { id: complaint.id };
        const members = await collection('complaints').find(filter, { session })
          .project({ id: 1, stage_index: 1, incident_urgent: 1, sla_deadline: 1 })
          .toArray();
        if (members.some(c => c.incident_urgent) && values.stage_index < 3) {
          values.ai_priority = 'Critical';
          values.sla_deadline = new Date(Math.min(...members.map(c => new Date(c.sla_deadline).getTime())));
        }
        await collection('complaints').updateMany(filter, { $set: values }, { session });
        const stages = ['Submitted', 'Assigned', 'In Progress', 'Resolved', 'Closed'];
        const historyIds = await reserveIds('complaint_history', members.length, session);
        const createdAt = new Date();
        await collection('complaint_history').insertMany(members.map((member, index) => ({
          id: historyIds[index], created_at: createdAt, complaint_id: member.id,
          previous_status: stages[member.stage_index], new_status: stages[values.stage_index], updated_by: actor,
          remarks: `Incident update: ${values.note}`
        })), { session });
      });
    } finally { await session.endSession(); }
  },
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

  async recentOpenComplaints(limit = 500) {
    const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 500;
    return collection('complaints')
      .find({ stage_index: { $lt: 3 } })
      .project({ id: 1, complaint_code: 1, title: 1, description: 1, stage_index: 1 })
      .sort({ id: -1 })
      .limit(boundedLimit)
      .toArray();
  },

  async recentResolvedComplaints(category, limit = 150) {
    const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 300) : 150;
    return collection('complaints')
      .find({ category, stage_index: { $gte: 3 } })
      .project({ id: 1, complaint_code: 1, title: 1, description: 1, category: 1, note: 1, stage_index: 1 })
      .sort({ id: -1 })
      .limit(boundedLimit)
      .toArray();
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
      if (name === 'complaints') {
        const original = { ...document };
        const session = client.startSession();
        try {
          await session.withTransaction(async () => {
            // A transaction retry must start with the original submitted report.
            for (const key of Object.keys(document)) delete document[key];
            Object.assign(document, original);
            // A shared write serializes matching across concurrent server processes.
            await collection('counters').updateOne({ _id: 'incident_lock' }, { $inc: { seq: 1 } }, { upsert: true, session });
            const rows = await collection('complaints')
              .find({ stage_index: { $lt: 3 }, created_at: { $gte: new Date(document.created_at.getTime() - 600000) } }, { session })
              .project({ id: 1, complaint_code: 1, category: 1, title: 1, description: 1, location: 1, user_id: 1, created_at: 1,
                stage_index: 1, note: 1, ai_priority: 1, sla_deadline: 1, incident_code: 1, incident_seed_id: 1,
                incident_started_at: 1, incident_title: 1, incident_urgent: 1 })
              .sort({ id: 1 })
              .toArray();
            const group = assignIncident(document, rows);
            const seed = group.members.find(r => r.id === group.metadata.incident_seed_id);
            if (seed && seed.id !== document.id) {
              document.stage_index = seed.stage_index;
              document.note = seed.note;
            }
            Object.assign(document, group.metadata, { ai_priority: group.priority, sla_deadline: group.deadline });
            if (group.metadata.incident_urgent) document.ai_priority_reason = '20 or more students reported this incident within 10 minutes. Immediate attention required.';
            await collection(name).insertOne(document, { session });
            await collection(name).updateMany({ incident_code: document.incident_code }, { $set: {
              ...group.metadata, ai_priority: group.priority, sla_deadline: group.deadline,
              ...(group.metadata.incident_urgent ? { ai_priority_reason: document.ai_priority_reason } : {})
            } }, { session });
            const [historyId] = await reserveIds('complaint_history', 1, session);
            await collection('complaint_history').insertOne({ id: historyId, created_at: new Date(), complaint_id: document.id,
              previous_status: null, new_status: 'Submitted', updated_by: document.user_id, remarks: 'Complaint submitted and analyzed.' }, { session });
          });
        } finally { await session.endSession(); }
      } else await collection(name).insertOne(document);
      return { changes: 1, lastInsertRowid: document.id, ...(name === 'complaints' ? { row: document } : {}) };
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
      else if (/complaint_id = \?/i.test(where)) filter = { complaint_id: Number(params[0]) };
      else if (/id = \?/i.test(where)) filter = { id: Number(params[0]) };
      else throw new Error(`Unsupported MongoDB delete: ${sql}`);
      if (name === 'complaints') {
        const session = client.startSession();
        let deletedCount = 0;
        try {
          await session.withTransaction(async () => {
            await collection('counters').updateOne({ _id: 'incident_lock' }, { $inc: { seq: 1 } }, { upsert: true, session });
            const removed = await collection(name).findOne(filter, { session });
            const result = await collection(name).deleteMany(filter, { session });
            deletedCount = result.deletedCount;
            if (removed?.incident_code) {
              const members = await collection(name).find({ incident_code: removed.incident_code }, { session }).sort({ id: 1 }).toArray();
              if (members.length) await collection(name).updateMany({ incident_code: removed.incident_code }, { $set: {
                incident_seed_id: members[0].id, incident_reports: members.length,
                incident_affected: new Set(members.map(c => c.user_id)).size
              } }, { session });
            }
          });
        } finally { await session.endSession(); }
        return { changes: deletedCount };
      }
      const result = await collection(name).deleteMany(filter);
      return { changes: result.deletedCount, lastInsertRowid: undefined };
    }
    throw new Error(`Unsupported MongoDB write: ${sql}`);
  }
};

async function initDb() {
  await client.connect();
  database = client.db(databaseName);
  await collection('counters').updateOne({ _id: 'incident_lock' }, { $setOnInsert: { seq: 0 } }, { upsert: true });
  await Promise.all([
    collection('users').createIndex({ college_id: 1 }, { unique: true }),
    collection('users').createIndex({ email: 1 }, { unique: true }),
    collection('admins').createIndex({ email: 1 }, { unique: true }),
    collection('admins').createIndex({ college_id: 1 }, { unique: true, sparse: true }),
    collection('complaints').createIndex({ complaint_code: 1 }, { unique: true }),
    collection('complaints').createIndex({ user_id: 1 }),
    collection('complaints').createIndex({ stage_index: 1, id: -1 }),
    collection('complaints').createIndex({ category: 1, stage_index: 1, id: -1 }),
    collection('complaints').createIndex({ stage_index: 1, created_at: 1, id: 1 }),
    collection('complaints').createIndex({ incident_code: 1 }),
    collection('complaints').createIndex({ created_at: 1, stage_index: 1 }),
    collection('password_resets').createIndex({ user_id: 1 }),
    collection('complaint_history').createIndex({ complaint_id: 1 }),
    collection('feedback').createIndex({ complaint_id: 1 }, { unique: true })
  ]);
}

module.exports = { db, initDb, client, _test: { normalize, escapeRegex, selectFilter, parseAssignments } };
