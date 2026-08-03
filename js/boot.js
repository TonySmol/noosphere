// ─── BOOT ─── START ──────────────────────────────────────────
/**
 * Точка входа. Резолвит и инициализирует все модули в правильном порядке:
 *  1. Тема (до показа приложения, чтобы не мигнуть неверной темой).
 *  2. Подписчики событий без DOM (Progress, HeaderStatus, Feed, Influence).
 *  3. DOM-модули (Composer, FeedView, NoteView, BaseView, MenuView, Hotkeys).
 *  4. Слушатель wipe:request.
 *  5. Показ приложения (body.ready).
 *  6. Запуск Embedder (шлёт ai-события) и NetService (шлёт net-события).
 *  7. Onboarding последним.
 * Зависимостей через DI не имеет — резолвит модули внутри mount() сам.
 * @exports Boot {mount}
 */
DI.register('Boot', function () {
  /** Собирает и запускает приложение. Вызывать один раз. */
  function mount() {
    // 1. Тема до показа
    const Config = DI.resolve('Config');
    document.body.setAttribute('data-theme', Config.get('theme', 'dark'));

    // 2. Подписчики событий (без DOM)
    DI.resolve('Progress').init();
    DI.resolve('HeaderStatus').init();
    DI.resolve('Feed').init();
    DI.resolve('Influence').init();

    // 3. DOM-модули
    DI.resolve('Composer').init();
    DI.resolve('FeedView').init();
    DI.resolve('NoteView').init();
    DI.resolve('BaseView').init();
    DI.resolve('MenuView').init();
    DI.resolve('Hotkeys').init();

    // 4. Слушатель стирания данных (эмитит MenuView)
    const EventBus = DI.resolve('EventBus');
    const DB = DI.resolve('DB');
    const Toast = DI.resolve('Toast');
    const I18n = DI.resolve('I18n');
    const Store = DI.resolve('Store');
    EventBus.on('wipe:request', () => {
      DB.reset().then(() => {
        Toast.show('ok', I18n.t('toast.base.wiped'));
        Store.setState({ view: 'stream' });
      });
    });

    // 5. Показ приложения
    document.body.classList.add('ready');

    // 6. Запуск AI и сети
    DI.resolve('Embedder').load();
    DI.resolve('NetService').start();

    // 7. Онбординг последним
    DI.resolve('Onboarding').init();
  }

  return { mount };
});
// ─── BOOT ─── END ────────────────────────────────────────────

// ─── ЗАПУСК ─── START ────────────────────────────────────────
DI.resolve('Boot').mount();
// ─── ЗАПУСК ─── END ──────────────────────────────────────────

</script>
