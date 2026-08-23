const assert = require('assert');
const { analyzeComplaint, similarity } = require('./lib/complaint-ai');

const result = analyzeComplaint({
  title: 'No internet in Block C',
  description: 'The whole hostel network is not working since last night.',
  complaints: [{ complaint_code: 'CDT-1001', title: 'Hostel internet down', description: 'Network not working in Block C', stage_index: 1 }]
});

assert.equal(result.category, 'Wi-Fi & Network');
assert.equal(result.priority, 'High');
assert.equal(result.duplicate.complaintCode, 'CDT-1001');
assert(similarity('wifi not working block c', 'block c wifi is not working') > 0.7);
console.log('complaint AI checks passed');
