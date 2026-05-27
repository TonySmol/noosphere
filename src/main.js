import { initEmbedder, embed } from './adapters/transformers.js';
import { upsert, search } from './adapters/qdrant.js';
import { setStatus, setSendEnabled, renderResults } from './ui/renderer.js';

// DOM
const input = document.getElementById('thought-input');
const sendBtn = document.getElementById('send-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

// Инициализация
async function init() {
  try {
    await initEmbedder((progress) => {
      if (progress.status === 'loading') {
        setStatus(`Загрузка модели... ${Math.round(progress.progress * 100)}%`);
      } else if (progress.status === 'done') {
        setStatus('✅ Готов');
        setSendEnabled(true);
      }
    });
  } catch (e) {
    setStatus('❌ Ошибка модели: ' + e.message);
    console.error(e);
  }
}
init();

// Отправка
sendBtn.addEventListener('click', async () => {
  const text = input.value.trim();
  if (!text) return;
  
  setStatus('⏳ Векторизация...');
  setSendEnabled(false);
  
  try {
    const vector = await embed(text);
    setStatus('📤 Отправка...');
    await upsert(vector, text);
    setStatus('✅ В мире!');
    input.value = '';
    const results = await search(vector);
    renderResults(results, resultsEl);
  } catch (e) {
    setStatus('❌ ' + e.message.slice(0, 80));
    console.error(e);
  } finally {
    setSendEnabled(true);
  }
});

// Живой поиск
let searchTimeout;
input.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    const text = e.target.value.trim();
    if (text.length < 10) return;
    
    try {
      const vector = await embed(text);
      const results = await search(vector);
      renderResults(results, resultsEl);
    } catch (e) {
      // Тихо игнорируем ошибки поиска при вводе
    }
  }, 500);
});
