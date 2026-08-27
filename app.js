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
 * Утилиты: экранирование, плюрализация, форматирование дат, debounce.
 */
DI.register('Utils', function () {
  /** @type {Object<string, string>} */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /**
   * HTML-экранирование.
   * ВНИМАНИЕ: в текущей версии приложения весь пользовательский контент
   * рендерится через `textContent`, поэтому эта функция зарезервирована
   * на случай будущего rich-text рендеринга.
   * @param {*} s - Произвольное значение.
   * @returns {string} Безопасная для вставки строка.
   */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  }

  /**
   * Экранирование строки для использования в RegExp.
   * @param {*} s - Произвольное значение.
   * @returns {string} Экранированная строка.
   */
  function escRe(s) {
    return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Русская/общая плюрализация: одна форма для 1, другая для 2–4,
   * третья для остальных.
   * @param {number} n - Число.
   * @param {string} one - «1 символ».
   * @param {string} few - «2 символа».
   * @param {string} many - «5 символов».
   * @returns {string}
   */
  function plural(n, one, few, many) {
    n = Math.abs(n);
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
    return many;
  }

  /**
   * Словоформы для составных подписей (счётчики, статистика).
   * @type {Object<string, Function>}
   */
  const words = {
    symbols: (n, l) => n + ' ' + (l === 'en' ? plural(n, 'char', 'chars', 'chars') : plural(n, 'символ', 'символа', 'символов')),
    peers: (n, l) => n + ' ' + (l === 'en' ? plural(n, 'peer', 'peers', 'peers') : plural(n, 'узел', 'узла', 'узлов')),
    thoughts: (n, l) => n + ' ' + (l === 'en' ? plural(n, 'note', 'notes', 'notes') : plural(n, 'мысль', 'мысли', 'мыслей')),
    descendants: (n, l) => n + ' ' + (l === 'en' ? plural(n, 'heir', 'heirs', 'heirs') : plural(n, 'потомок', 'потомка', 'потомков')),
  };

  /**
   * Получить подпись «N <словоформа>» по ключу.
   * @param {string} key - Ключ словоформы (symbols/peers/thoughts/descendants).
   * @param {number} n - Число.
   * @param {string} [lang] - Язык ('ru' | 'en').
   * @returns {string}
   */
  function word(key, n, lang) {
    const fn = words[key];
    return fn ? fn(n, lang) : String(n);
  }

  /**
   * Дата в формате «12 мар».
   * @param {number} ts - Unix-milliseconds.
   * @param {string} [lang] - Язык.
   * @returns {string}
   */
  function fmtDate(ts, lang) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', {
        day: '2-digit',
        month: 'short',
      });
    } catch (_) {
      return '';
    }
  }

  /**
   * Время в формате «14:05».
   * @param {number} ts - Unix-milliseconds.
   * @param {string} [lang] - Язык.
   * @returns {string}
   */
  function fmtTime(ts, lang) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleTimeString(lang === 'en' ? 'en-US' : 'ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (_) {
      return '';
    }
  }

  /**
   * Относительное время: «только что», «5 минут назад», «3 дня назад»,
   * дальше — дата. Формы берутся из словаря I18n.
   * @param {number} ts - Unix-milliseconds.
   * @param {string} lang - Язык.
   * @param {Function} t - Функция перевода I18n.
   * @returns {string}
   */
  function fmtRelativeTime(ts, lang, t) {
    if (!ts || typeof t !== 'function') return '';
    const diff = Date.now() - ts;
    if (diff < 0) return '';
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return t('time.now');
    const min = Math.floor(sec / 60);
    if (min < 60) {
      const form = plural(min, t('time.min.one'), t('time.min.few'), t('time.min.many'));
      return min + ' ' + form;
    }
    const hr = Math.floor(min / 60);
    if (hr < 24) {
      const form = plural(hr, t('time.hr.one'), t('time.hr.few'), t('time.hr.many'));
      return hr + ' ' + form;
    }
    const day = Math.floor(hr / 24);
    if (day < 30) {
      const form = plural(day, t('time.day.one'), t('time.day.few'), t('time.day.many'));
      return day + ' ' + form;
    }
    return fmtDate(ts, lang);
  }

  /**
   * Сокращённый публичный ключ: первые 8 символов + многоточие.
   * @param {string} pk - Публичный ключ в hex.
   * @returns {string}
   */
  const shortPk = pk => (pk ? pk.slice(0, 8) + '…' : '');

  /**
   * Уникальный идентификатор: префикс + время в base36 + случайность.
   * @param {string} [prefix] - Префикс ('n' для заметок).
   * @returns {string}
   */
  function uid(prefix) {
    return (prefix || 'n') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Debounce с методом отмены.
   * @param {Function} fn - Функция.
   * @param {number} ms - Задержка в мс.
   * @returns {Function & {cancel: Function}} Отложенная функция.
   */
  function debounce(fn, ms) {
    let timer = null;
    function debounced(...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, ms);
    }
    debounced.cancel = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    return debounced;
  }

  return { esc, escRe, plural, word, fmtDate, fmtTime, fmtRelativeTime, shortPk, uid, debounce };
});
// ─── CORE/Utils ─── END ─────────────────────────────────────────────────────

