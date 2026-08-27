// ═══════════════════════════════════════════════════════════════════════════════
// NOOmium — app.js
// Соцсеть смыслов: мысли ищутся по значению, а не по словам.
//
// Архитектура: DI-контейнер + EventBus. Слои: CORE / DATA / AI / NET / DOMAIN /
// UI / PLATFORM / BOOT.
//
// МОДЕЛЬ ДАННЫХ (v0.7):
// - uid — единственный стабильный идентификатор своей заметки.
// - Канон: зашифрованное NIP-44 событие kind 30078 (replaceable, d-tag = uid)
//   — синхронизация между устройствами через релеи.
// - Публичная заметка — проекция kind 1 с тегом uid (видна сети).
// - eventId — только ссылка на публичную проекцию, не идентификатор заметки.
// - parentId своих заметок — всегда uid. Миграция parentId→eventId удалена.
//
// КАРТА ПОСТАВКИ (волны):
//   в1:  Config, EventBus, Logger
//   в2:  Utils, I18n, Store
//   в3:  Vec, DB
//   в4:  Embedder, Ranker
//   в5:  Crypto*, Nostr, Protocol
//   в6:  NetService
//   в7:  Notes, Context
//   в8:  Feed, Provenance, Influence
//   в9:  Account*, NoteActions
//   в10: Modal, Toast, Progress
//   в11: HeaderStatus, Onboarding
//   в12: Composer
//   в13: FeedView
//   в14: BaseView, NoteView
//   в15: AccountView*, MenuView
//   в16: TelegramAdapter, Boot
//   (* — новые модули)
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// ВЕРСИЯ ПРИЛОЖЕНИЯ
// ═══════════════════════════════════════════════════════════════════════════════
const APP_VERSION = '0.7.0';

// ═══════════════════════════════════════════════════════════════════════════════
// CORE/DI — ПРЕАМБУЛА
// Контейнер зависимостей: ленивый резолв, защита от циклов.
// ═══════════════════════════════════════════════════════════════════════════════
const DI = (() => {
  const factories = new Map();
  const instances = new Map();

  function register(name, factory, deps) {
    factories.set(name, { factory, deps: deps || [] });
  }

  function resolve(name, visiting) {
    if (instances.has(name)) return instances.get(name);
    const def = factories.get(name);
    if (!def) throw new Error('Module not found: ' + name);
    visiting = visiting || new Set();
    if (visiting.has(name)) throw new Error('Circular dependency: ' + name);
    visiting.add(name);
    const args = def.deps.map(d => resolve(d, visiting));
    visiting.delete(name);
    const inst = def.factory(...args);
    instances.set(name, inst);
    return inst;
  }

  return { register, resolve };
})();

// ═══════════════════════════════════════════════════════════════════════════════
// СЛОЙ: CORE — конфигурация, события, логирование, утилиты, i18n, стор
// ═══════════════════════════════════════════════════════════════════════════════

// ─── CORE/Config ─── START ──────────────────────────────────────────────────
/**
 * Глобальная конфигурация приложения с поддержкой миграций схемы.
 *
 * Единственный источник истины для всех настраиваемых параметров.
 * Хранится в localStorage под ключом «noomium:cfg».
 *
 * При добавлении нового параметра:
 * 1. Добавить в `defaults`
 * 2. При необходимости добавить миграцию в `migrations`
 * 3. Поднять `SCHEMA_VERSION`
 *
 * Схема v8 (v0.7.0):
 * - добавлены ключи аккаунта/синхронизации: syncEnabled, keyExported,
 *   syncMigrated и kPrivate (kind приватного канона);
 * - удалены мёртвые ключи ранних версий (миграция 8);
 * - reconnectMaxAttempts / reconnectMaxDelay теперь реально используются
 *   (экспоненциальный реконнект в NetService).
 */
