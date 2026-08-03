// ─── UI/Modal ─── START ──────────────────────────────────────
/**
 * Модальное окно на готовой разметке (#overlay > #modal: #modal-h/-t/-x/-b/-f).
 *  - open({title, body, buttons}) — произвольное окно; body: строка или DOM-узел.
 *  - confirm(title, text, onOk, okText?) — подтверждение (OK выполняет onOk).
 *  - close() — закрыть (также работают Escape и клик по подложке).
 * Возвращает фокус элементу, активному до открытия.
 * @deps I18n
 * @exports Modal
 */
DI.register('Modal', function (I18n) {
  let overlay, modal, titleEl, bodyEl, footEl, closeBtn;
  let escHandler = null;
  let lastFocus = null;

  /** Привязывает DOM один раз. */
  function bind() {
    if (overlay) return;
    overlay = document.getElementById('overlay');
    modal = document.getElementById('modal');
    titleEl = document.getElementById('modal-t');
    bodyEl = document.getElementById('modal-b');
    footEl = document.getElementById('modal-f');
    closeBtn = document.getElementById('modal-x');
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  }

  /**
   * Открывает окно.
   * @param {{title?:string, body?:(string|Node), buttons?:Array<{text:string,primary?:boolean,danger?:boolean,onClick?:Function}>}} opts
   */
  function open(opts) {
    bind();
    if (!overlay) return;
    opts = opts || {};
    lastFocus = document.activeElement;

    if (titleEl) titleEl.textContent = opts.title || '';
    if (bodyEl) {
      bodyEl.innerHTML = '';
      if (opts.body) {
        if (typeof opts.body === 'string') bodyEl.textContent = opts.body;
        else bodyEl.appendChild(opts.body);
      }
    }
    if (footEl) {
      footEl.innerHTML = '';
      (opts.buttons || []).forEach(b => {
        const btn = document.createElement('button');
        btn.className = 'mbtn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
        btn.textContent = b.text || 'OK';
        btn.addEventListener('click', () => { if (b.onClick) b.onClick(); });
        footEl.appendChild(btn);
      });
    }

    overlay.classList.add('on');

    if (escHandler) document.removeEventListener('keydown', escHandler);
    escHandler = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);

    // фокус на первый интерактивный элемент внутри окна
    setTimeout(() => {
      if (!modal) return;
      const focusable = modal.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length) focusable[0].focus();
    }, 50);
  }

  /** Закрывает окно и возвращает фокус. */
  function close() {
    if (!overlay) return;
    overlay.classList.remove('on');
    if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (_) {} }
  }

  /**
   * Подтверждение: Cancel закрывает, OK (danger) выполняет onOk.
   * @param {string} title @param {string} text @param {Function} onOk @param {string} [okText]
   */
  function confirm(title, text, onOk, okText) {
    open({
      title,
      body: text,
      buttons: [
        { text: I18n.t('btn.cancel'), onClick: close },
        { text: okText || 'OK', primary: true, danger: true, onClick: () => { close(); if (onOk) onOk(); } },
      ],
    });
  }

  return { open, close, confirm };
}, ['I18n']);
// ─── UI/Modal ─── END ────────────────────────────────────────
