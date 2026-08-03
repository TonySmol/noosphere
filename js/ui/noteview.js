// ─── UI/NoteView ─── START ───────────────────────────────────
/**
 * Полноэкранный просмотр заметки (#noteview): текст, метаданные и действия
 * удалить / переключить видимость / копировать / править.
 * Открывается по событию 'note:open' {id} (из BaseView и FeedView).
 * Закрытие — по клику на фон или Escape.
 * Зависимости очищены: действия идут через NoteActions, Modal не используется
 * (рендер напрямую в #noteview).
 * @deps DB, NoteActions, I18n, Utils, EventBus
 * @exports NoteView
 */
DI.register('NoteView', function (DB, NoteActions, I18n, Utils, bus) {
  let root = null;
  let currentId = null;
  let escHandler = null;

  function ensureRoot() {
    if (!root) root = document.getElementById('noteview');
    return root;
  }

  /** Закрывает оверлей и чистит обработчик Escape. */
  function close() {
    const r = ensureRoot();
    if (r) { r.classList.remove('on'); r.innerHTML = ''; }
    if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
    currentId = null;
  }

  /** Открывает заметку по id. @param {string} id */
  function open(id) {
    if (!id) return;
    DB.get(id).then(note => {
      if (!note) {
        // локальной нет — ищем в сетевом кэше
        return DB.cacheGet(id).then(cached => { if (cached) render(cached); });
      }
      render(note);
    }).catch(() => {});
  }

  /** Строит DOM оверлея для заметки. @param {Object} note */
  function render(note) {
    const r = ensureRoot();
    if (!r) return;
    currentId = note.id;
    r.innerHTML = '';
    r.classList.add('on');

    const isOwn = !!(note.id && !note.authorPubkey);   // у своих authorPubkey не ставим

    // ── верхняя панель действий ──
    const top = document.createElement('div');
    top.className = 'nv-f';

    if (isOwn) {
      const del = document.createElement('button');
      del.className = 'nv-act danger';
      del.textContent = I18n.t('btn.del');
      del.addEventListener('click', () => { NoteActions.remove(note.id); close(); });
      top.appendChild(del);

      const tog = document.createElement('button');
      tog.className = 'nv-act';
      tog.textContent = note.shared ? I18n.t('btn.toggle.priv') : I18n.t('btn.toggle.pub');
      tog.addEventListener('click', () => { NoteActions.toggle(note.id); close(); });
      top.appendChild(tog);
    }

    const copy = document.createElement('button');
    copy.className = 'nv-act';
    copy.textContent = I18n.t('btn.copy');
    copy.addEventListener('click', () => NoteActions.copy(note.text));
    top.appendChild(copy);

    if (isOwn) {
      const edit = document.createElement('button');
      edit.className = 'nv-act';
      edit.textContent = I18n.t('btn.edit');
      edit.addEventListener('click', () => {
        close();
        try { bus.emit('note:edit-request', { id: note.id }); } catch (_) {}
      });
      top.appendChild(edit);
    }

    r.appendChild(top);

    // ── тело: метаданные + текст ──
    const body = document.createElement('div');
    body.className = 'nv-b';

    const info = document.createElement('div');
    info.className = 'note-meta';
    info.style.marginBottom = '12px';

    const tag = document.createElement('span');
    if (isOwn) {
      tag.className = 'note-tag ' + (note.shared ? 'world' : 'priv');
      tag.textContent = note.shared ? I18n.t('base.tag.shared') : I18n.t('base.tag.private');
    } else {
      tag.className = 'note-tag world';
      tag.textContent = '· ' + Utils.shortPk(note.authorPubkey || '');
    }
    info.appendChild(tag);

    const date = document.createElement('span');
    date.textContent = Utils.fmtDate(note.updatedAt || note.createdAt, I18n.getLang()) + ' ' +
                       Utils.fmtTime(note.updatedAt || note.createdAt, I18n.getLang());
    info.appendChild(date);
    body.appendChild(info);

    const txt = document.createElement('div');
    txt.className = 'nv-text';
    txt.style.cssText = 'flex:1;overflow-y:auto;font-size:16px;line-height:1.6;white-space:pre-wrap;word-break:break-word;padding:16px;';
    txt.textContent = note.text || '';
    body.appendChild(txt);

    r.appendChild(body);

    // ── нижняя панель: закрыть ──
    const bottom = document.createElement('div');
    bottom.className = 'nv-f-bottom';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'nv-act';
    closeBtn.textContent = I18n.t('btn.close');
    closeBtn.addEventListener('click', close);
    bottom.appendChild(closeBtn);
    r.appendChild(bottom);

    // ── фон: клик мимо контента закрывает ──
    r.addEventListener('click', e => { if (e.target === r) close(); });

    // ── Escape ──
    if (escHandler) document.removeEventListener('keydown', escHandler);
    escHandler = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);
  }

  function init() {
    ensureRoot();
    bus.on('note:open', p => { if (p && p.id) open(p.id); });
  }

  function destroy() { close(); }

  return { init, destroy, open, close };
}, ['DB', 'NoteActions', 'I18n', 'Utils', 'EventBus']);
// ─── UI/NoteView ─── END ─────────────────────────────────────
