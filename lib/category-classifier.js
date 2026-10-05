const CATEGORIES = ['Hostel', 'Mess', 'Academic', 'Wi-Fi & Network', 'Transport', 'Library', 'General'];
const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'has', 'have', 'i', 'in', 'is', 'it', 'my', 'of', 'on', 'or', 'our', 'the', 'this', 'to', 'was', 'we', 'with']);

function extractFeatures(text) {
  const tokens = (String(text || '').toLowerCase().replace(/\bwi[\s-]+fi\b/g, 'wifi').match(/[a-z0-9]+/g) || []);
  const features = {};
  for (const token of tokens) {
    if (token.length > 1 && !STOP_WORDS.has(token)) features[`u:${token}`] = (features[`u:${token}`] || 0) + 1;
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const feature = `b:${tokens[i]}_${tokens[i + 1]}`;
    features[feature] = (features[feature] || 0) + 1;
  }
  return features;
}

function train(rows, { labelKey = 'category', labels = CATEGORIES, textKey = 'complaint_text' } = {}) {
  const categoryCounts = Object.fromEntries(labels.map(label => [label, 0]));
  const featureCounts = Object.fromEntries(labels.map(label => [label, {}]));
  const featureTotals = Object.fromEntries(labels.map(label => [label, 0]));
  const vocabulary = new Set();

  for (const row of rows) {
    const label = row[labelKey];
    if (!labels.includes(label)) throw new Error(`Unknown ${labelKey}: ${label}`);
    categoryCounts[label]++;
    for (const [feature, count] of Object.entries(extractFeatures(row[textKey]))) {
      vocabulary.add(feature);
      featureCounts[label][feature] = (featureCounts[label][feature] || 0) + count;
      featureTotals[label] += count;
    }
  }

  return {
    algorithm: 'multinomial-naive-bayes',
    alpha: 0.5,
    labels,
    textKey,
    documents: rows.length,
    vocabulary: [...vocabulary].sort(),
    categoryCounts,
    featureCounts,
    featureTotals
  };
}

function predictLabel(text, model) {
  const labels = model.labels || model.categories;
  const features = extractFeatures(text, model.featureMode);
  if (!Object.keys(features).length) return { label: labels.includes('General') ? 'General' : labels[0], confidence: 35 };

  const totalDocuments = model.documents;
  const vocabularySize = model.vocabulary.length;
  const scores = labels.map(category => {
    let score = Math.log(model.categoryCounts[category] / totalDocuments);
    const denominator = model.featureTotals[category] + model.alpha * vocabularySize;
    for (const [feature, count] of Object.entries(features)) {
      const frequency = model.featureCounts[category][feature] || 0;
      score += count * Math.log((frequency + model.alpha) / denominator);
    }
    return { category, score };
  });

  const max = Math.max(...scores.map(item => item.score));
  const probabilities = scores.map(item => ({ ...item, probability: Math.exp(item.score - max) }));
  const total = probabilities.reduce((sum, item) => sum + item.probability, 0);
  probabilities.sort((a, b) => b.probability - a.probability);
  return { label: probabilities[0].category, confidence: Math.round(probabilities[0].probability / total * 100) };
}

function predict(text, model) {
  const result = predictLabel(text, model);
  return { category: result.label, confidence: result.confidence };
}

module.exports = { CATEGORIES, extractFeatures, train, predict, predictLabel };
