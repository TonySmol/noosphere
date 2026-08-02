import { embed, isReady } from './lib/embed.js';
import { vecToB64, b64ToVec, cosine } from './lib/vec.js';
import { pubkey, publishNote, subscribeFeed } from './lib/nostr.js';

const ROOM = 'noomium-slice1';
const notes = new Map();      // id -> {id, text, vec?, author, ts}
let contextVec = null;        // вектор закреплённой заметки
let contextId = null;

const $ = id => document.getElementById(id);
const feedEl = $('feed'), input = $('input'), statusEl = $('status');

function setStatus(t) { statusEl.textContent = t; }

function vTag(ev) {
  const t = ev.tags.find(t => t[0] === 'v');
  return t ? t[1] : null;
}

function render() {
  let list = [...notes.values()];
  if (contextVec) {
    list = list
      .filter(n => n.vec)
      .map(n => ({ ...n, score: cosine(contextVec, n.vec) }))
      .sort((a, b) => b.score - a.score);
  } else {
    list.sort((a, b) => b.ts - a.ts);
  }

  feedEl.innerHTML = '';
  for (const n of list) {
    const el = document.createElement('article');
    el.className = 'note' + (n.id === contextId ? ' pinned' : '');
    el.dataset.id = n.id;

    const sim = n.score != null
      ? `<span class="sim">${Math.round(n.score * 100)}%</span>` : '';
    el.innerHTML = `
      <div class="note-text"></div>
      <div class="note-meta">
        <span class="author">${n.author.slice(0, 8)}…</span>
        <span class="time">${new Date(n.ts * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
        ${sim}
      </div>`;
    el.querySelector('.note-text').textContent = n.text; // безопасно
    el.addEventListener('click', () => togglePin(n));
    feedEl.appendChild(el);
  }
}

function togglePin(n) {
  if (!n.vec) return;
  if (contextId === n.id) { contextId = null; contextVec = null; setStatus('пин снят'); }
  else { contextId = n.id; contextVec = n.vec; setStatus('закреплено — лента по смыслу'); }
  render();
}

function onEvent(ev) {
  if (notes.has(ev.id)) return;
  const b64 = vTag(ev);
  let vec = null;
  try { if (b64) vec = b64ToVec(b64); } catch { vec = null; }
  notes.set(ev.id, { id: ev.id, text: ev.content, vec, author: ev.pubkey, ts: ev.created_at });
  render();
}

async function send() {
  const text = input.value.trim();
  if (!text) return;
  $('send').disabled = true;
  try {
    setStatus(isReady() ? 'считаем вектор…' : 'грузим модель (первый раз, ~40 МБ)…');
    const vec = await embed(text, p => {
      if (p.status === 'progress' && p.total)
        setStatus(`модель: ${Math.round(p.loaded / p.total * 100)}%`);
    });
    setStatus('публикуем…');
    await publishNote(text, vecToB64(vec), ROOM);
    input.value = '';
    setStatus('опубликовано');
  } catch (e) {
    setStatus('ошибка: ' + (e.message || e));
  } finally {
    $('send').disabled = false;
  }
}

$('send').addEventListener('click', send);
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

$('me').textContent = 'ты: ' + pubkey().slice(0, 8) + '…';
subscribeFeed(ROOM, onEvent);
setStatus('слушаю комнату #' + ROOM);
