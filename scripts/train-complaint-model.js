const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { CATEGORIES, train, predictLabel } = require('../lib/category-classifier');

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

function parseCsv(input) {
  const rows = [];
  let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  if (field || row.length) { row.push(field); rows.push(row); }
  const [headers, ...records] = rows;
  if (!headers) throw new Error('Dataset is empty.');
  return records.map(values => Object.fromEntries(headers.map((header, index) => [header.replace(/^\uFEFF/, ''), values[index] || ''])));
}

function evaluate(model, rows, labelKey) {
  const labels = model.labels;
  const matrix = Object.fromEntries(labels.map(actual => [actual, Object.fromEntries(labels.map(predicted => [predicted, 0]))]));
  for (const row of rows) matrix[row[labelKey]][predictLabel(row[model.textKey], model).label]++;
  const total = rows.length;
  const perLabel = Object.fromEntries(labels.map(label => {
    const truePositive = matrix[label][label];
    const actual = Object.values(matrix[label]).reduce((sum, count) => sum + count, 0);
    const predicted = labels.reduce((sum, actualLabel) => sum + matrix[actualLabel][label], 0);
    const precision = predicted ? truePositive / predicted : 0;
    const recall = actual ? truePositive / actual : 0;
    return [label, { precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0, support: actual }];
  }));
  const accuracy = total ? labels.reduce((sum, label) => sum + matrix[label][label], 0) / total : 0;
  const macroF1 = labels.reduce((sum, label) => sum + perLabel[label].f1, 0) / labels.length;
  return { rows: total, accuracy, macroF1, perLabel, confusionMatrix: matrix };
}

const root = path.resolve(__dirname, '..');
const datasetPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'data', 'student_complaints_training.csv');
const sourceRows = parseCsv(fs.readFileSync(datasetPath, 'utf8'));

const CATEGORY_ALIASES = new Map([
  ['hostel', 'Hostel'], ['mess', 'Mess'], ['academic', 'Academic'], ['academics', 'Academic'],
  ['wi-fi & network', 'Wi-Fi & Network'], ['wifi and internet', 'Wi-Fi & Network'],
  ['wifi & network', 'Wi-Fi & Network'], ['transport', 'Transport'], ['library', 'Library'], ['general', 'General']
]);
const normalizedText = value => String(value || '').toLowerCase().replace(/\bwi[\s-]+fi\b/g, 'wifi')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

