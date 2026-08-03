// ─── UI/Onboarding ─── START ─────────────────────────────────
/**
 * Онбординг и справка «Как это работает».
 *  - init(): при первом запуске (Config.onboarded=false) показывает гайд.
 *  - showHelp(): открывает гайд из меню; чекбокс «больше не показывать»
 *    доступен только в онбординге первого запуска.
 * Текст берётся из единого словаря I18n (ключи onb.*).
 * @deps Config, Modal, I18n
 * @exports Onboarding
 */
DI.register('Onboarding', function (Config, Modal, I18n) {
  /**
   * Собирает тело гайда из секций.
   * @param {boolean} firstRun - онбординг первого запуска (показывает чекбокс).
   * @returns {{el:HTMLElement, checkbox:HTMLInputElement|null}}
   */
  function buildBody(firstRun) {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;flex-direction:column;gap:14px;';

    const sections = [
      ['◇ ' + I18n.t('onb.what.t'), I18n.t('onb.what.d')],
      ['▤ ' + I18n.t('onb.stream.t'), I18n.t('onb.stream.d')],
      ['◈ ' + I18n.t('onb.pin.t'), I18n.t('onb.pin.d')],
      ['∿ ' + I18n.t('onb.drift.t'), I18n.t('onb.drift.d')],
      ['⌘ ' + I18n.t('onb.modes.t'), I18n.t('onb.modes.d')],
      ['◆ ' + I18n.t('onb.resonance.t'), I18n.t('onb.resonance.d')],
      ['⌨ ' + I18n.t('onb.keys.t'), I18n.t('onb.keys.d')],
    ];

    sections.forEach(([title, desc]) => {
      const s = document.createElement('div');
      const t = document.createElement('div');
      t.style.cssText = 'font-weight:700;font-size:13px;margin-bottom:3px;';
      t.textContent = title;
      const d = document.createElement('div');
      d.style.cssText = 'font-size:13px;color:var(--text-2);line-height:1.5;';
      d.textContent = desc;
      s.appendChild(t);
      s.appendChild(d);
      el.appendChild(s);
    });

    let checkbox = null;
    if (firstRun) {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-2);cursor:pointer;margin-top:4px;';
      checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      label.appendChild(checkbox);
      const span = document.createElement('span');
      span.textContent = I18n.t('onb.dontshow');
      label.appendChild(span);
      el.appendChild(label);
    }

    return { el, checkbox };
  }

  /**
   * Открывает гайд.
   * @param {boolean} firstRun - первый запуск (чекбокс + сохранение onboarded).
   */
  function showHelp(firstRun) {
    const { el, checkbox } = buildBody(!!firstRun);
    Modal.open({
      title: I18n.t('onb.title'),
      body: el,
      buttons: [{
        text: I18n.t('onb.gotit'),
        primary: true,
        onClick: () => {
          if (firstRun && checkbox && checkbox.checked) {
            Config.set('onboarded', true);
          }
          Modal.close();
        },
      }],
    });
  }

  /** Первый запуск: показать гайд, если ещё не проходили. */
  function init() {
    if (Config.get('onboarded', false)) return;
    showHelp(true);
  }

  return { init, showHelp };
}, ['Config', 'Modal', 'I18n']);
// ─── UI/Onboarding ─── END ───────────────────────────────────