DI.register('Config', function () {
  const KEY = 'noomium:cfg';
  const SCHEMA_VERSION = 8;

  const defaults = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    room: 'noomium-main',
    theme: 'dark',
    lang: null,
    onboarded: false,
    logLevel: 'info',

    // AI / Embedding
    model: 'onnx-community/granite-embedding-97m-multilingual-r2-ONNX',
    dim: 384,
    aiCacheLimit: 300,
    aiEmbedTimeout: 15000,

    // Ранжирование (адаптировано под Granite R2, диапазон ~0.55–0.93)
    threshold: 0.81,
    serendipity: 0.07,
    duplicateThreshold: 0.88,

    // Отображение сходства: 'signal' (индикатор + текст) или 'percent' (сырые %)
    similarityDisplay: 'signal',

    // Nostr / сеть
    relays: [
      'wss://relay.damus.io',
      'wss://relay.primal.net',
      'wss://offchain.pub',
      'wss://nos.lol',
      'wss://nostr.oxtr.dev',
      'wss://relay.mostr.pub',
    ],
    kNote: 1,
    kPrivate: 30078,
    kQuery: 21000,
    kAnswer: 21001,
    kDelete: 5,
    queryRateLimit: 3000,
    maxResponses: 8,
    responseWindow: 6000,
    centroidCount: 12,
    peerTTL: 60000,
    heartbeat: 30000,
    subWindow: 300,
    historyMaxWindow: 2592000,
    reconnectMaxAttempts: 10,
    reconnectBaseDelay: 1000,
    reconnectMaxDelay: 60000,
    seenMaxSize: 1000,
    maxAnswerTextLength: 10000,
    maxNoteTextLength: 10000,
    maxIncomingNotesPerPeer: 20,

    // Хранилище
    dbName: 'noomium_v2',
    storeName: 'notes',
    cacheStoreName: 'cache',

    // UI / UX
    debounce: 350,
    baseSearchDebounce: 200,
    truncateTextLength: 140,
    toastMaxVisible: 3,
    toastDefaultDuration: 2200,

    // Лимиты длины поста
    maxPostLength: 2500,
    softLimit: 1200,
    hardLimit: 2000,

    // Telegram: если пользователь вручную выбрал тему, игнорируем themeChanged
    userThemeOverride: false,

    // Аккаунт / синхронизация (v8)
    syncEnabled: true,   // публикация приватного канона (kind 30078) на релеи
    keyExported: false,  // пользователь видел/сохранял свой ключ
    syncMigrated: false, // одноразовый backsweep v0.6 → v0.7 выполнен
  });

  const migrations = {
    // Исторические миграции (оставлены для совместимости цикла)
    1: s => s,
    2: s => s,
    3: s => s,
    4: s => s,

    // v5: адаптация порогов под Granite R2
    5: s => {
      if (typeof s.threshold === 'number' && s.threshold === 0.65) {
        s.threshold = defaults.threshold;
      }
      if (typeof s.serendipity === 'number' && s.serendipity === 0.25) {
        s.serendipity = defaults.serendipity;
      }
      if (typeof s.vectorSimilarityThreshold === 'number' && s.vectorSimilarityThreshold === 0.98) {
        s.vectorSimilarityThreshold = 0.95;
      }
      return s;
    },

    // v6: добавлен режим отображения сходства
    6: s => {
      if (typeof s.similarityDisplay !== 'string') {
        s.similarityDisplay = defaults.similarityDisplay;
      }
      return s;
    },

    // v7: переименование vectorSimilarityThreshold → duplicateThreshold
    7: s => {
      if ('vectorSimilarityThreshold' in s) {
        s.duplicateThreshold = s.vectorSimilarityThreshold;
        delete s.vectorSimilarityThreshold;
      }
      if (typeof s.duplicateThreshold !== 'number') {
        s.duplicateThreshold = defaults.duplicateThreshold;
      }
      return s;
    },

    // v8: аккаунт/синк + чистка мёртвых ключей
    8: s => {
      const dead = [
        'maxPasswordAttempts',
        'influenceWeightByAge',
        'indexerUrl',
        'premiumRelay',
        'gpuRanking',
        'cloudView',
        'relayErrorThreshold',
        'relayCircuitBreakTime',
        'relayBackoff1',
        'relayBackoff2',
      ];
      dead.forEach(k => { delete s[k]; });
      return s;
    },
  };

  const state = Object.assign({}, defaults);

  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      let saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        let v = saved.schemaVersion || saved.version || 1;
        while (v < SCHEMA_VERSION) {
          const migrate = migrations[v];
          if (typeof migrate === 'function') {
            saved = migrate(saved);
          }
          v++;
        }
        saved.schemaVersion = SCHEMA_VERSION;
        for (const k of Object.keys(defaults)) {
          if (k in saved) state[k] = saved[k];
        }
      }
    }
  } catch (_) {}

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (_) {}
  }

  return {
    /**
     * Получить значение параметра.
     * @param {string} k - Ключ.
     * @param {*} [def] - Значение по умолчанию, если ключа нет в состоянии.
     * @returns {*}
     */
    get(k, def) { return (k in state) ? state[k] : def; },

    /**
     * Установить значение и сразу сохранить.
     * @param {string} k - Ключ.
     * @param {*} v - Значение.
     */
    set(k, v) { state[k] = v; persist(); },

    /** Сохранить текущее состояние в localStorage. */
    save: persist,

    /** @returns {Object} Копия дефолтов. */
    defaults() { return Object.assign({}, defaults); },

    /** @returns {Object} Копия всего состояния. */
    all() { return Object.assign({}, state); },

    /** @returns {number} Текущая версия схемы. */
    schemaVersion() { return SCHEMA_VERSION; },

    /** Сбросить все параметры к дефолтам и сохранить. */
    reset() {
      for (const k of Object.keys(defaults)) state[k] = defaults[k];
      persist();
    },
  };
});
// ─── CORE/Config ─── END ────────────────────────────────────────────────────

