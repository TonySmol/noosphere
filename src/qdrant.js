import { CONFIG } from './config.js';

async function request(path, method = 'GET', body = null) {
  const res = await fetch(`${CONFIG.workerUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Qdrant ${res.status}: ${err.slice(0, 150)}`);
  }
  return res.json();
}

export async function publish(vector, text) {
  const id = crypto.randomUUID();
  return request(`/collections/${CONFIG.collection}/points`, 'PUT', {
    points: [{
      id,
      vector,
      payload: {
        excerpt: text.slice(0, CONFIG.excerptLen),
        timestamp: Date.now(),
        waves: 0,
        source: 'user'
      }
    }]
  });
}

export async function searchWorld(vector, limit = CONFIG.search.limit) {
  const data = await request(`/collections/${CONFIG.collection}/points/search`, 'POST', {
    vector,
    limit: limit * 2,  // берём больше для разделения на relevant/serendipity
    score_threshold: CONFIG.search.threshold - CONFIG.serendipityDelta,
    with_payload: true,
    filter: CONFIG.search.minWaves > 0
      ? { must: [{ key: 'waves', range: { gte: CONFIG.search.minWaves } }] }
      : undefined
  });

  const scored = (data.result || []).map(r => ({
    id: String(r.id),
    score: r.score,
    excerpt: r.payload?.excerpt || '',
    timestamp: r.payload?.timestamp || 0,
    waves: r.payload?.waves || 0
  }));

  const relevant = scored.filter(r => r.score >= CONFIG.search.threshold).slice(0, limit);
  const serendipity = scored
    .filter(r => r.score >= CONFIG.search.threshold - CONFIG.search.serendipityDelta && r.score < CONFIG.search.threshold)
    .slice(0, limit);

  return { relevant, serendipity };
}

export async function waveUp(id) {
  return request(`/collections/${CONFIG.collection}/points/payload`, 'POST', {
    payload: { waves: { '+=': 1 } },
    points: [id]
  });
}

export async function getInfo() {
  try {
    const data = await request(`/collections/${CONFIG.collection}`);
    return data.result?.points_count || 0;
  } catch {
    return 0;
  }
}

export function searchLocal(queryVec, myNotes, limit = CONFIG.search.limit) {
  const scored = myNotes.filter(n => n.vec).map(n => {
    let s = 0;
    for (let i = 0; i < queryVec.length; i++) s += queryVec[i] * n.vec[i];
    return { ...n, score: s };
  });
  return scored
    .filter(r => r.score >= CONFIG.search.threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
