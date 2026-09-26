const test = require('node:test');
const assert = require('node:assert/strict');
const { assignIncident, matchesIncident } = require('../lib/incidents');
const base = { title: 'AC not working in Seminar Hall', description: '', location: '', category: 'General', stage_index: 0, created_at: new Date('2026-09-26T10:00:00Z'), ai_priority: 'Low', sla_deadline: new Date('2026-09-29T10:00:00Z') };
const variants = ['AC is not working in Seminar Hall', 'No AC in Seminar Hall', 'Seminar Hall AC has stopped', 'AC problem in Seminar Hall', 'Seminar Hall is very hot, AC not working'];
function add(rows, id, overrides = {}) {
  const row = { ...base, id, user_id: id, title: variants[(id - 1) % variants.length], ...overrides };
  const group = assignIncident(row, rows);
  for (const member of group.members) Object.assign(member, group.metadata, { ai_priority: group.priority, sla_deadline: group.deadline });
  rows.push(row);
  return group;
}
test('20 paraphrased AC reports become one critical incident with immediate deadline', () => {
  const rows = [];
  for (let id = 1; id <= 20; id++) add(rows, id, { created_at: new Date(+base.created_at + id * 20000) });
  assert.equal(new Set(rows.map(r => r.incident_code)).size, 1);
  assert.equal(rows[0].incident_affected, 20);
  assert.equal(rows[0].incident_reports, 20);
  assert.equal(rows[0].ai_priority, 'Critical');
  assert.equal(+rows[0].sla_deadline, +rows[19].created_at);
});
test('one student cannot trigger mass escalation', () => {
  const rows = [];
  for (let id = 1; id <= 20; id++) add(rows, id, { user_id: 1 });
  assert.equal(rows[0].incident_affected, 1);
  assert.equal(rows[0].incident_urgent, false);
});
test('different location, equipment, department, old or resolved reports stay separate', () => {
  for (const changes of [ { location: 'Hall B' }, { title: 'Wifi not working in Seminar Hall' }, { category: 'Hostel' }, { created_at: new Date(+base.created_at + 600001) } ]) {
    assert.equal(matchesIncident({ ...base, ...changes }, base), false);
  }
  assert.equal(matchesIncident(base, { ...base, stage_index: 3 }), false);
  assert.equal(matchesIncident({ ...base, title: 'AC not working' }, { ...base, title: 'AC stopped' }), false);
});
test('window is anchored to first report and includes ten-minute boundary', () => {
  const rows = [];
  add(rows, 1);
  add(rows, 2, { created_at: new Date(+base.created_at + 600000) });
  add(rows, 3, { created_at: new Date(+base.created_at + 600001) });
  assert.equal(rows[0].incident_code, rows[1].incident_code);
  assert.notEqual(rows[1].incident_code, rows[2].incident_code);
});
test('normalizes network synonyms and explicit location case', () => {
  assert.equal(matchesIncident({ ...base, title: 'Wi-Fi down', location: ' SEMINAR HALL ' }, { ...base, title: 'Internet not working', location: 'Seminar Hall' }), true);
});