// ─── CORE/EventBus ─── START ────────────────────────────────────────────────
/**
 * Простая шина событий с поддержкой точечных подписок и wildcard ('*').
 * Все модули общаются исключительно через неё, избегая прямых ссылок друг на друга.
 */
DI.register('EventBus', function () {
  /** @type {Map<string, Set<Function>>} */
  const map = new Map();
  /** @type {Set<Function>} */
  const wild = new Set();

  /**
   * Подписаться на событие.
   * @param {string} event - Имя события или '*' для перехвата всех.
   * @param {Function} fn - Обработчик.
   * @returns {Function} Функция отписки.
   */
  function on(event, fn) {
    if (typeof fn !== 'function') return () => {};
    if (event === '*') {
      wild.add(fn);
      return () => wild.delete(fn);
    }
    if (!map.has(event)) map.set(event, new Set());
    map.get(event).add(fn);
    return () => {
      const s = map.get(event);
      if (s) {
        s.delete(fn);
        if (!s.size) map.delete(event);
      }
    };
  }

  /**
   * Подписаться на одно срабатывание.
   * @param {string} event - Имя события.
   * @param {Function} fn - Обработчик.
   * @returns {Function} Функция отписки.
   */
  function once(event, fn) {
    const off = on(event, (...a) => {
      off();
      fn(...a);
    });
    return off;
  }

  /**
   * Отписаться (альтернатива вызову функции отписки).
   * @param {string} event - Имя события или '*'.
   * @param {Function} fn - Обработчик.
   */
  function off(event, fn) {
    if (event === '*') {
      wild.delete(fn);
      return;
    }
    const s = map.get(event);
    if (s) {
      s.delete(fn);
      if (!s.size) map.delete(event);
    }
  }

  /**
   * Эмит события. Ошибки в обработчиках логируются, но не прерывают цепочку.
   * @param {string} event - Имя события.
   * @param {*} [payload] - Полезная нагрузка.
   */
  function emit(event, payload) {
    const s = map.get(event);
    if (s) {
      for (const fn of Array.from(s)) {
        try {
          fn(payload);
        } catch (e) {
          console.error('[bus:' + event + ']', e);
        }
      }
    }
    if (wild.size) {
      for (const fn of Array.from(wild)) {
        try {
          fn(event, payload);
        } catch (e) {
          console.error('[bus:*]', e);
        }
      }
    }
  }

  return { on, once, off, emit };
});
// ─── CORE/EventBus ─── END ──────────────────────────────────────────────────

