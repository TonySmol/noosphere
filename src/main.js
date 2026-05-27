import { init, embed, vecToBase64 } from './embedder.js';
import { MyNotes } from './storage.js';
import { loadWorld, searchWorld, searchLocal, enqueueShare, getPending, exportPendingAsWorld } from './world.js';

// === DOM ===
const $ = id => document.getElementById(id);
const input = $('input');
const statusEl = $('status');
const searchBtn = $('searchBtn');
const shareBtn = $('shareBtn');
const personalSection = $('personalSection');
const personalResults = $('personalResults');
const worldSection = $('worldSection');
const worldResults = $('worldResults');
const myNotesEl = $('myNotes');

function setStatus(msg, spinner = false) {
  statusEl.innerHTML = (spinner ? '<span class="loader"></span> ' : '') + msg;
}

function setReady(ok) {
  searchBtn.disabled = !ok;
  shareBtn.disabled = !ok;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function renderCards(container, items, showActions = false) {
  if (!items.length) {
    container.innerHTML = '<div class="empty">Ничего не найдено</div>';
    return;
  }
  container.innerHTML = items.map(item => `
    <div class="card" data-id="${item.id}">
      <div class="card-text">${esc(item.excerpt || item.text)}</div>
      <div class="card-meta">
        ${item.score != null ? `<span class="score">${item.score.toFixed(2)}</span>` : `<span>${formatDate(item.date)}</span>`}
        ${item.score != null ? `<span>waves: ${item.waves || 0}</span>` : ''}
      </div>
      ${showActions ? `
        <div class="actions">
          <button class="ghost edit-btn">ред.</button>
          <button class="ghost delete-btn">удал.</button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

function renderMyNotes() {
  const notes = MyNotes.list();
  if (!notes.length) {
    myNotesEl.innerHTML = '<div class="empty">Пока нет заметок</div>';
    return;
  }
  myNotesEl.innerHTML = notes.map(n => `
    <div class="card" data-id="${n.id}">
      <div class="card-text">${esc(n.text)}</div>
      <div class="card-meta">
        <span>${formatDate(n.date)}${n.editedAt ? ' (изм.)' : ''}</span>
        <span>${n.vec ? '✓ вектор' : '○ нет вектора'}</span>
      </div>
      <div class="actions">
        <button class="ghost edit-btn">ред.</button>
        <button class="ghost delete-btn">удал.</button>
      </div>
    </div>
  `).join('');
}

// === Поиск ===
async function runSearch() {
  const text = input.value.trim();
  if (!text) {
    personalSection.style.display = 'none';
    worldSection.style.display = 'none';
    return;
  }
  
  setStatus('Поиск...', true);
  try {
    const qVec = await embed(text);
    const [local, world] = await Promise.all([
      Promise.resolve(searchLocal(qVec, MyNotes.list())),
      searchWorld(qVec)
    ]);
    
    personalSection.style.display = 'block';
    renderCards(personalResults, local);
    
    worldSection.style.display = 'block';
    renderCards(worldResults, world);
    
    setStatus('Готово');
  } catch (e) {
    setStatus('Ошибка поиска: ' + e.message);
    console.error(e);
  }
}

// === Сохранение в личное ===
async function saveToLocal(text) {
  const note = MyNotes.add(text);
  setStatus('Векторизация...', true);
  const vec = await embed(text);
  MyNotes.updateVec(note.id, vec);
  return { ...note, vec };
}

// === Инициализация ===
async function boot() {
  try {
    await init((p) => {
      if (p.status === 'progress') {
        setStatus(`Загрузка модели: ${Math.round(p.progress || 0)}%`, true);
      } else if (p.status === 'done') {
        setStatus('Модель готова. Загрузка мировых заметок...', true);
      }
    });
    
    await loadWorld();
    setStatus(`Готово. В мире: ${getWorldCache().length} заметок.`);
    setReady(true);
    renderMyNotes();
  } catch (e) {
    setStatus('Ошибка запуска: ' + e.message);
    console.error(e);
  }
}

// === События ===
let searchTimer;
input.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 600);
});

searchBtn.addEventListener('click', runSearch);

shareBtn.addEventListener('click', async () => {
  const text = input.value.trim();
  if (!text) return;
  
  setStatus('Подготовка...', true);
  try {
    const note = await saveToLocal(text);
    const count = enqueueShare(note);
    input.value = '';
    personalSection.style.display = 'none';
    worldSection.style.display = 'none';
    setStatus(`✓ Сохранено + в очереди на публикацию (${count} шт).`);
    renderMyNotes();
  } catch (e) {
    setStatus('Ошибка: ' + e.message);
  }
});

// Клики по заметкам (редактирование/удаление)
myNotesEl.addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  
  if (e.target.classList.contains('delete-btn')) {
    if (confirm('Удалить заметку?')) {
      MyNotes.remove(id);
      renderMyNotes();
    }
  } else if (e.target.classList.contains('edit-btn')) {
    const note = MyNotes.list().find(n => n.id === id);
    const newText = prompt('Редактировать:', note.text);
    if (newText !== null && newText.trim()) {
      MyNotes.updateText(id, newText.trim());
      setStatus('Пересчёт вектора...', true);
      const vec = await embed(newText.trim());
      MyNotes.updateVec(id, vec);
      setStatus('Готово');
      renderMyNotes();
    }
  }
});

// Автопоиск по истории при загрузке (если что-то в поле)
boot();
