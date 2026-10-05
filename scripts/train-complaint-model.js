const fs = require('node:fs');
const path = require('node:path');
const { CATEGORIES, train } = require('../lib/category-classifier');

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

const root = path.resolve(__dirname, '..');
const datasetPath = path.join(root, 'data', 'complaint-category-dataset-v2.csv');
const outputPath = path.join(root, 'lib', 'complaint-category-model.json');
const records = parseCsv(fs.readFileSync(datasetPath, 'utf8'));
const splitByGroup = new Map();
for (const row of records) {
  if (!CATEGORIES.includes(row.category)) throw new Error(`Unknown category in dataset: ${row.category}`);
  const splits = splitByGroup.get(row.group_id) || new Set();
  splits.add(row.split);
  splitByGroup.set(row.group_id, splits);
}
if ([...splitByGroup.values()].some(splits => splits.size !== 1)) throw new Error('A group_id appears in multiple data splits.');

const trainingRows = records.filter(row => row.split === 'train' && row.label_status !== 'needs_review');
if (!trainingRows.length) throw new Error('No eligible training rows found.');
const model = train(trainingRows);
model.training = {
  dataset: 'complaint-category-dataset-v2.csv',
  split: 'train',
  excludedNeedsReview: records.filter(row => row.split === 'train' && row.label_status === 'needs_review').length,
  rowsByCategory: model.categoryCounts,
  note: 'All source examples are synthetic; scores are not calibrated on real campus complaints.'
};
fs.writeFileSync(outputPath, `${JSON.stringify(model)}\n`);
console.log(`Trained ${model.algorithm} on ${model.documents} training rows across ${CATEGORIES.length} categories.`);
console.log(`Excluded ${model.training.excludedNeedsReview} needs_review rows. Saved ${path.relative(root, outputPath)}.`);
