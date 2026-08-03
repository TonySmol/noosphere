// ─── UI/MenuView ─── START ───────────────────────────────────
/**
 * Меню (кнопка #btn-menu) и переключение экранов Поток/База.
 *  - Модалка настроек: справка, тема, язык, навигация, стереть данные.
 *  - setView показывает/прячет элементы потока (включая btn-history) и панель #base.
 * Тема применяется через data-theme на body. Стереть данные эмитит 'wipe:request'
 * (слушатель ставит Boot).
 * @deps Store, Config, Modal, Toast, I18n, EventBus, Onboarding
 * @exports MenuView
 */
DI.register('MenuView', function (Store, Config, Modal, Toast, I18n, bus, Onboarding) {
  let unsubs = [];

  /** Применяет тему к DOM и сохраняет. @param {'dark'|'light'} theme */
  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    Config.set('theme', theme);
  }

  /** Переключает экран Поток/База под реальную разметку. @param {'stream'|'base'} view */
  function setView(view) {
    Store.setState({ view });
    const isBase = view === 'base';
    ['ctx-banner', 'seg', 'feed-wrap', 'btn-history', 'composer'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = isBase ? 'none' : '';
    });
    const base = document.getElementById('base');
    if (base) base.classList.toggle('on', isBase);
    try { bus.emit('view:changed', { view }); } catch (_) {}
    viewSync();
  }

  /** Синхронизирует active-классы навигации с текущим view. */
  function viewSync() {
    const view = Store.get('view');
    document.querySelectorAll('.tab-b').forEach(b => b.classList.toggle('on', b.getAttribute('data-v') === view));
    const bb = document.getElementById('btn-base');
    if (bb) bb.classList.toggle('active', view === 'base');
  }

  /** Открывает модалку настроек. */
  function openMenu() {
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:12px;';

    // справка
    const helpBtn = document.createElement('button');
    helpBtn.className = 'nv-act';
    helpBtn.textContent = '? ' + I18n.t('menu.help');
    helpBtn.addEventListener('click', () => { Modal.close(); Onboarding.showHelp(false); });
    body.appendChild(helpBtn);

    // тема
    const themeBtn = document.createElement('button');
    themeBtn.className = 'nv-act';
    themeBtn.textContent = I18n.t('menu.theme') + ': ' + (Config.get('theme', 'dark') === 'dark' ? '🌙' : '☀️');
    themeBtn.addEventListener('click', () => {
      const next = Config.get('theme', 'dark') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      Modal.close();
      Toast.show('ok', I18n.t('menu.theme') + ' → ' + next);
    });
    body.appendChild(themeBtn);

    // язык
    const langBtn = document.createElement('button');
    langBtn.className = 'nv-act';
    langBtn.textContent = I18n.t('menu.lang') + ': ' + I18n.getLang().toUpperCase();
    langBtn.addEventListener('click', () => {
      const next = I18n.getLang() === 'ru' ? 'en' : 'ru';
      I18n.setLang(next);
      Modal.close();
    });
    body.appendChild(langBtn);

    // навигация
    const goBase = document.createElement('button');
    goBase.className = 'nv-act';
    goBase.textContent = I18n.t('tab.base');
    goBase.addEventListener('click', () => { Modal.close(); setView('base'); });
    body.appendChild(goBase);

    const goStream = document.createElement('button');
    goStream.className = 'nv-act';
    goStream.textContent = I18n.t('tab.stream');
    goStream.addEventListener('click', () => { Modal.close(); setView('stream'); });
    body.appendChild(goStream);

    // danger: стереть данные
    const wipe = document.createElement('button');
    wipe.className = 'nv-act danger';
    wipe.textContent = I18n.t('base.wipe');
    wipe.addEventListener('click', () => {
      Modal.close();
      Modal.confirm(I18n.t('base.wipe'), I18n.t('base.wipe.confirm'), () => {
        try { bus.emit('wipe:request'); } catch (_) {}
      });
    });
    body.appendChild(wipe);

    Modal.open({ title: I18n.t('menu.settings'), body });
  }

  function init() {
    applyTheme(Config.get('theme', 'dark'));

    const menuBtn = document.getElementById('btn-menu');
    if (menuBtn) menuBtn.addEventListener('click', openMenu);

    const baseBtn = document.getElementById('btn-base');
    if (baseBtn) baseBtn.addEventListener('click', () => setView(Store.get('view') === 'base' ? 'stream' : 'base'));

    document.querySelectorAll('.tab-b').forEach(b => {
      b.addEventListener('click', () => setView(b.getAttribute('data-v')));
    });

    unsubs.push(Store.subscribe(s => s.view, viewSync));
    unsubs.push(bus.on('i18n:change', viewSync));
    viewSync();
  }

  function destroy() {
    unsubs.forEach(u => { try { u(); } catch (_) {} });
    unsubs = [];
  }

  return { init, destroy, setView, openMenu };
}, ['Store', 'Config', 'Modal', 'Toast', 'I18n', 'EventBus', 'Onboarding']);
// ─── UI/MenuView ─── END ─────────────────────────────────────