// ─── CORE/Logger ─── START ──────────────────────────────────────────────────
/**
 * Логгер с уровнями, цветным выводом в консоль и кольцевым буфером истории.
 *
 * Отличие от v0.6: начальный порог вывода читается из Config.logLevel
 * (раньше параметр существовал в конфиге, но игнорировался).
 */
DI.register('Logger', function (Config) {
  /** @type {Object<string, number>} */
  const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
  /** @type {Object<string, string>} */
  const COLORS = {
    debug: 'color:#56c2b8',
    info: 'color:#e8a33d',
    warn: 'color:#e5c156',
    error: 'color:#e5646e;font-weight:bold',
  };

  /** @type {number} Минимальный уровень для вывода в консоль. */
  let threshold = LEVELS[Config.get('logLevel', 'info')] || LEVELS.info;

  /** @type {Array<Object>} Кольцевой буфер истории. */
  const ring = [];
  const RING_MAX = 200;

  const ts = () => new Date().toISOString().substr(11, 12);

  /**
   * Запись: буфер пишется всегда (независимо от порога),
   * консоль — только если уровень не ниже порога.
   * @param {'debug'|'info'|'warn'|'error'} level - Уровень.
   * @param {string} msg - Сообщение.
   * @param {*} [data] - Дополнительные данные.
   */
  function write(level, msg, data) {
    const time = ts();
    ring.push({ ts: time, level, msg, data });
    if (ring.length > RING_MAX) ring.shift();

    if (LEVELS[level] < threshold) return;
    const fn = console[level] || console.log;
    const prefix = '%c[' + time + '][' + level.toUpperCase() + ']';
    if (data === undefined) {
      fn(prefix, COLORS[level], msg);
    } else {
      fn(prefix, COLORS[level], msg, data);
    }
  }

  return {
    /**
     * Установить минимальный уровень вывода (в рантайме, не персистится).
     * @param {'debug'|'info'|'warn'|'error'} l - Уровень.
     */
    setLevel(l) {
      if (LEVELS[l]) threshold = LEVELS[l];
    },
    debug(m, d) { write('debug', m, d); },
    info(m, d) { write('info', m, d); },
    warn(m, d) { write('warn', m, d); },
    error(m, d) { write('error', m, d); },
    /** @returns {Array<Object>} Снимок кольцевого буфера. */
    history() { return ring.slice(); },
    /** Выгрузить всю накопленную историю в консоль. */
    dump() {
      for (const r of ring) {
        const fn = console[r.level] || console.log;
        fn('[' + r.ts + '][' + r.level.toUpperCase() + ']', r.msg, r.data === undefined ? '' : r.data);
      }
    },
  };
}, ['Config']);
// ─── CORE/Logger ─── END ────────────────────────────────────────────────────

// ─── CORE/Utils ─── START ───────────────────────────────────────────────────
/**
 * [в2] Утилиты: esc, escRe, plural (ru/en), fmtDate/Time/RelativeTime,
 *      shortPk, uid, debounce (+cancel).
 * Deps: —
 */
// ─── CORE/Utils ─── END ─────────────────────────────────────────────────────

// ─── CORE/I18n ─── START ────────────────────────────────────────────────────
/**
 * [в2] Интернационализация ru/en: словари, t(key, params), applyToDOM,
 *      событие i18n:change. НОВЫЕ КЛЮЧИ: net.offline, account.*, sync.*,
 *      export/import, предпросмотр ранжирования с параметрами (ФИКС #2).
 * Deps: Config, EventBus
 */
