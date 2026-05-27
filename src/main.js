import { pipeline } from '@xenova/transformers';

// ⚠️ ВСТАВЬ СВОЙ QDRANT KEY И URL НИЖЕ
const QDRANT_URL = 'https://YOUR-CLUSTER.qdrant.tech';
const QDRANT_KEY = 'your-api-key-here';
const COLLECTION = 'noosphere';

const $ = id => document.getElementById(id);
const status = msg => $('status').textContent = msg;

// 1. Инициализация модели
status('Загрузка модели...');
const embedder = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', { quantized: true });
status('Готов');

// 2. Векторизация + отправка в Qdrant
async function sendToWorld(text) {
  const output = await embedder(text);
  const vector = Array.from(output.data); // 384 числа
  
  const payload = {
    text: text.slice(0, 200),
    timestamp: Date.now(),
    waves: 0
  };

  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points`, {
    method: 'PUT',
    headers: { 'api-key': QDRANT_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      points: [{ id: crypto.randomUUID(), vector, payload }]
    })
  });
  
  if (!res.ok) throw new Error(`Qdrant error: ${res.status}`);
}

// 3. Поиск похожих в мире
async function searchWorld(text) {
  const output = await embedder(text);
  const vector = Array.from(output.data);
  
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION}/points/search`, {
    method: 'POST',
    headers: { 'api-key': QDRANT_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vector,
      limit: 5,
      score_threshold: 0.3,
      with_payload: true
    })
  });
  
  if (!res.ok) throw new Error(`Search error: ${res.status}`);
  const data = await res.json();
  return data.result;
}

// 4. UI-логика
$('sendBtn').addEventListener('click', async () => {
  const text = $('input').value.trim();
  if (!text) return;
  
  status('Отправка...');
  try {
    await sendToWorld(text);
    $('input').value = '';
    status('✅ Отправлено');
    await renderResults(text);
  } catch (e) {
    status('❌ Ошибка: ' + e.message);
    console.error(e);
  }
});

async function renderResults(query) {
  const results = await searchWorld(query);
  $('results').innerHTML = results.map(r => 
    `<div class="card"><strong>(${r.score.toFixed(2)})</strong> ${r.payload.text}</div>`
  ).join('') || '<div class="card">Ничего не найдено</div>';
}

// Автопоиск при вводе (с задержкой)
let t;
$('input').addEventListener('input', (e) => {
  clearTimeout(t);
  t = setTimeout(() => {
    if (e.target.value.length > 10) renderResults(e.target.value);
  }, 500);
});