// ─── CORE/I18n ─── START ────────────────────────────────────────────────────
/**
 * Интернационализация (ru/en).
 * Словари хранятся в одном месте. Все тексты интерфейса берутся только отсюда.
 *
 * Отличие от v0.6: новые ключи — net.offline (офлайн-бар), account.*/sync.*
 * (экран аккаунта, ключ, экспорт/импорт), preview.* (параметризованный
 * предпросмотр настроек ранжирования), onb.key.* (слайд онбординга про ключ
 * и устройства).
 */
DI.register('I18n', function (Config, bus) {
  /** @type {Object<string, Object<string, string>>} */
  const dicts = Object.create(null);
  /** @type {Array<Function>} */
  const listeners = [];
  let current = 'ru';

  const saved = Config.get('lang', null);
  if (saved === 'ru' || saved === 'en') {
    current = saved;
  } else {
    current = (navigator.language || 'ru').toLowerCase().indexOf('ru') === 0 ? 'ru' : 'en';
  }

  /**
   * Подстановка параметров: 'Максимум {max} символов' + {max: 2500}.
   * @param {string} str - Шаблон.
   * @param {Object} [params] - Параметры.
   * @returns {string}
   */
  function format(str, params) {
    const s = String(str == null ? '' : str);
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
  }

  /**
   * Перевод ключа: текущий язык → en → fallback → сам ключ.
   * @param {string} key - Ключ перевода.
   * @param {Object} [params] - Параметры подстановки.
   * @param {string} [fallback] - Значение, если ключ не найден нигде.
   * @returns {string}
   */
  function t(key, params, fallback) {
    const d = dicts[current] || {};
    let val = Object.prototype.hasOwnProperty.call(d, key) ? d[key] : undefined;
    if (val === undefined) {
      const en = dicts['en'] || {};
      val = Object.prototype.hasOwnProperty.call(en, key) ? en[key] : undefined;
    }
    return format(val !== undefined ? val : (fallback !== undefined ? fallback : key), params);
  }

  /**
   * Зарегистрировать словарь (merges поверх существующего).
   * @param {string} lang - Код языка.
   * @param {Object} dict - Словарь ключ → строка.
   */
  function addDict(lang, dict) {
    dicts[lang] = Object.assign(dicts[lang] || {}, dict || {});
  }

  /** Применить переводы ко всем [data-i18n] элементам в DOM. */
  function applyToDOM() {
    try {
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) el.textContent = t(key);
      });
      document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        const key = el.getAttribute('data-i18n-ph');
        if (key) el.setAttribute('placeholder', t(key));
      });
      document.querySelectorAll('[data-i18n-aria]').forEach(el => {
        const key = el.getAttribute('data-i18n-aria');
        if (key) el.setAttribute('aria-label', t(key));
      });
    } catch (_) {}
  }

  /**
   * Сменить язык. Сохраняет выбор, применяет к DOM, оповещает слушателей
   * и шину ('i18n:change').
   * @param {string} lang - 'ru' | 'en'.
   */
  function setLang(lang) {
    if (lang !== 'ru' && lang !== 'en') return;
    current = lang;
    Config.set('lang', current);
    applyToDOM();
    for (const fn of listeners.slice()) {
      try {
        fn(current);
      } catch (_) {}
    }
    try {
      bus.emit('i18n:change', { lang: current });
    } catch (_) {}
  }

  const getLang = () => current;

  /**
   * Подписаться на смену языка.
   * @param {Function} fn - Колбэк (lang) => {}.
   */
  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  // Русский словарь
  addDict('ru', {
    'st.net': 'сеть',
    'st.ai.loading': 'модель',
    'st.ai.ready': 'ии',
    'st.ai.demo': 'ии/хеш',
    'st.net.online': 'онлайн',
    'st.net.connecting': 'соединение',
    'st.net.reconnecting': 'пересоединение',
    'st.net.failed': 'нет сети',
    'net.offline': 'офлайн — заметки сохраняются локально',

    'progress.title': 'Загружаем модель',

    'ed.placeholder': 'О чём думаешь?',
    'ed.chars': 'симв.',
    'ed.limit.soft': 'Для точного поиска пиши короче',
    'ed.limit.hard': 'Вектор обрезается, качество поиска низкое',
    'ed.limit.max': 'Максимум {max} символов',

    'btn.private': 'Личное',
    'btn.public': 'Мир',
    'btn.save': 'Сохранить',
    'btn.send.aria': 'Отправить',
    'btn.menu.aria': 'Меню',
    'btn.base.aria': 'Моя база',
    'btn.ctx.clear.aria': 'Снять контекст',
    'btn.show': 'Показать',
    'btn.hide': 'Скрыть',
    'btn.copy': 'Копировать',
    'btn.download': 'Скачать',
    'btn.import': 'Импорт',
    'btn.confirm': 'Подтвердить',

    'tab.stream': 'Поток',
    'tab.base': 'База',

    'seg.local': 'Моё',
    'seg.world': 'Мир',
    'seg.seren': 'Озарения',

    'ctx.pinned': 'пин',
    'ctx.drift': 'дрейф от',

    'sim.score': 'похожа на',
    'sim.level.high': 'В тему',
    'sim.level.mid': 'Озарение',
    'sim.level.low': 'Проблеск',

    'inf.resonance': 'резонанс',
    'inf.linked': 'по мотивам',
    'inf.openparent': 'Открыть заметку-источник',
    'inf.children': 'Потомки',
    'inf.nochildren': 'Потомков пока нет',
    'inf.lineage': 'Линейка «по мотивам»',
    'inf.noancestors': 'Это корень — предков нет',
    'inf.orphan.hint': 'Родитель этой заметки был удалён',

    'empty.local.t': 'Пока нет мыслей',
    'empty.world.t': 'Никто не думает так же',
    'empty.seren.t': 'Озарений нет',
    'empty.base.t': 'База пуста',
    'empty.base.empty': 'Ничего не найдено',

    'base.search': 'поиск...',
    'base.sort.new': 'новые',
    'base.sort.old': 'старые',
    'base.sort.az': 'а-я',
    'base.stat.total': 'всего',
    'base.stat.open': 'открыто',
    'base.stat.priv': 'лично',
    'base.tag.private': 'лично',
    'base.tag.shared': 'открыто',
    'base.wipe': 'Стереть базу',
    'base.wipe.confirm': 'Удалить все ваши заметки навсегда?',

    'btn.open': 'Открыть',
    'btn.edit': 'Развить',
    'btn.del': 'Удалить',
    'btn.pin': 'Пин',
    'btn.pin.aria': 'Закрепить для поиска',
    'btn.cancel': 'Отмена',
    'btn.close': 'Закрыть',
    'btn.toggle.priv': 'Скрыть',
    'btn.toggle.pub': 'Открыть',

    'toast.pinned': 'закреплено',
    'toast.saved.private': 'сохранено лично',
    'toast.saved.public': 'опубликовано',
    'toast.copied': 'скопировано',
    'toast.deleted': 'удалено',
    'toast.copy.fail': 'не удалось',
    'toast.empty': 'напиши что-нибудь',
    'toast.base.wiped': 'база очищена',
    'toast.edit.saved': 'сохранено',

    'menu.settings': 'Настройки',
    'menu.theme': 'Тема',
    'menu.lang': 'Язык',
    'menu.help': 'Как это работает',
    'menu.fullreset': 'Полный сброс',
    'menu.fullreset.confirm': 'Удалить ВСЕ данные из браузера (заметки, кэш, модель) и перезагрузить? Это как первый запуск.',
    'menu.fullreset.done': 'перезагрузка через 1.5 сек...',
    'menu.ranking': 'Настройки поиска',
    'menu.account': 'Аккаунт и ключ',

    'ranking.threshold': 'Порог релевантности',
    'ranking.threshold.hint': 'Минимальное сходство для показа в ленте (5%–95%)',
    'ranking.serendipity': 'Диапазон озарений',
    'ranking.serendipity.hint': 'Насколько широкие связи показывать как озарения (5%–30%)',
    'ranking.similarity': 'Порог одинаковости',
    'ranking.similarity.hint': 'Сходство, выше которого заметки считаются одинаковыми (88%–99%)',
    'ranking.reset': 'Сбросить настройки',
    'ranking.saved': 'Настройки сохранены',
    'ranking.display': 'Отображение сходства',
    'ranking.display.signal': 'Индикатор сигнала',
    'ranking.display.percent': 'Проценты (отладка)',

    // Параметризованный предпросмотр границ ранжирования (замена хардкода)
    'preview.ranking': 'Релевантно: ≥ {relevant}% | Озарения: {serenLo}%–{serenHi}% | Скрыто: < {hidden}%',

    'del.confirm': 'Удалить эту заметку навсегда?',

    'net.loadmore': 'Загрузить ещё',
    'net.loading': 'Загружаю…',

    'note.public.noedit': 'Публичные заметки нельзя редактировать',
    'note.edit.placeholder': 'Текст заметки',

    // Аккаунт, ключ, синхронизация
    'account.title': 'Аккаунт и ключ',
    'account.identity': 'Ваш ключ',
    'account.identity.desc': 'Ключ — это вы. Заметки синхронизируются между устройствами через зашифрованные события на вашем релее. Контент видите только вы.',
    'account.npub': 'Публичный адрес',
    'account.nsec.masked': 'Ключ скрыт',
    'account.nsec.hint': 'Никому не показывайте ключ. Если кто-то его получит — он станет вами.',
    'account.exported.mark': 'Ключ показан и скопирован',
    'account.password.set': 'Защитить ключ паролем',
    'account.password.hint': 'Пароль шифрует ключ при показе. Без пароля — быстрый доступ.',
    'account.enter.title': 'Вход по ключу',
    'account.enter.desc': 'Вставьте ключ (nsec… или ncryptsec…) с другого устройства. Текущие заметки и ключ будут заменены.',
    'account.enter.placeholder': 'nsec… или ncryptsec…',
    'account.enter.confirm': 'Заменить аккаунт?',
    'account.enter.confirm.d': 'Текущий ключ и локальные заметки будут удалены. Продолжить?',
    'account.enter.bad': 'Ключ не распознан',
    'account.enter.done': 'Аккаунт заменён, синхронизирую…',
    'account.import.done': 'Импортировано заметок: {count}',
    'account.export.file': 'Архив заметок',
    'account.export.desc': 'Файл с заметками и настройками. Страховка на случай, если релеи очистят данные.',
    'account.import.file': 'Восстановить из файла',
    'account.import.confirm': 'Заменить локальную базу данными из архива?',
    'account.import.confirm.d': 'Заметки из архива будут добавлены (совпадающие по id — обновлены).',
    'account.import.bad': 'Файл не похож на архив NOOmium',
    'account.sync.status': 'Синхронизация',
    'account.sync.on': 'включена',
    'account.sync.off': 'выключена',
    'account.sync.running': 'идёт обмен…',
    'account.sync.hint': 'Зашифрованные копии заметок публикуются на релеи. Отключите, если не хотите ничего отправлять в сеть.',

    'toast.key.copied': 'ключ скопирован',
    'toast.key.saved': 'ключ сохранён',
    'toast.account.migrated': 'заметки переносятся в облако…',
    'toast.sync.disabled': 'синхронизация выключена',
    'toast.sync.enabled': 'синхронизация включена',

    'onb.title': 'Как это работает',
    'onb.dontshow': 'Больше не показывать',
    'onb.gotit': 'Понятно',
    'onb.what.t': 'NOOmium',
    'onb.what.d': 'Соцсеть смыслов: мысли ищутся не по словам и не по лайкам, а по значению. Каждая мысль превращается в вектор — точку в пространстве смыслов.',
    'onb.stream.t': 'Лента',
    'onb.stream.d': 'Показывает свежие мысли — твои и из сети. Просто читай.',
    'onb.pin.t': 'Пин',
    'onb.pin.d': 'Кликни по мысли — она станет контекстом: лента покажет созвучное из твоей базы и из сети. Закреплённая мысль становится «мамой» для всего, что ты напишешь следом.',
    'onb.drift.t': 'Дрейф',
    'onb.drift.d': 'Начни печатать при пине — контекст плавно перейдёт к твоему тексту. Так можно органично уйти от исходной мысли к своей.',
    'onb.modes.t': 'Личное и Мир',
    'onb.modes.d': 'Личное остаётся только у тебя. Мир — делится мыслью с сетью, и другие смогут найти её по смыслу.',
    'onb.resonance.t': 'Резонанс ◆',
    'onb.resonance.d': 'Сколько чужих мыслей родила твоя. «↳ по мотивам» ведёт к заметке-источнику, клик по ◆ показывает потомков.',
    'onb.key.t': 'Ключ и устройства',
    'onb.key.d': 'Твой ключ — это твой аккаунт. Сохрани его в «Настройки → Аккаунт»: с ним любая мысль вернётся на новое устройство автоматически.',
    'onb.delete.t': 'Удаление',
    'onb.delete.d': 'Удаление в Nostr — это просьба к релеям удалить заметку. Большинство рэлеев её выполнят, но те, кто уже увидел заметку, могут её сохранить. Полное удаление возможно только на своём релее.',

    'time.now': 'только что',
    'time.min.one': 'минуту назад',
    'time.min.few': 'минуты назад',
    'time.min.many': 'минут назад',
    'time.hr.one': 'час назад',
    'time.hr.few': 'часа назад',
    'time.hr.many': 'часов назад',
    'time.day.one': 'день назад',
    'time.day.few': 'дня назад',
    'time.day.many': 'дней назад',
  });

  // Английский словарь
  addDict('en', {
    'st.net': 'net',
    'st.ai.loading': 'model',
    'st.ai.ready': 'ai',
    'st.ai.demo': 'ai/hash',
    'st.net.online': 'online',
    'st.net.connecting': 'connecting',
    'st.net.reconnecting': 'reconnecting',
    'st.net.failed': 'offline',
    'net.offline': 'offline — notes are saved locally',

    'progress.title': 'Loading model',

    'ed.placeholder': 'What are you thinking?',
    'ed.chars': 'chars',
    'ed.limit.soft': 'Shorter text = more precise search',
    'ed.limit.hard': 'Vector will be truncated, search quality drops',
    'ed.limit.max': 'Maximum {max} characters',

    'btn.private': 'Private',
    'btn.public': 'World',
    'btn.save': 'Save',
    'btn.send.aria': 'Send',
    'btn.menu.aria': 'Menu',
    'btn.base.aria': 'My base',
    'btn.ctx.clear.aria': 'Clear context',
    'btn.show': 'Show',
    'btn.hide': 'Hide',
    'btn.copy': 'Copy',
    'btn.download': 'Download',
    'btn.import': 'Import',
    'btn.confirm': 'Confirm',

    'tab.stream': 'Stream',
    'tab.base': 'Base',

    'seg.local': 'Mine',
    'seg.world': 'World',
    'seg.seren': 'Insights',

    'ctx.pinned': 'pinned',
    'ctx.drift': 'drift from',

    'sim.score': 'similarity',
    'sim.level.high': 'On topic',
    'sim.level.mid': 'Insight',
    'sim.level.low': 'Glimmer',

    'inf.resonance': 'resonance',
    'inf.linked': 'inspired by',
    'inf.openparent': 'Open source note',
    'inf.children': 'Descendants',
    'inf.nochildren': 'No descendants yet',
    'inf.lineage': '"Inspired by" lineage',
    'inf.noancestors': 'This is the root — no ancestors',
    'inf.orphan.hint': 'The parent of this note was deleted',

    'empty.local.t': 'No thoughts yet',
    'empty.world.t': 'Nobody thinks alike',
    'empty.seren.t': 'No insights',
    'empty.base.t': 'Base is empty',
    'empty.base.empty': 'Nothing found',

    'base.search': 'search...',
    'base.sort.new': 'newest',
    'base.sort.old': 'oldest',
    'base.sort.az': 'a-z',
    'base.stat.total': 'total',
    'base.stat.open': 'open',
    'base.stat.priv': 'private',
    'base.tag.private': 'private',
    'base.tag.shared': 'open',
    'base.wipe': 'Wipe base',
    'base.wipe.confirm': 'Delete all your notes forever?',

    'btn.open': 'Open',
    'btn.edit': 'Develop',
    'btn.del': 'Delete',
    'btn.pin': 'Pin',
    'btn.pin.aria': 'Pin for search',
    'btn.cancel': 'Cancel',
    'btn.close': 'Close',
    'btn.toggle.priv': 'Hide',
    'btn.toggle.pub': 'Share',

    'toast.pinned': 'pinned',
    'toast.saved.private': 'saved privately',
    'toast.saved.public': 'shared',
    'toast.copied': 'copied',
    'toast.deleted': 'deleted',
    'toast.copy.fail': 'copy failed',
    'toast.empty': 'write something',
    'toast.base.wiped': 'base wiped',
    'toast.edit.saved': 'saved',

    'menu.settings': 'Settings',
    'menu.theme': 'Theme',
    'menu.lang': 'Language',
    'menu.help': 'How it works',
    'menu.fullreset': 'Full reset',
    'menu.fullreset.confirm': 'Delete ALL data from browser (notes, cache, model) and reload? This is like first launch.',
    'menu.fullreset.done': 'reloading in 1.5 sec...',
    'menu.ranking': 'Search settings',
    'menu.account': 'Account & key',

    'ranking.threshold': 'Relevance threshold',
    'ranking.threshold.hint': 'Minimum similarity to show in feed (5%–95%)',
    'ranking.serendipity': 'Serendipity range',
    'ranking.serendipity.hint': 'How broad connections to show as insights (5%–30%)',
    'ranking.similarity': 'Duplicate threshold',
    'ranking.similarity.hint': 'Similarity above which notes are considered identical (88%–99%)',
    'ranking.reset': 'Reset settings',
    'ranking.saved': 'Settings saved',
    'ranking.display': 'Similarity display',
    'ranking.display.signal': 'Signal indicator',
    'ranking.display.percent': 'Percentages (debug)',

    'preview.ranking': 'Relevant: ≥ {relevant}% | Insights: {serenLo}%–{serenHi}% | Hidden: < {hidden}%',

    'del.confirm': 'Delete this note forever?',

    'net.loadmore': 'Load more',
    'net.loading': 'Loading…',

    'note.public.noedit': 'Public notes cannot be edited',
    'note.edit.placeholder': 'Note text',

    'account.title': 'Account & key',
    'account.identity': 'Your key',
    'account.identity.desc': 'The key is you. Notes sync between your devices via encrypted events on your relay. Only you can read the content.',
    'account.npub': 'Public address',
    'account.nsec.masked': 'Key hidden',
    'account.nsec.hint': 'Never show your key to anyone. Whoever gets it becomes you.',
    'account.exported.mark': 'Key shown and copied',
    'account.password.set': 'Protect key with password',
    'account.password.hint': 'Password encrypts the key when displayed. Without it — quick access.',
    'account.enter.title': 'Sign in with key',
    'account.enter.desc': 'Paste a key (nsec… or ncryptsec…) from another device. Current notes and key will be replaced.',
    'account.enter.placeholder': 'nsec… or ncryptsec…',
    'account.enter.confirm': 'Replace account?',
    'account.enter.confirm.d': 'Current key and local notes will be deleted. Continue?',
    'account.enter.bad': 'Key not recognized',
    'account.enter.done': 'Account replaced, syncing…',
    'account.import.done': 'Notes imported: {count}',
    'account.export.file': 'Notes archive',
    'account.export.desc': 'A file with your notes and settings. A safety net in case relays wipe their data.',
    'account.import.file': 'Restore from file',
    'account.import.confirm': 'Replace local base with archive data?',
    'account.import.confirm.d': 'Notes from the archive will be added (matching ids updated).',
    'account.import.bad': 'File does not look like a NOOmium archive',
    'account.sync.status': 'Sync',
    'account.sync.on': 'on',
    'account.sync.off': 'off',
    'account.sync.running': 'exchanging…',
    'account.sync.hint': 'Encrypted copies of notes are published to relays. Turn off if you do not want anything sent to the network.',

    'toast.key.copied': 'key copied',
    'toast.key.saved': 'key saved',
    'toast.account.migrated': 'moving notes to the cloud…',
    'toast.sync.disabled': 'sync disabled',
    'toast.sync.enabled': 'sync enabled',

    'onb.title': 'How it works',
    'onb.dontshow': "Don't show again",
    'onb.gotit': 'Got it',
    'onb.what.t': 'NOOmium',
    'onb.what.d': 'A social network of meaning: thoughts are found not by words or likes, but by sense. Each thought becomes a vector — a point in meaning-space.',
    'onb.stream.t': 'Feed',
    'onb.stream.d': 'Shows fresh thoughts — yours and from the network. Just read.',
    'onb.pin.t': 'Pin',
    'onb.pin.d': 'Click a thought to make it the context: the feed shows what resonates, from your base and the network. The pinned thought becomes the "mother" of what you write next.',
    'onb.drift.t': 'Drift',
    'onb.drift.d': 'Start typing while pinned — the context shifts toward your text. A natural way to drift from the original thought to your own.',
    'onb.modes.t': 'Private & World',
    'onb.modes.d': 'Private stays with you. World shares the thought with the network so others can find it by meaning.',
    'onb.resonance.t': 'Resonance ◆',
    'onb.resonance.d': 'How many thoughts yours inspired. "↳ inspired by" leads to the source note; click ◆ to see descendants.',
    'onb.key.t': 'Key & devices',
    'onb.key.d': 'Your key is your account. Save it in "Settings → Account": with it, every thought returns to a new device automatically.',
    'onb.delete.t': 'Deletion',
    'onb.delete.d': 'Deletion in Nostr is a request to relays to delete a note. Most relays will honor it, but those who already saw the note may keep it. Full deletion is only possible on your own relay.',

    'time.now': 'just now',
    'time.min.one': 'min ago',
    'time.min.few': 'min ago',
    'time.min.many': 'min ago',
    'time.hr.one': 'hr ago',
    'time.hr.few': 'hrs ago',
    'time.hr.many': 'hrs ago',
    'time.day.one': 'day ago',
    'time.day.few': 'days ago',
    'time.day.many': 'days ago',
  });

  /** Применить переводы к текущему DOM. Вызывается из BOOT. */
  function init() {
    applyToDOM();
  }

  return { t, addDict, setLang, getLang, onChange, applyToDOM, init };
}, ['Config', 'EventBus']);
// ─── CORE/I18n ─── END ──────────────────────────────────────────────────────