// ─── CORE/I18n ─── END ──────────────────────────────────────────────────────

// ─── CORE/Store ─── START ───────────────────────────────────────────────────
/**
 * [в2] Синхронный стор: view, seg, context, sendMode, lists, feed.
 *      Immutable-снапшоты, subscribe(listener | selector, listener, equals).
 * Deps: —
 */
// ─── CORE/Store ─── END ─────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// СЛОЙ: DATA — векторная математика, хранилище
// ═══════════════════════════════════════════════════════════════════════════════

// ─── DATA/Vec ─── START ─────────────────────────────────────────────────────
/**
 * [в3] Векторные операции: toB64/fromB64 (квантование Int16), cosine,
 *      normalize, kmeans (k-means++).
 * Deps: —
 */
// ─── DATA/Vec ─── END ───────────────────────────────────────────────────────

// ─── DATA/DB ─── START ──────────────────────────────────────────────────────
/**
 * [в3] IndexedDB + memory-fallback, сторы «notes»/«cache», события
 *      db:change / db:cache.
 *      ФИКС #10: ин-мемори индексы (O(1)-проверки id/eventId вместо
 *      полного скана DB.all() на каждое входящее событие).
 * Deps: Config, EventBus, Logger
 */
// ─── DATA/DB ─── END ────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// СЛОЙ: AI — эмбеддинг, ранжирование
// ═══════════════════════════════════════════════════════════════════════════════

// ─── AI/Embedder ─── START ──────────────────────────────────────────────────
/**
 * [в4] Эмбеддер Granite R2: Web Worker + transformers.js (q8, CLS-pooling),
 *      режимы loading/model/demo, FNV-1a hash-fallback, LRU-кэш 300,
 *      таймауты 120с/15с, события ai:progress / ai:status.
 * Deps: Config, EventBus, Logger
 */
// ─── AI/Embedder ─── END ────────────────────────────────────────────────────

// ─── AI/Ranker ─── START ────────────────────────────────────────────────────
/**
 * [в4] Ранжирование: cosineBatch (+AbortSignal), split (relevant/seren),
 *      isSimilar (duplicateThreshold).
 *      ФИКС #4: докстринг синхронизирован с фактическим поведением
 *      (нижний порог = threshold − serendipity, без клампа).
 * Deps: Vec, Config
 */
// ─── AI/Ranker ─── END ──────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// СЛОЙ: NET — криптография, транспорт, протокол, сетевой сервис
// ═══════════════════════════════════════════════════════════════════════════════

// ─── NET/Crypto ─── START ───────────────────────────────────────────────────
/**
 * [в5] НОВЫЙ. Криптография аккаунта:
 *      - NIP-44 v2: encryptSelf/decryptSelf (ECDH с собственным ключом)
 *        для полезной нагрузки kind 30078;
 *      - NIP-49: ncryptsec-обёртка ключа паролем (показ/ввод ключа).
 * Deps: Nostr
 */
// ─── NET/Crypto ─── END ─────────────────────────────────────────────────────

// ─── NET/Nostr ─── START ────────────────────────────────────────────────────
/**
 * [в5] Транспорт: nostr-tools 2.7.2 (CDN), ключ в localStorage «noomium:sk»,
 *      SimplePool, publish (успех ≥1 релея, таймаут 30с), subscribe.
 *      НОВОЕ: экспорт загруженной библиотеки для NET/Crypto.
 * Deps: Config, EventBus, Logger
 */
// ─── NET/Nostr ─── END ──────────────────────────────────────────────────────

