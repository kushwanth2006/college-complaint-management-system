const CATEGORY_TERMS = {
  Hostel: ['hostel', 'room', 'water', 'bathroom', 'washroom', 'warden', 'electricity', 'fan', 'bed'],
  Mess: ['mess', 'food', 'meal', 'breakfast', 'lunch', 'dinner', 'hygiene', 'menu', 'canteen'],
  Academic: ['class', 'faculty', 'exam', 'marks', 'result', 'attendance', 'course', 'lecture', 'lab'],
  'Wi-Fi & Network': ['wifi', 'wi-fi', 'internet', 'network', 'router', 'signal', 'connection', 'online'],
  Transport: ['bus', 'transport', 'driver', 'route', 'pickup', 'drop', 'vehicle', 'late'],
  Library: ['library', 'book', 'librarian', 'reading', 'journal', 'issue', 'return'],
  General: []
};

const HIGH_TERMS = ['danger', 'dangerous', 'fire', 'smoke', 'shock', 'sparking', 'injury', 'flood', 'emergency', 'unsafe'];
const MEDIUM_TERMS = ['broken', 'leak', 'leaking', 'not working', 'unavailable', 'blocked', 'dirty', 'delay', 'failed'];
const STOP_WORDS = new Set(['a','an','and','are','at','be','been','by','for','from','has','have','i','in','is','it','my','of','on','or','our','the','this','to','was','we','with']);

function words(text) {
  const concepts = { wifi: 'network', internet: 'network', connection: 'network', router: 'network', down: 'outage', unavailable: 'outage', failed: 'outage', leaking: 'leak', leakage: 'leak' };
  return (String(text || '').toLowerCase().replace(/not working/g, 'outage').match(/[a-z0-9]+/g) || []).map(word => concepts[word] || word);
}

function predictCategory(text) {
  const normalized = String(text || '').toLowerCase();
  let best = { category: 'General', score: 0 };
  for (const [category, terms] of Object.entries(CATEGORY_TERMS)) {
    const score = terms.reduce((total, term) => total + (normalized.includes(term) ? 1 : 0), 0);
    if (score > best.score) best = { category, score };
  }
  return { category: best.category, confidence: best.score ? Math.min(95, 55 + best.score * 10) : 35 };
}

function suggestPriority(text) {
  const normalized = String(text || '').toLowerCase();
  const high = HIGH_TERMS.find(term => normalized.includes(term));
  if (high) return { priority: 'Critical', reason: `Safety-related term detected: “${high}”.` };
  const affected = /(entire|whole|all|everyone|multiple|many)\b/.test(normalized);
  const medium = MEDIUM_TERMS.find(term => normalized.includes(term));
  if (affected && medium) return { priority: 'High', reason: 'The complaint indicates a service failure affecting multiple people.' };
  if (medium) return { priority: 'Medium', reason: `Service disruption detected: “${medium}”.` };
  return { priority: 'Low', reason: 'No immediate safety or widespread service-disruption terms were detected.' };
}

function summarize(title, description) {
  const clean = String(description || '').replace(/\s+/g, ' ').trim();
  if (!clean) return String(title || '').trim();
  const first = clean.split(/(?<=[.!?])\s+/)[0];
  return first.length <= 180 ? first : first.slice(0, 177).trimEnd() + '...';
}

function extractEntities(text) {
  const source = String(text || '');
  const locations = source.match(/\b(?:boys? hostel|girls? hostel|hostel|block|room|lab|library|mess|classroom)\s+[A-Z0-9-]+\b/gi) || [];
  const keywords = [...new Set(words(source).filter(word =>
    word.length > 3 && !STOP_WORDS.has(word) && Object.values(CATEGORY_TERMS).flat().includes(word)
  ))].slice(0, 8);
  return { location: locations[0] || null, keywords };
}

function suggestedResolution(category) {
  const actions = {
    'Wi-Fi & Network': ['Check access-point status.', 'Review outage logs.', 'Verify router power and upstream connectivity.'],
    Hostel: ['Inspect the reported location.', 'Confirm whether adjacent rooms are affected.', 'Assign the appropriate maintenance team.'],
    Mess: ['Inspect the reported service or hygiene issue.', 'Verify the menu and service log.', 'Record corrective action with the mess supervisor.'],
    Transport: ['Verify the route and vehicle log.', 'Contact the transport coordinator.', 'Notify affected students of the action taken.'],
    Library: ['Verify the book, facility, or service issue.', 'Check the library issue register.', 'Assign the librarian or maintenance team.'],
    Academic: ['Verify the academic record or timetable.', 'Forward it to the authorized academic coordinator.', 'Record the reviewed decision.'],
    General: ['Verify the complaint details.', 'Identify the responsible department.', 'Record the first action and expected follow-up time.']
  };
  return actions[category] || actions.General;
}

function similarity(a, b) {
  const set = text => new Set(words(text).filter(word => word.length > 2 && !STOP_WORDS.has(word)));
  const left = set(a); const right = set(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter(word => right.has(word)).length;
  return intersection / (left.size + right.size - intersection);
}

function findDuplicate(text, complaints) {
  let best = null;
  for (const complaint of complaints || []) {
    if (complaint.stage_index >= 3) continue;
    const score = similarity(text, `${complaint.title || ''} ${complaint.description || ''}`);
    if (!best || score > best.similarity) best = { complaintCode: complaint.complaint_code, similarity: score };
  }
  return best && best.similarity >= 0.45 ? { ...best, similarity: Math.round(best.similarity * 100) } : null;
}

function analyzeComplaint({ title, description, complaints = [] }) {
  const text = `${title || ''} ${description || ''}`;
  const category = predictCategory(text);
  return {
    ...category,
    department: category.category,
    ...suggestPriority(text),
    summary: summarize(title, description),
    entities: extractEntities(text),
    suggestedResolution: suggestedResolution(category.category),
    duplicate: findDuplicate(text, complaints)
  };
}

module.exports = { analyzeComplaint, predictCategory, suggestPriority, summarize, similarity, findDuplicate, extractEntities, suggestedResolution };
