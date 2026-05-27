import { CONFIG } from './config.js';
import { vecToBase64, vecFromBase64, embed } from './embedder.js';

const PENDING_KEY = 'noosphere_pending_shares';
let cachedWorld = null;

export async function loadWorld() {
  try {
    const res = await fetch(CONFIG.worldRawUrl + '?t=' + Date.now());
    if (!res.ok) {
      if (res.status === 404) {
        console.info('world.json ещё не создан — начинаем с пустого мира');
      } else {
        console.warn('Не удалось загрузить world.json: HTTP ' + res.status);
      }
      cachedWorld = { notes: [] };
      return [];
    }
    cachedWorld = await res.json();
    return cachedWorld.notes || [];
  } catch (e) {
    console.warn('Ошибка сети при загрузке world.json:', e.message);
    cachedWorld = { notes: [] };
    return [];
  }
}

export function getWorldCache() {
  return cachedWorld?.notes || [];
}

export async function searchWorld(queryVec, limit = CONFIG.search.limit) {
  const notes = getWorldCache();

  const scored = notes.map(n => {
    const vec = vecFromBase64(n.vec);
    const score = cosine(queryVec, vec);
    return { ...n, vec, score };
  });

  const relevantThreshold = CONFIG.search.threshold;
  const serendipityThreshold = relevantThreshold - CONFIG.serendipityDelta;

  const relevant = scored
    .filter(r => r.score >= relevantThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const serendipity = scored
    .filter(r => r.score >= serendipityThreshold && r.score < relevantThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { relevant, serendipity };
}

export function searchLocal(queryVec, myNotes, limit = CONFIG.search.limit) {
  const scored = myNotes
    .filter(n => n.vec)
    .map(n => ({ ...n, score: cosine(queryVec, n.vec) }));
  return scored
    .filter(r => r.score >= CONFIG.search.threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function enqueueShare(note) {
  const q = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
  q.push({
    id: crypto.randomUUID(),
    excerpt: note.text.slice(0, CONFIG.excerptLen),
    fullText: note.text,
    vec: note.vec,
    timestamp: Date.now()
  });
  localStorage.setItem(PENDING_KEY, JSON.stringify(q));
  return q.length;
}

export function getPending() {
  return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
}

export function clearPending() {
  localStorage.setItem(PENDING_KEY, '[]');
}

export async function exportPendingAsWorld() {
  const pending = getPending();
  if (!pending.length) { alert('Очередь пуста'); return; }

  const newNotes = await Promise.all(pending.map(async p => {
    let vec = p.vec;
    if (!vec) {
      vec = await embed(p.fullText);
    }
    return {
      id: p.id,
      vec: vecToBase64(vec),
      excerpt: p.excerpt,
      timestamp: p.timestamp,
      waves: 0
    };
  }));

  const blob = new Blob(
    [JSON.stringify({ notes: newNotes }, null, 2)],
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'world-pending.json';
  a.click();
  URL.revokeObjectURL(url);
}