// ─── NET/Protocol ─── START ─────────────────────────────────────────────────
/**
 * [в5] Кодек событий: kind 1 (заметка + НОВЫЙ тег uid), 21000 (запрос),
 *      21001 (ответ), 5 (удаление + НОВЫЙ тег uid).
 *      НОВОЕ: privateEvent(note) → kind 30078 (replaceable, d-tag = uid,
 *      NIP-44 payload {v, text, vec, parent, shared, eventId, ts}),
 *      decodePrivate(ev) → note. Валидация входящих данных.
 * Deps: Config, Vec, Crypto
 */
// ─── NET/Protocol ─── END ───────────────────────────────────────────────────

// ─── NET/NetService ─── START ───────────────────────────────────────────────
/**
 * [в6] Оркестрация сети: подписка на комнату, outbox (announce/del,
 *      localStorage), token bucket входящих, центроиды + префильтр,
 *      heartbeat, online/offline, обработка 21000/21001/5.
 *      НОВОЕ: подписка на себя (authors = pk, kinds 30078/1/5) — живой синк;
 *      расшифровка входящих 30078 → DB.put; backsweep локальных заметок →
 *      30078 (одноразово, флаг syncMigrated); публикация 30078 на все
 *      операции из note:*; экспоненциальный реконнект
 *      (reconnectMaxAttempts / reconnectMaxDelay из Config).
 *      УДАЛЕНО: migrateChildrenParentId (uid стабилен).
 * Deps: Nostr, Protocol, Crypto, DB, Ranker, Vec, Store, Config, Logger, EventBus
 */
// ─── NET/NetService ─── END ─────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// СЛОЙ: DOMAIN — бизнес-логика
// ═══════════════════════════════════════════════════════════════════════════════

// ─── DOMAIN/Notes ─── START ─────────────────────────────────────────────────
/**
 * [в7] CRUD заметок: create/edit/remove/toggleShared. uid стабилен,
 *      parentId — uid (при наличии пина). События note:created/updated/
 *      deleted/shared/unshared (NetService слушает и публикует 30078,
 *      для shared — дополнительно kind 1).
 * Deps: DB, Embedder, EventBus, Logger, Utils
 */
// ─── DOMAIN/Notes ─── END ───────────────────────────────────────────────────

// ─── DOMAIN/Context ─── START ───────────────────────────────────────────────
/**
 * [в7] Контекст поиска: pin / drift / input / none, приоритет drift > pin >
 *      input. Дебаунс-эмбеддинг 350мс с race-guard. Событие note:pin.
 * Deps: Store, Embedder, Config, Utils, EventBus
 */
// ─── DOMAIN/Context ─── END ─────────────────────────────────────────────────

// ─── DOMAIN/Feed ─── START ──────────────────────────────────────────────────
/**
 * [в8] Формирование ленты: без контекста — хронология (local + dedup cache),
 *      с контекстом — cosineBatch + split → lists.local/world/seren.
 *      Триггеры: context, db:change, db:cache. seq-guard от гонок.
 * Deps: DB, Ranker, Store, EventBus, Logger
 */
// ─── DOMAIN/Feed ─── END ────────────────────────────────────────────────────

// ─── DOMAIN/Provenance ─── START ────────────────────────────────────────────
/**
 * [в8] Генеалогия: children / descendants (BFS) / ancestors (до корня).
 *      Свои ссылки — uid, чужие — eventId. Кэш предков 5с.
 *      УЛУЧШЕНИЕ: подписка на db:change/db:cache для очистки кэша
 *      перенесена внутрь модуля (было — внешний вызов из MenuView).
 * Deps: DB, EventBus
 */
// ─── DOMAIN/Provenance ─── END ──────────────────────────────────────────────

// ─── DOMAIN/Influence ─── START ─────────────────────────────────────────────
/**
 * [в8] Резонанс: число уникальных авторов потомков. rebuild + инкремент,
 *      событие influence:updated.
 * Deps: DB, EventBus, Logger
 */
// ─── DOMAIN/Influence ─── END ───────────────────────────────────────────────