function splitImportedRows(rows) {
  const grouped = new Map();
  const exactLabels = new Map();
  for (const row of rows) {
    const text = normalizedText(row.complaint_text);
    if (!text) throw new Error('A complaint row has empty text.');
    const digest = crypto.createHash('sha256').update(text).digest('hex');
    const pair = `${row.category}\u0000${row.severity}`;
    if (exactLabels.has(digest) && exactLabels.get(digest) !== pair) {
      throw new Error('The same normalized complaint text has conflicting department or severity labels.');
    }
    exactLabels.set(digest, pair);
    const template = text.split(' ').slice(0, 5).join(' ');
    const templateDigest = crypto.createHash('sha256').update(template).digest('hex');
    const groupId = `template-${templateDigest.slice(0, 20)}`;
    const group = grouped.get(groupId) || { id: groupId, keys: new Set(), rows: [] };
    group.keys.add(pair);
    group.rows.push(row);
    grouped.set(groupId, group);
  }

  const groups = [...grouped.values()].sort((a, b) => crypto.createHash('sha256').update(`campusdesk-split-v2:${a.id}`).digest('hex')
    .localeCompare(crypto.createHash('sha256').update(`campusdesk-split-v2:${b.id}`).digest('hex')));
  const totalRows = rows.length;
  let position = 0;
  const assignments = new Map();
  const groupCountsBySplit = { train: new Map(), validation: new Map(), test: new Map() };
  for (const group of groups) {
    const ratio = (position + group.rows.length / 2) / totalRows;
    const split = ratio < 0.70 ? 'train' : ratio < 0.85 ? 'validation' : 'test';
    assignments.set(group.id, split);
    for (const key of group.keys) {
      const counts = groupCountsBySplit[split];
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    position += group.rows.length;
  }

  const allKeys = [...new Set(rows.map(row => `${row.category}\u0000${row.severity}`))].sort();
  for (const key of allKeys) {
    if (groupCountsBySplit.validation.has(key)) continue;
    const candidate = groups.filter(group => assignments.get(group.id) === 'train' && group.keys.has(key)
      && [...group.keys].every(groupKey => (groupCountsBySplit.train.get(groupKey) || 0) > 1))
      .sort((a, b) => a.rows.length - b.rows.length || a.id.localeCompare(b.id))[0];
    if (!candidate) throw new Error(`Could not preserve validation coverage for department/severity label ${key.replace('\u0000', ' / ')}.`);
    assignments.set(candidate.id, 'validation');
    for (const groupKey of candidate.keys) {
      const trainCount = groupCountsBySplit.train.get(groupKey) - 1;
      if (trainCount) groupCountsBySplit.train.set(groupKey, trainCount);
      else groupCountsBySplit.train.delete(groupKey);
      groupCountsBySplit.validation.set(groupKey, (groupCountsBySplit.validation.get(groupKey) || 0) + 1);
    }
  }

  for (const group of groups) {
    const split = assignments.get(group.id);
    for (const row of group.rows) {
      row.group_id = group.id;
      row.split = split;
    }
  }
}

let records;
if (sourceRows.length && sourceRows[0].department !== undefined) {
  const importedIds = new Set();
  records = sourceRows.map((row, index) => {
    const categoryKey = String(row.department || '').trim().toLowerCase();
    const category = CATEGORY_ALIASES.get(categoryKey);
    const severity = String(row.severity || '').trim();
    if (!category) throw new Error(`Unknown department label at row ${index + 2}: ${row.department || '(blank)'}`);
    if (!PRIORITIES.includes(severity)) throw new Error(`Unknown severity label at row ${index + 2}: ${severity || '(blank)'}`);
    if (!String(row.complaint_text || '').trim()) throw new Error(`Complaint text is blank at row ${index + 2}.`);
    const id = String(row.complaint_id || `row-${index + 2}`).trim();
    if (importedIds.has(id)) throw new Error(`Duplicate complaint ID at row ${index + 2}.`);
    importedIds.add(id);
    return {
      id,
      complaint_text: String(row.complaint_text).trim().replace(/\s+/g, ' '),
      category,
      severity,
      label_status: 'verified'
    };
  });
  splitImportedRows(records);
} else {
  records = sourceRows;
}

const splitByGroup = new Map();
for (const row of records) {
  if (!CATEGORIES.includes(row.category)) throw new Error(`Unknown category in dataset: ${row.category}`);
  if (!PRIORITIES.includes(row.severity)) throw new Error(`Unknown severity in dataset: ${row.severity}`);
  if (!['train', 'val', 'validation', 'test'].includes(row.split)) throw new Error(`Unknown split: ${row.split}`);
  if (row.split === 'val') row.split = 'validation';
  if (!row.group_id || !row.complaint_text) throw new Error(`Missing group_id or complaint_text in ${row.id || 'dataset row'}.`);
  const splits = splitByGroup.get(row.group_id) || new Set();
  splits.add(row.split);
  splitByGroup.set(row.group_id, splits);
}
if ([...splitByGroup.values()].some(splits => splits.size !== 1)) throw new Error('A group_id appears in multiple data splits.');

const preparedRows = records.map(row => ({
  ...row,
  complaint_text: row.complaint_text.trim().replace(/\s+/g, ' '),
  priority: row.severity
}));
const eligible = preparedRows.filter(row => row.label_status !== 'needs_review');
const trainingRows = eligible.filter(row => row.split === 'train');
if (!trainingRows.length) throw new Error('No eligible training rows found.');

const models = [
  { key: 'category', labels: CATEGORIES, rowsKey: 'categoryCounts', file: 'complaint-category-model.json' },
  { key: 'priority', labels: PRIORITIES, file: 'complaint-priority-model.json' }
];
for (const config of models) {
  const model = train(trainingRows, { labelKey: config.key, labels: config.labels, textKey: config.textKey || 'complaint_text' });
  model.training = {
    dataset: path.basename(datasetPath),
    split: 'train',
    splitMethod: 'Deterministic holdout grouped by the first five normalized tokens; validation coverage checked by department and severity.',
    excludedNeedsReview: preparedRows.filter(row => row.split === 'train' && row.label_status === 'needs_review').length,
    labels: model.categoryCounts,
    note: 'Source and label provenance were not supplied. Held-out results do not establish performance on real-campus complaints.'
  };
  model.evaluation = {};
  for (const split of ['validation', 'test']) {
    const evaluationRows = eligible.filter(row => row.split === split);
    if (!evaluationRows.length) throw new Error(`No eligible ${split} rows found.`);
    model.evaluation[split] = evaluate(model, evaluationRows, config.key);
  }
  fs.writeFileSync(path.join(root, 'lib', config.file), `${JSON.stringify(model)}\n`);
  const { test } = model.evaluation;
  console.log(`${config.key}: trained on ${model.documents} rows; test accuracy ${(test.accuracy * 100).toFixed(1)}%, macro-F1 ${(test.macroF1 * 100).toFixed(1)}%. Saved lib/${config.file}.`);
}
