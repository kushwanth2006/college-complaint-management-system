const { similarity } = require('./complaint-ai');
const WINDOW_MS = 10 * 60 * 1000;
const URGENT_COUNT = 20;

function normalized(text) {
  return String(text || '').toLowerCase().replace(/wi[ -]?fi/g, 'wifi').replace(/air[ -]?condition(?:er|ing)/g, 'ac').replace(/[^a-z0-9]+/g, ' ').trim();
}
function locationOf(c) {
  if (c.location) return normalized(c.location);
  const text = normalized(`${c.title} ${c.description}`);
  const matches = text.match(/\b(?:seminar hall|lecture hall|auditorium|(?:block|room|lab|classroom|hall) [a-z0-9]+)\b/g);
  return matches ? [...new Set(matches)].sort().join(' ') : '';
}
function issueOf(c) {
  const text = normalized(`${c.title} ${c.description}`);
  const equipment = text.match(/\b(ac|wifi|internet|network|projector|fan|water|food|electricity)\b/g) || [];
  const topics = [...new Set(equipment.map(x => /wifi|internet|network/.test(x) ? 'network' : x))].sort();
  const failure = /\b(not working|no |stopped|down|failure|failed|problem|broken|outage|not cooling)/.test(text);
  return topics.length && failure ? `${topics.join('+')}:failure` : null;
}
function matchesIncident(candidate, seed) {
  const age = new Date(candidate.created_at) - new Date(seed.incident_started_at || seed.created_at);
  if (candidate.category !== seed.category || seed.stage_index >= 3 || !(Math.abs(age) <= WINDOW_MS)) return false;
  const location = locationOf(candidate);
  if (!location || location !== locationOf(seed)) return false;
  const left = issueOf(candidate), right = issueOf(seed);
  if (left || right) return Boolean(left && left === right);
  return similarity(`${candidate.title} ${candidate.description}`, `${seed.title} ${seed.description}`) >= 0.6;
}
function assignIncident(candidate, rows) {
  // Compare with the first report, so the ten-minute window cannot drift.
  const seeds = rows.filter(r => r.incident_code && r.incident_seed_id === r.id);
  const seed = seeds.find(r => matchesIncident(candidate, r));
  candidate.incident_code = seed?.incident_code || `INC-${1000 + candidate.id}`;
  candidate.incident_seed_id = seed?.id || candidate.id;
  const members = [...rows.filter(r => r.incident_code === candidate.incident_code), candidate];
  const affected = new Set(members.map(r => r.user_id)).size;
  const urgent = affected >= URGENT_COUNT || members.some(r => r.incident_urgent);
  const metadata = {
    incident_code: candidate.incident_code, incident_seed_id: candidate.incident_seed_id,
    incident_title: seed?.incident_title || candidate.title,
    incident_started_at: seed?.incident_started_at || seed?.created_at || candidate.created_at,
    incident_affected: affected, incident_reports: members.length,
    incident_urgent: urgent
  };
  const rank = { Low: 1, Medium: 2, High: 3, Critical: 4 };
  const priority = urgent ? 'Critical' : members.reduce((p, c) => rank[c.ai_priority] > rank[p] ? c.ai_priority : p, 'Low');
  const deadlines = members.map(r => new Date(r.sla_deadline).getTime()).filter(Number.isFinite);
  if (urgent) deadlines.push(new Date(candidate.created_at).getTime());
  return { members, metadata, priority, deadline: deadlines.length ? new Date(Math.min(...deadlines)) : null };
}
module.exports = { WINDOW_MS, URGENT_COUNT, locationOf, matchesIncident, assignIncident };
