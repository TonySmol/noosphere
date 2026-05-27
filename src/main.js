import { init, embed } from './embedder.js';
import { MyNotes } from './storage.js';
import {
  loadWorld,
  getWorldCache,
  searchWorld,
  searchLocal,
  enqueueShare,
  getPending,
  clearPending,
  exportPendingAsWorld
} from './world.js';

// === DOM ===
const $ = id => document.getElementById(id);
const input = $('input');
const statusEl = $('status');
const saveBtn = $('saveBtn');
const shareCheckbox = $('shareCheckbox');
const exportBtn = $('exportBtn');
const personalSection = $('personalSection');
const personalResults = $('personalResults');
const worldSection = $('worldSection');
const worldResults = $('worldResults');
const myNotesEl = $('myNotes');

function setStatus(msg, spinner = false) {
  statusEl.innerHTML = (spinner ? '<span class="loader"></span> ' : '') + msg;
}

function setReady(ok) {
  saveBtn.disabled = !ok;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU') + ' ' +
    d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function renderLocalCards(items) {
  if (!items.length) {
    return '<div class="empty">Нет похожих заметок</div>';
  }
  return items.map(item => `
    <div class="card" data-id="${item.id}">
      <div class="card-text">${esc(item.text)}</div>
      <div class="card-meta">
        <span>${formatDate(item.date)}</span>
        <span class="score">${item.score.toFixed(2)}</span>
      </div>
    </div>
  `).join('');
}

function renderWorldCards(items) {
  if (!items.length) return '';
  return items.map(item => `
    <div class="card" data-id="${item.id}">
      <div class="card-text">${esc(item.excerpt || '(пусто)')}</div>
      <div class="card-meta">
        <span>${new Date(item.timestamp).toLocaleDateString('ru-RU')}</span>
        <span class="score">${item.score.toFixed(2)} · 🌊 ${item.waves || 0}</span>
      </div>
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

function updatePendingButton() {
  const count = getPending().length;
  exportBtn.textContent = count
    ? `📤 Экспорт очереди (${count})`
    : '📤 Экспорт очереди';
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
    const local = searchLocal(qVec, MyNotes.list());
    const { relevant, serendipity } = await searchWorld(qVec);

    personalSection.style.display = local.length ? 'block' : 'none';
    personalResults.innerHTML = renderLocalCards(local);

    const hasWorld = relevant.length || serendipity.length;
    worldSection.style.display = hasWorld ? 'block' : 'none';

    if (hasWorld) {
      worldResults.innerHTML = `
        ${relevant.length ? '<div class="sub-section-title relevant">Релевантные</div>' : ''}
        ${renderWorldCards(relevant)}
        ${serendipity.length ? '<div class="sub-section-title serendipity">Смежные</div>' : ''}
        ${renderWorldCards(serendipity)}
      `;
    } else {
      worldResults.innerHTML = '<div class="empty">Ничего не найдено</div>';
    }

    setStatus('Готово');
  } catch (e) {
    setStatus('Ошибка поиска: ' + e.message);
    console.error(e);
  }
}

// === Сохранение ===
async function saveToLocal(text) {
  const note = MyNotes.add(text);
  const vec = await embed(text);
  MyNotes.updateVec(note.id, vec);
  return { ...note, vec };
}

saveBtn.addEventListener('click', async () => {
  const text = input.value.trim();
  if (!text) return;

  setStatus('Сохранение...', true);
  setReady(false);
  try {
    const note = await saveToLocal(text);
    input.value = '';
    personalSection.style.display = 'none';
    worldSection.style.display = 'none';

    if (shareCheckbox.checked) {
      const count = enqueueShare(note);
      setStatus(`✓ Сохранено + в очереди на публикацию (${count} шт).`);
      shareCheckbox.checked = false;
    } else {
      setStatus('✓ Сохранено локально.');
    }

    renderMyNotes();
    updatePendingButton();
  } catch (e) {
    setStatus('Ошибка: ' + e.message);
    console.error(e);
  } finally {
    setReady(true);
  }
});

exportBtn.addEventListener('click', async () => {
  const pending = getPending();
  if (!pending.length) {
    alert('Очередь пуста. Сохраните заметки с галочкой "Отправить в мир".');
    return;
  }
  setStatus('Экспорт...', true);
  try {
    await exportPendingAsWorld();
    clearPending();
    updatePendingButton();
    setStatus('✓ Файл world-pending.json скачан. Вручную добавьте его содержимое в world.json репозитория.');
  } catch (e) {
    setStatus('Ошибка экспорта: ' + e.message);
  }
});

// === События редактирования ===
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

// === Живой поиск ===
let searchTimer;
input.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 600);
});

// === Старт ===
async function boot() {
  try {
    await init((p) => {
      if (p.status === 'progress') {
        setStatus(`Загрузка модели: ${Math.round(p.progress || 0)}%`, true);
      } else if (p.status === 'done') {
        setStatus('Модель готова. Загрузка мировых заметок...', true);
      }
    });

    const count = await loadWorld();
    setStatus(`Готово. В мире: ${count.length} заметок.`);
    setReady(true);
    renderMyNotes();
    updatePendingButton();
  } catch (e) {
    setStatus('Ошибка запуска: ' + e.message);
    console.error(e);
  }
}

boot();
