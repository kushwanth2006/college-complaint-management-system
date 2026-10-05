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

function train(rows) {
  const categoryCounts = Object.fromEntries(CATEGORIES.map(category => [category, 0]));
  const featureCounts = Object.fromEntries(CATEGORIES.map(category => [category, {}]));
  const featureTotals = Object.fromEntries(CATEGORIES.map(category => [category, 0]));
  const vocabulary = new Set();

  for (const row of rows) {
    if (!CATEGORIES.includes(row.category)) throw new Error(`Unknown category: ${row.category}`);
    categoryCounts[row.category]++;
    for (const [feature, count] of Object.entries(extractFeatures(row.complaint_text))) {
      vocabulary.add(feature);
      featureCounts[row.category][feature] = (featureCounts[row.category][feature] || 0) + count;
      featureTotals[row.category] += count;
    }
  }

  return {
    algorithm: 'multinomial-naive-bayes',
    alpha: 0.5,
    categories: CATEGORIES,
    documents: rows.length,
    vocabulary: [...vocabulary].sort(),
    categoryCounts,
    featureCounts,
    featureTotals
  };
}

function predict(text, model) {
  const features = extractFeatures(text);
  if (!Object.keys(features).length) return { category: 'General', confidence: 35 };

  const totalDocuments = model.documents;
  const vocabularySize = model.vocabulary.length;
  const scores = model.categories.map(category => {
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
  return { category: probabilities[0].category, confidence: Math.round(probabilities[0].probability / total * 100) };
}

module.exports = { CATEGORIES, extractFeatures, train, predict };
