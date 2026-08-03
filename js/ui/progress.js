// ─── UI/Progress ─── START ───────────────────────────────────
/**
 * Полноэкранный оверлей загрузки модели. Слушает 'ai:progress'/'ai:status'.
 * Показывается с задержкой SHOW_DELAY, чтобы не мигать на быстрой (кэшированной)
 * загрузке; скрывается при переходе в 'model'/'demo'.
 * @deps EventBus
 * @exports Progress
 */
DI.register('Progress', function (bus) {
  let overlay, fill, pctEl;
  let showTimer = null;
  const SHOW_DELAY = 300;

  function bind() {
    overlay = document.getElementById('progress');
    fill = document.getElementById('prog-fill');
    pctEl = document.getElementById('prog-pct');
  }
  function show() { if (overlay) overlay.classList.add('on'); }
  function hide() { if (overlay) overlay.classList.remove('on'); }

  /** @param {number} pct 0..100 */
  function update(pct) {
    const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
    if (fill) fill.style.width = p + '%';
    if (pctEl) pctEl.textContent = p + '%';
  }

  function init() {
    bind();
    bus.on('ai:progress', e => update(e && e.pct));
    bus.on('ai:status', e => {
      if (!e) return;
      if (e.mode === 'loading') {
        update(e.percent || 0);
        if (!showTimer && overlay && !overlay.classList.contains('on')) {
          showTimer = setTimeout(() => { show(); showTimer = null; }, SHOW_DELAY);
        }
      } else {
        if (showTimer) { clearTimeout(showTimer); showTimer = null; }
        hide();
      }
    });
  }

  return { init, show, hide, update };
}, ['EventBus']);
// ─── UI/Progress ─── END ─────────────────────────────────────
