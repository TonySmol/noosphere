// ─── DOMAIN/NoteActions ─── START ────────────────────────────
/**
 * Общие действия над заметкой: удалить, переключить видимость, копировать.
 * Единая точка, чтобы FeedView / NoteView / BaseView не дублировали логику.
 * ВНИМАНИЕ: зависит от Modal и Toast (едут в следующей пачке) — резолвится
 * лениво, к моменту использования они уже зарегистрированы.
 * @deps Notes, Modal, Toast, I18n
 * @exports NoteActions
 */
DI.register('NoteActions', function (Notes, Modal, Toast, I18n) {
  /**
   * Удаляет заметку с подтверждением.
   * @param {string} id
   */
  function remove(id) {
    if (!id) return;
    Modal.confirm(I18n.t('btn.del'), I18n.t('del.confirm'), () => {
      Notes.remove(id);
      Toast.show('ok', I18n.t('toast.deleted'));
    });
  }

  /**
   * Переключает видимость (личное ↔ открытое).
   * @param {string} id
   */
  function toggle(id) {
    if (!id) return;
    Notes.toggleShared(id).then(note => {
      if (!note) return;
      Toast.show('ok', I18n.t(note.shared ? 'toast.saved.public' : 'toast.saved.private'));
    });
  }

  /**
   * Копирует текст заметки в буфер (с fallback для старых браузеров).
   * @param {string} text
   */
  function copy(text) {
    const done = () => Toast.show('ok', I18n.t('toast.copied'));
    const fail = () => Toast.show('err', I18n.t('toast.copy.fail'));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text || '').then(done).catch(fail);
    } else {
      try {
        const ta = document.createElement('textarea');
        ta.value = text || '';
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
      } catch (_) { fail(); }
    }
  }

  return { remove, toggle, copy };
}, ['Notes', 'Modal', 'Toast', 'I18n']);
// ─── DOMAIN/NoteActions ─── END ──────────────────────────────
