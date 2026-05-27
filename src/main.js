import { init, embed } from './embedder.js';
import { MyNotes } from './storage.js';
import { searchWorld, searchLocal, publish, waveUp, getInfo } from './qdrant.js';

const $ = id => document.getElementById(id);
const input = $('input');
const statusEl = $('status');
const saveBtn = $('saveBtn');
const shareCheckbox = $('shareCheckbox');
const personalSection = $('personalSection');
const personalResults = $('personalResults');
const worldSection = $('worldSection');
const worldResults = $('worldResults');
const myNotesEl = $('myNotes');

const setStatus = (msg, spinner = false) =>
  statusEl.innerHTML = (spinner ? '<span class="loader"></span> ' : '') + msg;

const setReady = ok => saveBtn.disabled = !ok;

const esc = s => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

const formatDate = iso => {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

function renderLocalCards(items) {
  if (!items.length) return '<div class="empty">Нет похожих</div>';
  return items.map(it => `
    <div class="card"><div class="card-text">${esc(it.text)}</div>
      <div class="card-meta"><span>${formatDate(it.date)}</span><span class="score">${it.score.toFixed(2)}</span></div></div>
  `).join('');
}

function renderWorldCards(items) {
  if (!items.length) return '';
  return items.map(it => `
    <div class="card" data-wid="${it.id}">
      <div class="card-text">${esc(it.excerpt || '(пусто)')}</div>
      <div class="card-meta">
        <span>${new Date(it.timestamp).toLocaleDateString('ru-RU')}</span>
        <span class="score">${it.score.toFixed(2)} · 🌊 ${it.waves}
          <button class="wave-btn" data-wave="${it.id}" title="Поддержать">+</button>
        </span>
      </div>
    </div>
  `).join('');
}

function renderMyNotes() {
  const notes = MyNotes.list();
  if (!notes.length) { myNotesEl.innerHTML = '<div class="empty">Пока нет заметок</div>'; return; }
  myNotesEl.innerHTML = notes.map(n => `
    <div class="card" data-id="${n.id}">
      <div class="card-text">${esc(n.text)}</div>
      <div class="card-meta">
        <span>${formatDate(n.date)}${n.editedAt ? ' (изм.)' : ''}</span>
        <span>${n.vec ? '✓' : '○'}</span>
      </div>
      <div class="actions">
        <button class="ghost edit-btn">ред.</button>
        <button class="ghost delete-btn">удал.</button>
      </div>
    </div>
  `).join('');
}

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
    personalSection.style.display = local.length ? 'block' : 'none';
    personalResults.innerHTML = renderLocalCards(local);
    const hasWorld = world.relevant.length || world.serendipity.length;
    worldSection.style.display = hasWorld ? 'block' : 'none';
    if (hasWorld) {
      worldResults.innerHTML = `
        ${world.relevant.length ? '<div class="sub-title relevant">Релевантные</div>' : ''}
        ${renderWorldCards(world.relevant)}
        ${world.serendipity.length ? '<div class="sub-title serendipity">Смежные</div>' : ''}
        ${renderWorldCards(world.serendipity)}
      `;
    } else {
      worldResults.innerHTML = '<div class="empty">В мире пока нет похожих</div>';
    }
    setStatus('Готово');
  } catch (e) {
    setStatus('Ошибка: ' + e.message);
    console.error(e);
  }
}

saveBtn.addEventListener('click', async () => {
  const text = input.value.trim();
  if (!text) return;
  setStatus('Сохранение...', true);
  setReady(false);
  try {
    const note = MyNotes.add(text);
    const vec = await embed(text);
    MyNotes.updateVec(note.id, vec);
    if (shareCheckbox.checked) {
      setStatus('Публикация в мир...', true);
      await publish(vec, text);
      shareCheckbox.checked = false;
      setStatus('✓ Сохранено + опубликовано в мире.');
    } else {
      setStatus('✓ Сохранено локально.');
    }
    input.value = '';
    personalSection.style.display = 'none';
    worldSection.style.display = 'none';
    renderMyNotes();
  } catch (e) {
    setStatus('Ошибка: ' + e.message);
    console.error(e);
  } finally {
    setReady(true);
  }
});

// Клики: ред/удал своих + лайк мировых
document.body.addEventListener('click', async e => {
  const card = e.target.closest('.card');
  const waveId = e.target.dataset.wave;
  if (waveId) {
    try {
      await waveUp(waveId);
      runSearch();
    } catch (err) { console.error(err); }
    return;
  }
  if (!card) return;
  const id = card.dataset.id;
  if (!id) return;
  if (e.target.classList.contains('delete-btn')) {
    if (confirm('Удалить?')) { MyNotes.remove(id); renderMyNotes(); }
  } else if (e.target.classList.contains('edit-btn')) {
    const note = MyNotes.list().find(n => n.id === id);
    const newText = prompt('Редактировать:', note.text);
    if (newText && newText.trim()) {
      MyNotes.updateText(id, newText.trim());
      setStatus('Пересчёт...', true);
      const vec = await embed(newText.trim());
      MyNotes.updateVec(id, vec);
      setStatus('Готово');
      renderMyNotes();
    }
  }
});

let timer;
input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runSearch, 600); });

async function boot() {
  try {
    await init(p => {
      if (p.status === 'progress') setStatus(`Модель: ${Math.round(p.progress || 0)}%`, true);
      else if (p.status === 'done') setStatus('Подключение к миру...', true);
    });
    const count = await getInfo();
    setStatus(`Готово. В мире: ${count} заметок.`);
    setReady(true);
    renderMyNotes();
  } catch (e) {
    setStatus('Ошибка: ' + e.message);
    console.error(e);
  }
}

boot();
