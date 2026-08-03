// ─── UI/Toast ─── START ──────────────────────────────────────
/**
 * Всплывающие уведомления. Держит не более toastMaxVisible, старые вытесняет,
 * исчезает с плавным fade. Иконка подсвечивается цветом типа.
 * @deps Config
 * @exports Toast
 */
DI.register('Toast', function (Config) {
  const ICONS = { ok: '✓', err: '✕', warn: '!', info: '◆' };
  const COLORS = { ok: 'var(--green)', err: 'var(--rose)', warn: 'var(--amber)', info: 'var(--teal)' };
  let container = null;

  /**
   * Показывает тост.
   * @param {'ok'|'err'|'warn'|'info'} type
   * @param {string} msg
   * @param {number} [ms] - Длительность (по умолчанию из Config).
   */
  function show(type, msg, ms) {
    if (!container) container = document.getElementById('toasts');
    if (!container) return;
    const cls = ICONS[type] ? type : 'info';

    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    const ic = document.createElement('span');
    ic.textContent = ICONS[cls];
    ic.style.fontWeight = '700';
    ic.style.color = COLORS[cls];
    const m = document.createElement('span');
    m.textContent = String(msg || '');
    el.appendChild(ic);
    el.appendChild(m);
    container.appendChild(el);

    const limit = Config.get('toastMaxVisible', 3);
    while (container.children.length > limit) container.removeChild(container.firstChild);

    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => { try { el.remove(); } catch (_) {} }, 260);
    }, ms || Config.get('toastDefaultDuration', 2200));
  }

  return { show };
}, ['Config']);
// ─── UI/Toast ─── END ────────────────────────────────────────
