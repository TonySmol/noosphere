// ─── BOOT ─── START ──────────────────────────────────────────
/**
 * Точка входа. Импортирует и инициализирует все модули в правильном порядке.
 * @exports Boot {mount}
 */

// Импорт всех модулей для регистрации в DI
import './core/di.js';
import './core/config.js';
import './core/eventbus.js';
import './core/logger.js';
import './core/utils.js';
import './core/i18n.js';
import './core/store.js';
import './data/vec.js';
import './data/db.js';
import './ai/embedder.js';
import './ai/ranker.js';
import './net/protocol.js';
import './net/nostr.js';
import './net/netservice.js';
import './domain/notes.js';
import './domain/context.js';
import './domain/feed.js';
import './domain/provenance.js';
import './domain/influence.js';
import './domain/noteactions.js';
import './ui/onboarding.js';
import './ui/modal.js';
import './ui/toast.js';
import './ui/progress.js';
import './ui/headerstatus.js';
import './ui/composer.js';
import './ui/feedview.js';
import './ui/baseview.js';
import './ui/noteview.js';
import './ui/menuview.js';
import './input/hotkeys.js';

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
