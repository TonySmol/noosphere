// ─── INPUT/Hotkeys ─── START ─────────────────────────────────
/**
 * Глобальные горячие клавиши (capture-фаза, срабатывает первым):
 *  - Escape: приоритет «модалка → NoteView → снять пин». Если открыта модалка
 *    или NoteView — просто выходим, их собственные обработчики закроют окно;
 *    пин не трогаем. Иначе снимаем пин.
 *  - '/': фокус на поле ввода (если не печатаешь уже).
 *  - Ctrl/Cmd+Enter обрабатывает сам Composer.
 * Зависит только от Context (Modal/NoteView определяет по DOM, не закрывает сам).
 * @deps Context
 * @exports Hotkeys
 */
DI.register('Hotkeys', function (Context) {
  let handler = null;

  function init() {
    if (handler) return;
    handler = function (e) {
      if (e.key === 'Escape') {
        // 1) открыта модалка — её закроет собственный обработчик Modal
        const overlay = document.getElementById('overlay');
        if (overlay && overlay.classList.contains('on')) return;
        // 2) открыт NoteView — его закроет собственный обработчик NoteView
        const noteview = document.getElementById('noteview');
        if (noteview && noteview.classList.contains('on')) return;
        // 3) ничего не открыто — снимаем пин
        Context.clearPin();
        return;
      }
      if (e.key === '/') {
        const target = e.target;
        const typing = target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT');
        if (!typing) {
          const ta = document.getElementById('ed-ta');
          if (ta) { e.preventDefault(); ta.focus(); }
        }
      }
    };
    // capture: перехватываем раньше Modal/NoteView
    document.addEventListener('keydown', handler, true);
  }

  function destroy() {
    if (handler) { document.removeEventListener('keydown', handler, true); handler = null; }
  }

  return { init, destroy };
}, ['Context']);
// ─── INPUT/Hotkeys ─── END ───────────────────────────────────
