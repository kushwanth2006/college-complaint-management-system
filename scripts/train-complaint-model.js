const fs = require('node:fs');
const path = require('node:path');
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
const datasetPath = path.join(root, 'data', 'student_complaints_training.csv');
const records = parseCsv(fs.readFileSync(datasetPath, 'utf8'));
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
    excludedNeedsReview: preparedRows.filter(row => row.split === 'train' && row.label_status === 'needs_review').length,
    labels: model.categoryCounts,
    note: 'Evaluation reflects this dataset and does not establish performance on real-campus complaints.'
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