// ─── DOMAIN/Account ─── START ───────────────────────────────────────────────
/**
 * [в9] НОВЫЙ. Аккаунт: состояние (ключ есть/сгенерирован, keyExported),
 *      обёртка ключа в ncryptsec (с паролем и без), импорт ключа
 *      (nsec/ncryptsec → замена), экспорт/импорт JSON-архива
 *      ({version, ncryptsec?, notes, config}, upsert по uid).
 * Deps: Config, Nostr, Crypto, DB, EventBus, Logger
 */
// ─── DOMAIN/Account ─── END ─────────────────────────────────────────────────

// ─── DOMAIN/NoteActions ─── START ───────────────────────────────────────────
/**
 * [в9] UI-действия: remove (confirm), toggle, copy (Clipboard + fallback).
 * Deps: Notes, Modal, Toast, I18n
 */
// ─── DOMAIN/NoteActions ─── END ─────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// СЛОЙ: UI — компоненты интерфейса
// ═══════════════════════════════════════════════════════════════════════════════

// ─── UI/Modal ─── START ─────────────────────────────────────────────────────
/**
 * [в10] Модалки: open/close/confirm, Escape, клик по overlay, возврат
 *      фокуса, автофокус, модификаторы primary/danger, класс .selected.
 * Deps: I18n
 */
// ─── UI/Modal ─── END ───────────────────────────────────────────────────────

// ─── UI/Toast ─── START ─────────────────────────────────────────────────────
/**
 * [в10] Тосты: 4 типа, лимит 3, автоудаление, fade-out, haptic
 *      (TelegramAdapter через runtime DI.resolve). Стили — классы .t-ic
 *      вместо инлайн (см. style.css, секция 12).
 * Deps: Config
 */
// ─── UI/Toast ─── END ───────────────────────────────────────────────────────

// ─── UI/Progress ─── START ──────────────────────────────────────────────────
/**
 * [в10] Оверлей загрузки модели: задержка показа 500мс, прогресс по
 *      ai:progress, скрытие по ai:status (model/demo).
 * Deps: EventBus
 */
// ─── UI/Progress ─── END ────────────────────────────────────────────────────

// ─── UI/HeaderStatus ─── START ──────────────────────────────────────────────
/**
 * [в11] Индикаторы шапки: сеть (5 состояний) и ИИ (3 режима), клик по
 *      статусу сети → переподключение, ре-рендер по i18n:change.
 *      ФИКС #5: показ/скрытие #offline-bar по net:status и online/offline.
 * Deps: EventBus, I18n, Embedder
 */
// ─── UI/HeaderStatus ─── END ────────────────────────────────────────────────

// ─── UI/Onboarding ─── START ────────────────────────────────────────────────
/**
 * [в11] Онбординг: 7 секций + НОВЫЙ слайд «Ключ и устройства»
 *      (сохранение ключа, вход на новом устройстве). Показ после
 *      Embedder.load(), флажок «больше не показывать».
 * Deps: Config, Modal, I18n, Embedder
 */
// ─── UI/Onboarding ─── END ──────────────────────────────────────────────────

// ─── UI/Composer ─── START ──────────────────────────────────────────────────
/**
 * [в12] Композер: ввод, авто-рост, лимиты (soft/hard/max), тумблер
 *      Личное/Мир, Ctrl/Cmd+Enter, VisualViewport-обработка клавиатуры,
 *      стили лимитов — классы #ed-hint (см. style.css, секция 9).
 *      ФИКС #6: канал note:edit-request удалён (правка живёт в NoteView).
 * Deps: Context, Notes, Store, I18n, EventBus, Toast, Utils, Config
 */
// ─── UI/Composer ─── END ────────────────────────────────────────────────────

// ─── UI/FeedView ─── START ──────────────────────────────────────────────────
/**
 * [в13] Лента: 3 режима отображения, карточки (тег, ↳, ◆, индикатор
 *      сходства, дата, ✎), сегменты со счётчиками, баннер контекста,
 *      модалки предков/потомков, кнопка истории, rAF-коалесценция.
 *      ФИКС #8: обрезка текста по Config.truncateTextLength.
 * Deps: Store, Context, I18n, Utils, Config, EventBus, Influence,
 *       Provenance, Modal, NetService
 */
