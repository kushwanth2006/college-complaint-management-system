const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeComplaint, findDuplicate, similarity } = require('../lib/complaint-ai');

test('classifies and prioritizes a widespread network outage', () => {
  const result = analyzeComplaint({ title: 'No internet in Block C', description: 'The whole hostel network is not working.' });
  assert.equal(result.category, 'Wi-Fi & Network');
  assert.equal(result.priority, 'High');
});

test('closed and resolved complaints are not duplicate candidates', () => {
  const complaints = [
    { complaint_code: 'CDT-1', title: 'Wifi down', description: 'Wifi down block C', stage_index: 3 },
    { complaint_code: 'CDT-2', title: 'Wifi down', description: 'Wifi down block C', stage_index: 4 }
  ];
  assert.equal(findDuplicate('Wifi down block C', complaints), null);
});

test('similarity recognizes equivalent complaint text', () => {
  assert.ok(similarity('wifi not working block c', 'block c wifi is not working') > 0.7);
});
