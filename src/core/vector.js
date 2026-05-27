export function normalize(vector) {
  const magnitude = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return magnitude > 0 ? vector.map(x => x / magnitude) : vector;
}

export function cosineSimilarity(a, b) {
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

export function meanPool(embedding) {
  // transformers.js уже возвращает pooled вектор, но на всякий случай
  return embedding;
}
