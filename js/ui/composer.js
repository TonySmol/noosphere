// ─── UI/Composer ─── START ───────────────────────────────────
/**
 * Поле ввода: счётчик, переключатель Личное/Мир, отправка.
 * Ввод мгновенно включает режим автора (Context.setInput), вектор догоняет
 * с debounce. Если при публикации активен пин — новая заметка связывается с
 * закреплённой (parentId = пин): так работает механика «мысль по мотивам».
 * Режим правки: по 'note:edit-request' {id} загружает заметку в поле (через
 * Notes.get); отправка тогда вызывает Notes.edit, а не create.
 * @deps Context, Notes, Store, I18n, EventBus, Toast, Utils
 * @exports Composer
 */
DI.register('Composer', function (Context, Notes, Store, I18n, bus, Toast, Utils) {
  let ta, cnt, sendBtn, toggle;
  let sending = false;
  let editingId = null;
  let unsubs = [];

  function updateCounter() {
    if (cnt && ta) cnt.textContent = Utils.word('symbols', ta.value.length, I18n.getLang());
  }

  function reflectMode(mode) {
    if (!toggle) return;
    toggle.setAttribute('data-mode', mode);
    toggle.querySelectorAll('.mt-opt').forEach(o =>
      o.classList.toggle('on', o.getAttribute('data-v') === mode));
  }

  function setSendingUI(on) {
    if (!sendBtn) return;
    sendBtn.disabled = on;
    sendBtn.classList.toggle('sending', on);
    if (!editingId) sendBtn.textContent = on ? '…' : '→';
  }

  function refreshEditUI() {
    if (!sendBtn || !toggle) return;
    if (editingId) {
      toggle.style.display = 'none';
      sendBtn.textContent = I18n.t('btn.save');
    } else {
      toggle.style.display = '';
      sendBtn.textContent = '→';
    }
  }

  /** Загружает заметку в поле для правки. @param {string} id */
  function edit(id) {
    Notes.get(id).then(note => {
      if (!note || !ta) return;
      editingId = id;
      ta.value = note.text || '';
      updateCounter();
      refreshEditUI();
      ta.focus();
    });
  }

  function cancelEdit() {
    editingId = null;
    if (ta) ta.value = '';
    updateCounter();
    refreshEditUI();
  }

  /** Отправка: правка (Notes.edit) или создание (Notes.create + пин как родитель). */
  function send() {
    if (sending) return;
    const text = ta.value.trim();
    if (!text) { Toast.show('warn', I18n.t('toast.empty')); return; }
    const mode = Store.get('sendMode');
    sending = true;
    setSendingUI(true);

    const finish = () => {
      sending = false;
      setSendingUI(false);
      editingId = null;
      ta.value = '';
      Context.setInput('');
      updateCounter();
      refreshEditUI();
    };

    if (editingId) {
      Notes.edit(editingId, text)
        .then(() => { Toast.show('ok', I18n.t('toast.edit.saved')); finish(); })
        .catch(e => { Toast.show('err', String(e && e.message || e)); sending = false; setSendingUI(false); });
      return;
    }

    // активный пин = родитель новой заметки («по мотивам»)
    const pin = Context.getPin();
    const parentId = pin ? pin.id : null;

    Notes.create(text, mode, parentId)
      .then(note => {
        Toast.show('ok', I18n.t(mode === 'world' ? 'toast.saved.public' : 'toast.saved.private')
          + (note && note.parentId ? ' · ' + I18n.t('inf.linked') : ''));
        try { bus.emit('editor:sent'); } catch (_) {}
        finish();
      })
      .catch(e => { Toast.show('err', String(e && e.message || e)); sending = false; setSendingUI(false); });
  }

  function init() {
    ta = document.getElementById('ed-ta');
    cnt = document.getElementById('ed-cnt');
    sendBtn = document.getElementById('btn-send');
    toggle = document.getElementById('mode-toggle');
    if (!ta) return;

    ta.addEventListener('input', () => {
      updateCounter();
      Context.setInput(ta.value);
    });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
      else if (e.key === 'Escape' && editingId) { e.preventDefault(); cancelEdit(); }
    });
    if (sendBtn) sendBtn.addEventListener('click', send);
    if (toggle) toggle.addEventListener('click', e => {
      const opt = e.target.closest('.mt-opt');
      if (opt && opt.getAttribute('data-v')) Store.setState({ sendMode: opt.getAttribute('data-v') });
    });

    unsubs.push(Store.subscribe(s => s.sendMode, reflectMode));
    unsubs.push(bus.on('i18n:change', () => { updateCounter(); reflectMode(Store.get('sendMode')); refreshEditUI(); }));
    unsubs.push(bus.on('note:edit-request', p => { if (p && p.id) edit(p.id); }));

    reflectMode(Store.get('sendMode'));
    refreshEditUI();
    updateCounter();
  }

  function destroy() {
    unsubs.forEach(u => { try { u(); } catch (_) {} });
    unsubs = [];
  }

  return { init, destroy, send, edit, cancelEdit };
}, ['Context', 'Notes', 'Store', 'I18n', 'EventBus', 'Toast', 'Utils']);
// ─── UI/Composer ─── END ─────────────────────────────────────