// ─── CORE/Store ─── START ───────────────────────────────────────────────────
/**
 * Минимальный синхронный стор приложения.
 * Не содержит бизнес-логики — только состояние и подписки.
 */
DI.register('Store', function () {
  /**
   * Состояние приложения.
   * @type {Object}
   * @property {string} state.view - Активный экран: 'stream' | 'base'.
   * @property {string} state.seg - Активный сегмент ленты: 'local' | 'world' | 'seren'.
   * @property {Object} state.context - Контекст поиска.
   * @property {string|null} state.context.source - 'pin' | 'drift' | 'input' | null.
   * @property {string|null} state.context.noteId - uid закреплённой заметки.
   * @property {string} state.context.text - Текст контекста.
   * @property {Array<number>|Float32Array|null} state.context.vector - Вектор контекста.
   * @property {string|null} state.context.pinText - Текст пина при дрейфе.
   * @property {string} state.sendMode - Режим отправки: 'private' | 'world'.
   * @property {Object} state.lists - Ранжированные списки при контексте.
   * @property {Array} state.feed - Хронологический поток без контекста.
   */
  const state = {
    view: 'stream',
    seg: 'local',
    context: { source: null, noteId: null, text: '', vector: null, pinText: null },
    sendMode: 'private',
    lists: { local: [], world: [], seren: [] },
    feed: [],
  };

  /** @type {Array<Function>} */
  const listeners = [];

  /**
   * Поверхностное сравнение объектов (для selector-подписок).
   * @param {*} a
   * @param {*} b
   * @returns {boolean}
   */
  function shallowEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!Object.is(a[k], b[k])) return false;
    }
    return true;
  }

  /** @returns {Object} Замороженный снапшот состояния. */
  const snapshot = () => Object.freeze(Object.assign({}, state));

  /** Оповестить всех слушателей снапшотом. */
  function notify() {
    const snap = snapshot();
    for (const l of listeners.slice()) {
      try {
        l(snap);
      } catch (e) {
        console.error('[store]', e);
      }
    }
  }

  /** @returns {Object} Замороженный снапшот состояния. */
  const getState = () => snapshot();

  /**
   * Получить значение поля состояния напрямую (без снапшота).
   * @param {string} k - Ключ.
   * @returns {*}
   */
  const get = k => state[k];

  /**
   * Частичное обновление состояния + уведомление подписчиков.
   * @param {Object} partial - Патч состояния.
   */
  function setState(partial) {
    if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return;
    Object.assign(state, partial);
    notify();
  }

  /**
   * Подписка на изменения.
   * Варианты:
   *   subscribe(listener) — на любое изменение;
   *   subscribe(selector, listener, equals?) — только когда результат
   *   селектора изменился (по умолчанию Object.is, для объектов —
   *   передавайте Store.shallowEqual).
   * @param {Function} a - Слушатель или селектор.
   * @param {Function} [b] - Слушатель (при selector-варианте).
   * @param {Function} [equals] - Функция равенства.
   * @returns {Function} Функция отписки.
   */
  function subscribe(a, b, equals) {
    if (typeof b === 'function') {
      const selector = a, listener = b, eq = equals || Object.is;
      let prev = selector(snapshot());
      const wrap = s => {
        const next = selector(s);
        if (!eq(next, prev)) {
          prev = next;
          listener(next, s);
        }
      };
      listeners.push(wrap);
      return () => {
        const i = listeners.indexOf(wrap);
        if (i > -1) listeners.splice(i, 1);
      };
    }

    listeners.push(a);
    return () => {
      const i = listeners.indexOf(a);
      if (i > -1) listeners.splice(i, 1);
    };
  }

  return { getState, get, setState, subscribe, shallowEqual };
});
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
