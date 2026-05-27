import { CONFIG } from '../config.js';

async function request(endpoint, body) {
  const response = await fetch(`${CONFIG.qdrant.url}${endpoint}`, {
    method: 'POST',
    headers: {
      'api-key': CONFIG.qdrant.key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Qdrant ${response.status}: ${err.slice(0, 100)}`);
  }
  return response.json();
}

export async function upsert(vector, text) {
  return request(`/collections/${CONFIG.qdrant.collection}/points`, {
    points: [{
      id: crypto.randomUUID(),
      vector,
      payload: { text: text.slice(0, 500), timestamp: Date.now(), waves: 0 }
    }]
  });
}

export async function search(vector, limit = CONFIG.search.limit) {
  const data = await request(`/collections/${CONFIG.qdrant.collection}/points/search`, {
    vector,
    limit,
    score_threshold: CONFIG.search.threshold,
    with_payload: true
  });
  return data.result || [];
}
