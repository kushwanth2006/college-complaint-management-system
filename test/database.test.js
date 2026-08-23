const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';
const { client, _test } = require('../db/database');

test.after(() => client.close());

test('maps SQL-era filters and assignments to MongoDB values', () => {
  assert.deepEqual(
    _test.selectFilter('SELECT * FROM users WHERE college_id = ? AND id != ?', ['VTU12345', 7]),
    { college_id: 'VTU12345', id: { $ne: 7 } }
  );
  assert.deepEqual(
    _test.parseAssignments('otp_used = 1, reset_token = ?, department = NULL, attempts = attempts + 1', ['token']),
    { set: { otp_used: 1, reset_token: 'token', department: null }, inc: { attempts: 1 }, paramIndex: 1 }
  );
  assert.equal(_test.escapeRegex('VTU[12].*'), 'VTU\\[12\\]\\.\\*');
});