// ─── UI/FeedView ─── END ────────────────────────────────────────────────────

// ─── UI/BaseView ─── START ──────────────────────────────────────────────────
/**
 * [в14] База: статистика, поиск (дебаунс 200мс), сортировка new/old/az,
 *      клик → note:open, рендер только при view === 'base'.
 * Deps: Store, DB, I18n, Utils, Config, EventBus
 */
// ─── UI/BaseView ─── END ────────────────────────────────────────────────────

// ─── UI/NoteView ─── START ──────────────────────────────────────────────────
/**
 * [в14] Полноэкранный просмотр: свои (удалить/видимость/пин/правка —
 *      только личные), чужие (просмотр/пин), поиск DB → cache.
 *      ФИКС #1: один click-листенер на root (без накопления).
 *      ФИКС #9: ре-рендер при i18n:change.
 * Deps: DB, Notes, NoteActions, I18n, Utils, Toast, EventBus
 */
// ─── UI/NoteView ─── END ────────────────────────────────────────────────────

// ─── UI/AccountView ─── START ───────────────────────────────────────────────
/**
 * [в15] НОВЫЙ. Экран аккаунта: показать ключ (ncryptsec, маска/раскрытие,
 *      опциональный пароль), вход по nsec/ncryptsec (с подтверждением
 *      перезаписи), экспорт JSON-архива, импорт файла, статус синка.
 *      Стили — секции 16–17 style.css.
 * Deps: Account, Modal, Toast, I18n, Config, EventBus
 */
// ─── UI/AccountView ─── END ─────────────────────────────────────────────────

// ─── UI/MenuView ─── START ──────────────────────────────────────────────────
/**
 * [в15] Меню: тема (+userThemeOverride), язык, настройки ранжирования
 *      (3 ползунка + режим отображения + предпросмотр), Поток/База,
 *      НОВЫЙ пункт «Аккаунт», wipe, fullReset, версия.
 *      ФИКС #2: предпросмотр границ через i18n-ключи с параметрами.
 *      ФИКС #3: единый setView (в т.ч. сброс экрана после wipe).
 *      ФИКС #6: мёртвые .tab-b удалены.
 * Deps: Store, Config, Modal, Toast, I18n, EventBus, Onboarding, DB, Nostr
 */
// ─── UI/MenuView ─── END ────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// СЛОЙ: PLATFORM — интеграция с окружением
// ═══════════════════════════════════════════════════════════════════════════════

// ─── PLATFORM/TelegramAdapter ─── START ─────────────────────────────────────
/**
 * [в16] Telegram Mini Apps: ready/expand, тема (с уважением
 *      userThemeOverride), haptic, showAlert/showConfirm с fallback.
 * Deps: Config, EventBus, Logger
 */
// ─── PLATFORM/TelegramAdapter ─── END ───────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// СЛОЙ: BOOT — точка входа
// ═══════════════════════════════════════════════════════════════════════════════

// ─── BOOT ─── START ─────────────────────────────────────────────────────────
/**
 * [в16] Инициализация в порядке: тема/i18n → подписчики → Telegram →
 *      Context → DOM-модули → wipe-обработчик → показ → Embedder +
 *      NetService → онбординг. Плюс запуск backsweep-миграции v0.6 → v0.7.
 * Deps: —
 */
// ─── BOOT ─── END ───────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// ЗАПУСК
// ═══════════════════════════════════════════════════════════════════════════════
window.DI = DI;

// Активируется после реализации BOOT (волна 16). До тех пор — тихое
// предупреждение в консоль: каркас не является рабочим приложением.
try {
  DI.resolve('Boot').mount();
} catch (e) {
  console.warn('[NOOmium] каркас: ждём реализации модулей —', e && e.message);
}
