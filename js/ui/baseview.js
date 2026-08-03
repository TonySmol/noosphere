// ─── UI/BaseView ─── START ───────────────────────────────────
/**
 * Экран «База»: список своих заметок, статистика, поиск, сортировка.
 * Клик по заметке открывает NoteView (просмотр/правка/удаление).
 * Обновляется по db:change / смене вида / языка.
 * @deps Store, DB, I18n, Utils, EventBus
 * @exports BaseView
 */
DI.register('BaseView', function (Store, DB, I18n, Utils, bus) {
  let listEl, statsTotal, statsOpen, statsPriv, qEl, sortEl;
  let unsubs = [];
  let rafPending = false;

  function bind() {
    listEl = document.getElementById('base-list');
    statsTotal = document.getElementById('bs-total');
    statsOpen = document.getElementById('bs-open');
    statsPriv = document.getElementById('bs-priv');
    qEl = document.getElementById('base-q');
    sortEl = document.getElementById('base-sort');
  }

  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; render(); });
  }

  /** Перерисовывает статистику и список. */
  function render() {
    if (!listEl) return;
    const view = Store.get('view');
    if (view !== 'base') return;   // рисуем только когда активны

    const q = (qEl && qEl.value || '').trim().toLowerCase();
    const sort = (sortEl && sortEl.value) || 'new';

    DB.all().then(notes => {
      let arr = notes.slice();
      if (q) arr = arr.filter(n => (n.text || '').toLowerCase().includes(q));
      if (sort === 'old') arr.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      else if (sort === 'az') arr.sort((a, b) => (a.text || '').localeCompare(b.text || '', I18n.getLang() === 'en' ? 'en' : 'ru'));
      else arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      // статистика (по всем, не по фильтру)
      const shared = notes.filter(n => n.shared).length;
      if (statsTotal) statsTotal.textContent = notes.length;
      if (statsOpen) statsOpen.textContent = shared;
      if (statsPriv) statsPriv.textContent = notes.length - shared;

      listEl.innerHTML = '';
      if (!arr.length) {
        const empty = document.createElement('div');
        empty.className = 'note';
        empty.style.cursor = 'default';
        empty.textContent = q ? I18n.t('empty.base.empty') : I18n.t('empty.base.t');
        listEl.appendChild(empty);
        return;
      }

      const frag = document.createDocumentFragment();
      arr.forEach(n => frag.appendChild(row(n)));
      listEl.appendChild(frag);
    }).catch(() => {});
  }

  /** Строка списка базы. @param {Object} n */
  function row(n) {
    const el = document.createElement('div');
    el.className = 'bi';
    el.style.cursor = 'pointer';
    el.dataset.id = n.id;

    const t = document.createElement('div');
    t.className = 'bi-t';
    t.textContent = n.text || '';
    el.appendChild(t);

    const f = document.createElement('div');
    f.className = 'bi-f';

    const tag = document.createElement('span');
    tag.className = 'note-tag ' + (n.shared ? 'world' : 'priv');
    tag.textContent = n.shared ? I18n.t('base.tag.shared') : I18n.t('base.tag.private');
    f.appendChild(tag);

    const date = document.createElement('span');
    date.textContent = Utils.fmtDate(n.updatedAt || n.createdAt, I18n.getLang());
    f.appendChild(date);

    el.appendChild(f);
    el.addEventListener('click', () => { try { bus.emit('note:open', { id: n.id }); } catch (_) {} });
    return el;
  }

  function init() {
    bind();
    if (!listEl) return;
    if (qEl) qEl.addEventListener('input', scheduleRender);
    if (sortEl) sortEl.addEventListener('change', scheduleRender);
    unsubs.push(bus.on('db:change', scheduleRender));
    unsubs.push(bus.on('view:changed', scheduleRender));
    unsubs.push(bus.on('i18n:change', scheduleRender));
    render();
  }

  function destroy() {
    unsubs.forEach(u => { try { u(); } catch (_) {} });
    unsubs = [];
  }

  return { init, destroy, render };
}, ['Store', 'DB', 'I18n', 'Utils', 'EventBus']);
// ─── UI/BaseView ─── END ─────────────────────────────────────
