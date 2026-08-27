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
 * Векторные операции: нормализация, cosine similarity, сжатие в base64, k-means.
 * Все векторы ожидаются нормализованными (единичная длина).
 */
DI.register('Vec', function () {
  /**
   * Приведение к Float32Array.
   * @param {Float32Array|Array<number>} v - Входной вектор.
   * @returns {Float32Array}
   */
  const f32 = v => (v instanceof Float32Array ? v : Float32Array.from(v || []));

  /**
   * Сериализация вектора в compact base64 (Int16 квантование).
   * Используется для передачи векторов в Nostr-событиях.
   * @param {Float32Array|Array<number>} vec - Нормализованный вектор.
   * @returns {string} Base64-строка.
   */
  function toB64(vec) {
    const f = f32(vec);
    const i16 = new Int16Array(f.length);

    for (let i = 0; i < f.length; i++) {
      let x = f[i];
      if (x > 1) x = 1;
      else if (x < -1) x = -1;
      i16[i] = Math.round(x * 32767);
    }

    const bytes = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }

    return btoa(bin);
  }

  /**
   * Десериализация вектора из base64 + повторная нормализация.
   * @param {string} b64 - Base64-строка.
   * @returns {Float32Array|null} Нормализованный вектор или null при ошибке.
   */
  function fromB64(b64) {
    try {
      const bin = atob(String(b64 || ''));
      if (!bin || bin.length < 2 || bin.length % 2 !== 0) return null;

      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }

      const i16 = new Int16Array(bytes.buffer);
      const out = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) {
        out[i] = i16[i] / 32767;
      }

      return normalize(out);
    } catch (_) {
      return null;
    }
  }

  /**
   * Косинусное сходство для нормализованных векторов (скалярное произведение).
   * Если векторы разной длины, сравниваем по минимальной длине.
   * @param {Float32Array|Array<number>} a - Первый вектор.
   * @param {Float32Array|Array<number>} b - Второй вектор.
   * @returns {number} Сходство в диапазоне [-1, 1].
   */
  function cosine(a, b) {
    if (!a || !b) return 0;
    const n = Math.min(a.length, b.length);
    if (!n) return 0;

    let s = 0;
    for (let i = 0; i < n; i++) {
      s += a[i] * b[i];
    }

    return s;
  }

  /**
   * Нормализация вектора к единичной длине.
   * @param {Float32Array|Array<number>} v - Входной вектор.
   * @returns {Float32Array} Нормализованный вектор (нулевой при нулевой норме).
   */
  function normalize(v) {
    const f = f32(v);
    let norm = 0;

    for (let i = 0; i < f.length; i++) {
      norm += f[i] * f[i];
    }

    norm = Math.sqrt(norm);
    const out = new Float32Array(f.length);
    if (!norm) return out;

    for (let i = 0; i < f.length; i++) {
      out[i] = f[i] / norm;
    }

    return out;
  }

  /**
   * Квадрат евклидова расстояния (внутренняя для k-means).
   * @param {Float32Array|Array<number>} a
   * @param {Float32Array|Array<number>} b
   * @returns {number}
   */
  function sqDist(a, b) {
    const n = Math.min(a.length, b.length);
    let s = 0;

    for (let i = 0; i < n; i++) {
      const d = a[i] - b[i];
      s += d * d;
    }

    return s;
  }

  /**
   * Упрощённый k-means с инициализацией k-means++.
   * Используется для центроидов префильтра входящих запросов.
   * @param {Array<Float32Array|Array<number>>} vectors - Набор векторов.
   * @param {number} k - Число кластеров.
   * @param {number} [iterations] - Число итераций (по умолчанию 10).
   * @returns {Array<Float32Array>} Центроиды.
   */
  function kmeans(vectors, k, iterations) {
    const iters = iterations || 10;
    const n = vectors.length;

    if (!n || !k) return [];
    if (n <= k) return vectors.map(v => f32(v));

    const dim = vectors[0].length;

    const cents = [f32(vectors[0])];
    while (cents.length < k) {
      let bestI = 0, bestD = -1;

      for (let i = 0; i < n; i++) {
        let minD = Infinity;

        for (const c of cents) {
          const d = sqDist(vectors[i], c);
          if (d < minD) minD = d;
        }

        if (minD > bestD) {
          bestD = minD;
          bestI = i;
        }
      }

      cents.push(f32(vectors[bestI]));
    }

    for (let it = 0; it < iters; it++) {
      const sums = Array.from({ length: k }, () => new Float32Array(dim));
      const counts = new Array(k).fill(0);

      for (let i = 0; i < n; i++) {
        let best = 0, bestD = Infinity;

        for (let c = 0; c < k; c++) {
          const d = sqDist(vectors[i], cents[c]);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }

        counts[best]++;
        for (let d = 0; d < dim; d++) {
          sums[best][d] += vectors[i][d];
        }
      }

      for (let c = 0; c < k; c++) {
        if (counts[c]) {
          for (let d = 0; d < dim; d++) {
            cents[c][d] = sums[c][d] / counts[c];
          }
        }
      }
    }

    return cents;
  }

  return { toB64, fromB64, cosine, normalize, kmeans };
});
// ─── DATA/Vec ─── END ───────────────────────────────────────────────────────

// ─── DATA/DB ─── START ──────────────────────────────────────────────────────
/**
 * Слой хранения: IndexedDB с fallback в память.
 * Два хранилища:
 * - notes: локальные заметки пользователя
 * - cache: сетевые заметки/ответы
 *
 * Отличие от v0.6: ин-мемори индексы идентификаторов.
 * Строятся один раз при открытии БД, поддерживаются инкрементально
 * на каждой операции. Методы hasLocal()/hasCache() дают O(1)-проверку
 * «есть ли заметка локально» — вместо полного скана DB.all() на каждое
 * входящее сетевое событие (фикс #10).
 *
 * КОНТРАКТ: сетевые обработчики (NetService) должны дождаться
 * DB.ready() перед началом приёма событий — иначе индексы могут
 * быть ещё не построены.
 */
DI.register('DB', function (Config, bus, Logger) {
  let db = null;
  let mem = null;
  let memCache = null;
  let openPromise = null;

  const NOTES = () => Config.get('storeName', 'notes');
  const CACHE = () => Config.get('cacheStoreName', 'cache');

  // ─── Ин-мемори индексы ─────────────────────────────────────────────────────

  /** @type {Set<string>} id всех локальных заметок. */
  const localIds = new Set();
  /** @type {Set<string>} eventId всех опубликованных локальных заметок. */
  const localEventIds = new Set();
  /** @type {Set<string>} id всех заметок в сетевом кэше. */
  const cacheIds = new Set();

  function emitChange() {
    try { bus.emit('db:change'); } catch (_) {}
  }

  function emitCache() {
    try { bus.emit('db:cache'); } catch (_) {}
  }

  /**
   * Обёртка IDBRequest → Promise.
   * @param {IDBRequest} req - Запрос.
   * @returns {Promise<*>}
   */
  function reqPromise(req) {
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  /**
   * Открытие БД. При успешном открытии ДО резолва строит индексы
   * (один полный проход по notes + чтение ключей cache).
   * При недоступности IndexedDB — fallback в память (индексы
   * поддерживаются инкрементально с пустого состояния).
   * @returns {Promise<IDBDatabase|null>}
   */
  function open() {
    if (openPromise) return openPromise;

    openPromise = new Promise(resolve => {
      if (!window.indexedDB) {
        mem = new Map();
        memCache = new Map();
        Logger.warn('DB: IndexedDB недоступен, in-memory fallback');
        return resolve(null);
      }

      try {
        const req = indexedDB.open(Config.get('dbName', 'noomium_v2'), 1);

        req.onupgradeneeded = e => {
          const d = e.target.result;

          if (!d.objectStoreNames.contains(NOTES())) {
            d.createObjectStore(NOTES(), { keyPath: 'id' });
          }

          if (!d.objectStoreNames.contains(CACHE())) {
            d.createObjectStore(CACHE(), { keyPath: 'id' });
          }
        };

        req.onsuccess = e => {
          db = e.target.result;
          buildIndexes().then(() => resolve(db)).catch(() => resolve(db));
        };

        req.onerror = () => {
          mem = new Map();
          memCache = new Map();
          Logger.warn('DB: ошибка открытия, fallback');
          resolve(null);
        };

        req.onblocked = () => {
          mem = new Map();
          memCache = new Map();
          Logger.warn('DB: open blocked, fallback');
          resolve(null);
        };
      } catch (err) {
        mem = new Map();
        memCache = new Map();
        Logger.warn('DB: не поддерживается, fallback', String(err));
        resolve(null);
      }
    });

    return openPromise;
  }

  /**
   * Полная перестройка индексов из БД (однократно при открытии).
   * @returns {Promise<void>}
   */
  function buildIndexes() {
    const t = db.transaction([NOTES(), CACHE()], 'readonly');

    return Promise.all([
      reqPromise(t.objectStore(NOTES()).getAll()).catch(() => []),
      reqPromise(t.objectStore(CACHE()).getAllKeys()).catch(() => []),
    ]).then(([notes, keys]) => {
      localIds.clear();
      localEventIds.clear();
      cacheIds.clear();

      (notes || []).forEach(n => {
        if (n && n.id) {
          localIds.add(n.id);
          if (n.eventId) localEventIds.add(n.eventId);
        }
      });

      (keys || []).forEach(k => cacheIds.add(k));

      Logger.info('DB: индексы построены (' + localIds.size + ' локальных, ' + cacheIds.size + ' в кэше)');
    });
  }

  /**
   * Универсальная обёртка транзакции с memory-fallback.
   * @param {string} store - Имя object store.
   * @param {string} mode - 'readonly' | 'readwrite'.
   * @param {Function} fn - (objectStore) => IDBRequest.
   * @param {Function} memFn - Синхронный fallback в памяти.
   * @returns {Promise<*>}
   */
  function withStore(store, mode, fn, memFn) {
    return open().then(d => {
      if (!d) return memFn();

      return new Promise((res, rej) => {
        try {
          const r = fn(d.transaction(store, mode).objectStore(store));
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        } catch (e) {
          rej(e);
        }
      });
    });
  }

  // ─── Локальные заметки ─────────────────────────────────────────────────────

  /**
   * Сохранить/обновить заметку.
   * @param {Object} note - Заметка с полем id.
   * @returns {Promise<string>} id заметки.
   */
  function put(note) {
    return withStore(
      NOTES(),
      'readwrite',
      s => s.put(note),
      () => { mem.set(note.id, note); return note.id; }
    ).then(res => {
      if (note && note.id) {
        localIds.add(note.id);
        if (note.eventId) localEventIds.add(note.eventId);
      }
      emitChange();
      return res;
    });
  }

  /**
   * Получить заметку по id.
   * @param {string} id
   * @returns {Promise<Object|undefined>}
   */
  function get(id) {
    return withStore(
      NOTES(),
      'readonly',
      s => s.get(id),
      () => mem.get(id)
    );
  }

  /**
   * Удалить заметку. Перед удалением читает заметку, чтобы вычистить
   * из индекса и её eventId.
   * @param {string} id
   * @returns {Promise<*>}
   */
  function del(id) {
    return get(id).then(note => {
      return withStore(
        NOTES(),
        'readwrite',
        s => s.delete(id),
        () => { mem.delete(id); }
      ).then(res => {
        localIds.delete(id);
        if (note && note.eventId) localEventIds.delete(note.eventId);
        emitChange();
        return res;
      });
    });
  }

  /**
   * Все локальные заметки.
   * @returns {Promise<Array<Object>>}
   */
  function all() {
    return withStore(
      NOTES(),
      'readonly',
      s => s.getAll(),
      () => Array.from(mem.values())
    );
  }

  /**
   * Полная очистка обоих хранилищ + индексов.
   * @returns {Promise<void>}
   */
  function reset() {
    return open().then(d => {
      if (!d) {
        mem.clear();
        memCache.clear();
        return;
      }

      return new Promise((res, rej) => {
        const t = d.transaction([NOTES(), CACHE()], 'readwrite');
        t.objectStore(NOTES()).clear();
        t.objectStore(CACHE()).clear();

        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
      });
    }).then(() => {
      localIds.clear();
      localEventIds.clear();
      cacheIds.clear();
      emitChange();
      emitCache();
    });
  }

  // ─── Сетевой кэш ───────────────────────────────────────────────────────────

  /**
   * Сохранить/обновить заметку в кэше.
   * @param {Object} note - Заметка с полем id.
   * @returns {Promise<string>}
   */
  function cachePut(note) {
    return withStore(
      CACHE(),
      'readwrite',
      s => s.put(note),
      () => { memCache.set(note.id, note); return note.id; }
    ).then(res => {
      if (note && note.id) cacheIds.add(note.id);
      emitCache();
      return res;
    });
  }

  /**
   * Получить заметку из кэша.
   * @param {string} id
   * @returns {Promise<Object|undefined>}
   */
  function cacheGet(id) {
    return withStore(
      CACHE(),
      'readonly',
      s => s.get(id),
      () => memCache.get(id)
    );
  }

  /**
   * Все заметки кэша.
   * @returns {Promise<Array<Object>>}
   */
  function cacheAll() {
    return withStore(
      CACHE(),
      'readonly',
      s => s.getAll(),
      () => Array.from(memCache.values())
    );
  }

  /**
   * Удалить заметку из кэша.
   * @param {string} id
   * @returns {Promise<*>}
   */
  function cacheDel(id) {
    return withStore(
      CACHE(),
      'readwrite',
      s => s.delete(id),
      () => { memCache.delete(id); }
    ).then(res => {
      cacheIds.delete(id);
      emitCache();
      return res;
    });
  }

  return {
    put,
    get,
    del,
    all,
    reset,
    cachePut,
    cacheGet,
    cacheAll,
    cacheDel,

    /**
     * Готовность БД (индексы построены). NetService обязан дождаться
     * этого перед открытием подписки на входящие события.
     * @returns {Promise<IDBDatabase|null>}
     */
    ready: open,

    /**
     * Есть ли заметка с таким id ИЛИ eventId среди ЛОКАЛЬНЫХ (O(1)).
     * Используется для отсечения дублей своих заметок, приходящих
     * из сети.
     * @param {string} idOrEventId - Локальный id или eventId.
     * @returns {boolean}
     */
    hasLocal(idOrEventId) {
      if (!idOrEventId) return false;
      return localIds.has(idOrEventId) || localEventIds.has(idOrEventId);
    },

    /**
     * Есть ли заметка с таким id в сетевом кэше (O(1)).
     * @param {string} id
     * @returns {boolean}
     */
    hasCache(id) {
      return !!id && cacheIds.has(id);
    },
  };
}, ['Config', 'EventBus', 'Logger']);
// ─── DATA/DB ─── END ────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// СЛОЙ: AI — эмбеддинг, ранжирование
// ═══════════════════════════════════════════════════════════════════════════════

// ─── AI/Embedder ─── START ──────────────────────────────────────────────────
/**
 * Embedder для Granite R2 (ModernBERT backbone).
 *
 * Архитектура модели (из документации IBM):
 * - granite-encoder-small-multilingual: 12 слоёв, 384-dim, SiLU, RoPE theta 160,000
 * - Пулинг: [CLS] (формула 3.2 в paper)
 * - Нормализация: да (косинусное сходство нормализованных векторов)
 *
 * Транспортировка:
 * - Модель грузится в Web Worker через transformers.js
 * - Fallback: FNV-1a хеш-эмбеддинг при недоступности Worker или ошибке загрузки
 *
 * Режимы:
 * - 'loading' — модель грузится
 * - 'model'   — модель готова
 * - 'demo'    — хеш-фолбэк (качество поиска нулевое, приложение не падает)
 */
DI.register('Embedder', function (Config, bus, Logger) {
  /**
   * Код Web Worker'а (строкой — для создания через Blob).
   * Грузит transformers.js с CDN, строит pipeline, отвечает на запросы embed.
   * @type {string}
   */
  const workerCode = `
let extractor = null;
let ready = false;
let files = new Map();

self.onmessage = async function (e) {
  const msg = e.data;
  
  if (msg.type === 'load') {
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@latest');
      mod.env.allowLocalModels = false;
      mod.env.useBrowserCache = true;
      
      extractor = await mod.pipeline('feature-extraction', msg.model, {
        dtype: 'q8',
        progress_callback: function (p) {
          if (p.status === 'progress') {
            const fileName = p.file || p.name || 'unknown';
            files.set(fileName, { 
              loaded: p.loaded || 0, 
              total: p.total || 0,
              file: fileName
            });
            
            let totalLoaded = 0, totalSize = 0;
            files.forEach(f => { 
              totalLoaded += f.loaded; 
              if (f.total > 0) totalSize += f.total; 
            });
            
            const pct = totalSize > 0 ? (totalLoaded / totalSize) * 100 : 0;
            self.postMessage({ 
              type: 'progress', 
              pct,
              loadedMB: (totalLoaded / 1024 / 1024).toFixed(1),
              totalMB: totalSize > 0 ? (totalSize / 1024 / 1024).toFixed(1) : null,
              model: msg.model
            });
          }
        }
      });
      
      ready = true;
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ 
        type: 'error', 
        id: null, 
        message: String(err && err.message || err) 
      });
    }
    return;
  }
  
  if (!ready) {
    self.postMessage({ 
      type: 'error', 
      id: msg.id, 
      message: 'model not loaded' 
    });
    return;
  }
  
  if (msg.type === 'embed') {
    try {
      // Granite R2: [CLS] pooling + нормализация (согласно документации)
      const out = await extractor(msg.text, { pooling: 'cls', normalize: true });
      self.postMessage({ 
        type: 'result', 
        id: msg.id, 
        vector: Array.from(out.data) 
      });
    } catch (err) {
      self.postMessage({ 
        type: 'error', 
        id: msg.id, 
        message: String(err && err.message || err) 
      });
    }
  }
};
`;

  /** @type {Worker|null} */
  let worker = null;
  /** @type {string|null} */
  let workerUrl = null;
  /** @type {'loading'|'model'|'demo'} */
  let mode = 'loading';
  let loadPromise = null;
  let nextId = 0;
  let lastPct = 0;
  /** @type {Map<number, {resolve: Function, timer: number, text: string}>} */
  const pending = new Map();
  /** @type {Array<Function>} */
  const progressFns = [];
  /** @type {Map<string, Float32Array>} */
  const cache = new Map();

  function emitStatus() {
    try {
      bus.emit('ai:status', { mode, percent: lastPct });
    } catch (_) {}
  }

  /**
   * Fallback: детерминированный хеш-эмбеддинг (FNV-1a).
   * Используется только если Worker/модель недоступны.
   * Качество поиска при этом нулевое, но приложение не падает.
   * @param {string} text - Текст.
   * @returns {Float32Array} Нормализованный вектор размерности dim.
   */
  function hashEmbed(text) {
    const DIM = Config.get('dim', 384);
    const vec = new Float32Array(DIM);
    const tokens = (text || '').toLowerCase().match(/[a-zа-яё0-9]+/gi) || [];

    for (const tok of tokens) {
      let h = 2166136261;
      for (let i = 0; i < tok.length; i++) {
        h ^= tok.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      vec[Math.abs(h) % DIM] += 1;

      const h2 = Math.imul(h ^ 0x9e3779b9, 2654435761);
      vec[Math.abs(h2) % DIM] += 0.5;
    }

    let norm = 0;
    for (let i = 0; i < DIM; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;

    for (let i = 0; i < DIM; i++) vec[i] /= norm;
    return vec;
  }

  /**
   * LRU-чтение из кэша.
   * @param {string} key - Текст.
   * @returns {Float32Array|undefined}
   */
  function cacheGet(key) {
    if (!cache.has(key)) return undefined;
    const v = cache.get(key);
    cache.delete(key);
    cache.set(key, v);
    return v;
  }

  /**
   * LRU-запись в кэш с вытеснением старых записей.
   * @param {string} key - Текст.
   * @param {Float32Array} v - Вектор.
   */
  function cacheSet(key, v) {
    if (cache.has(key)) {
      cache.delete(key);
    } else if (cache.size >= Config.get('aiCacheLimit', 300)) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(key, v);
  }

  /**
   * Аварийная очистка: завершает все ожидающие embed-запросы
   * хеш-векторами, убивает Worker и revoke'ит Blob-URL.
   */
  function cleanup() {
    pending.forEach(p => {
      clearTimeout(p.timer);
      const v = hashEmbed(p.text);
      cacheSet(p.text, v);
      p.resolve(v);
    });
    pending.clear();

    if (worker) {
      try { worker.terminate(); } catch (_) {}
      worker = null;
    }

    if (workerUrl) {
      try { URL.revokeObjectURL(workerUrl); } catch (_) {}
      workerUrl = null;
    }
  }

  /**
   * Загрузка модели: создаёт Worker, шлёт 'load', ждёт 'ready'.
   * Любой сбой (таймаут 120с, ошибка Worker, ошибка модели) → demo mode.
   * @returns {Promise<void>}
   */
  function doLoad() {
    return new Promise(resolve => {
      if (typeof Worker === 'undefined') {
        mode = 'demo';
        emitStatus();
        Logger.warn('Embedder: Worker не поддерживается, demo mode');
        return resolve();
      }

      try {
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        workerUrl = URL.createObjectURL(blob);
        worker = new Worker(workerUrl, { type: 'module' });
      } catch (err) {
        mode = 'demo';
        emitStatus();
        Logger.warn('Embedder: не создать Worker, demo mode', String(err));
        return resolve();
      }

      // Таймаут загрузки модели: 120 секунд.
      // Если Worker не прислал 'ready' за это время, переходим в demo mode.
      // Это защищает от зависшего CDN или бесконечной загрузки.
      const LOAD_TIMEOUT = 120000;
      let resolved = false;

      const loadTimer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        Logger.warn('Embedder: таймаут загрузки модели (' + LOAD_TIMEOUT / 1000 + 'с), demo mode');
        cleanup();
        mode = 'demo';
        emitStatus();
        resolve();
      }, LOAD_TIMEOUT);

      worker.onerror = err => {
        if (resolved) return;
        resolved = true;
        clearTimeout(loadTimer);
        Logger.warn('Embedder: ошибка Worker, demo mode', String(err && err.message || err));
        cleanup();
        mode = 'demo';
        emitStatus();
        resolve();
      };

      worker.onmessage = e => {
        const msg = e.data;

        if (msg.type === 'progress') {
          lastPct = msg.pct;

          for (const fn of progressFns) {
            try { fn(msg); } catch (_) {}
          }

          try { bus.emit('ai:progress', msg); } catch (_) {}
          try {
            bus.emit('ai:status', {
              mode: 'loading',
              percent: msg.pct,
              loadedMB: msg.loadedMB,
              totalMB: msg.totalMB,
              model: msg.model,
            });
          } catch (_) {}
        }
        else if (msg.type === 'ready') {
          if (resolved) return;
          resolved = true;
          clearTimeout(loadTimer);
          mode = 'model';
          emitStatus();
          Logger.info('Embedder: модель готова');
          resolve();
        }
        else if (msg.type === 'error' && msg.id === null) {
          if (resolved) return;
          resolved = true;
          clearTimeout(loadTimer);
          Logger.warn('Embedder: ошибка загрузки модели, demo mode', msg.message);
          cleanup();
          mode = 'demo';
          emitStatus();
          resolve();
        }
        else if (msg.type === 'result') {
          const p = pending.get(msg.id);
          if (p) {
            clearTimeout(p.timer);
            pending.delete(msg.id);

            const vec = Float32Array.from(msg.vector);
            cacheSet(p.text, vec);
            p.resolve(vec);
          }
        }
        else if (msg.type === 'error' && msg.id != null) {
          const p = pending.get(msg.id);
          if (p) {
            clearTimeout(p.timer);
            pending.delete(msg.id);

            Logger.warn('Embedder: ошибка embed, hash fallback', msg.message);
            const v = hashEmbed(p.text);
            cacheSet(p.text, v);
            p.resolve(v);
          }
        }
      };

      worker.postMessage({
        type: 'load',
        model: Config.get('model', 'onnx-community/granite-embedding-97m-multilingual-r2-ONNX'),
      });
    });
  }

  return {
    /**
     * Загрузка модели. Повторные вызовы возвращают тот же промис /
     * мгновенно резолвятся в режимах model/demo.
     * @param {Function} [onProgress] - Колбэк прогресса ({pct, loadedMB, totalMB, model}).
     * @returns {Promise<void>}
     */
    load(onProgress) {
      if (typeof onProgress === 'function') {
        progressFns.push(onProgress);
      }

      if (mode === 'model' || mode === 'demo') {
        return Promise.resolve();
      }

      if (loadPromise) return loadPromise;

      mode = 'loading';
      emitStatus();
      loadPromise = doLoad().then(() => {
        loadPromise = null;
      });

      return loadPromise;
    },

    /**
     * Эмбеддинг текста. Кэш LRU → Worker (с таймаутом) → hash-fallback.
     * @param {string} text - Текст.
     * @returns {Promise<Float32Array|null>} Вектор или null для пустого текста.
     */
    embed(text) {
      const t = (text || '').trim();
      if (!t) return Promise.resolve(null);

      const cached = cacheGet(t);
      if (cached) return Promise.resolve(cached);

      if (mode === 'demo' || !worker) {
        const v = hashEmbed(t);
        cacheSet(t, v);
        return Promise.resolve(v);
      }

      const id = nextId++;
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          if (pending.delete(id)) {
            Logger.warn('Embedder: таймаут embed, hash fallback');
            const v = hashEmbed(t);
            cacheSet(t, v);
            resolve(v);
          }
        }, Config.get('aiEmbedTimeout', 15000));

        pending.set(id, { resolve, timer, text: t });
        worker.postMessage({ type: 'embed', id, text: t });
      });
    },

    /**
     * Готов ли эмбеддер к работе (model или demo).
     * @returns {boolean}
     */
    ready() {
      return mode === 'model' || mode === 'demo';
    },

    /**
     * Текущий режим: 'loading' | 'model' | 'demo'.
     * @returns {string}
     */
    getMode() {
      return mode;
    },

    /**
     * Подписка на прогресс загрузки (для UI).
     * @param {Function} fn - Колбэк.
     */
    onProgress(fn) {
      if (typeof fn === 'function') {
        progressFns.push(fn);
      }
    },
  };
}, ['Config', 'EventBus', 'Logger']);
// ─── AI/Embedder ─── END ────────────────────────────────────────────────────

// ─── AI/Ranker ─── START ────────────────────────────────────────────────────
/**
 * Ранжирование заметок по косинусному сходству.
 *
 * Логика порогов (адаптирована под Granite R2, диапазон ~0.55–0.93):
 *
 *   >= threshold               → relevant («В тему»)
 *   >= threshold - serendipity → serendipity («Озарение»)
 *   <  threshold - serendipity → скрыто полностью
 *
 * Нижний порог = threshold − serendipity БЕЗ дополнительного клампа:
 * пользователь сам отвечает за свои настройки через ползунки
 * (жёсткий предел 0.40 был убран намеренно — экстремальные настройки
 * дают экстремальные результаты, это ожидаемое поведение).
 */
DI.register('Ranker', function (Vec, Config) {
  /**
   * Пакетное вычисление косинусного сходства.
   * @param {Float32Array|number[]} queryVector - Вектор запроса.
   * @param {Array<{id: string, vector: Array|Float32Array}>} items - Заметки с векторами.
   * @param {AbortSignal} [signal] - Сигнал отмены.
   * @returns {Promise<Array<{id: string, score: number}>>} Отсортировано по убыванию.
   */
  function cosineBatch(queryVector, items, signal) {
    if (!queryVector || !items || !items.length) {
      return Promise.resolve([]);
    }

    if (signal && signal.aborted) {
      return Promise.reject(new Error('aborted'));
    }

    const out = [];
    for (const it of items) {
      if (signal && signal.aborted) {
        return Promise.reject(new Error('aborted'));
      }
      out.push({ id: it.id, score: Vec.cosine(queryVector, it.vector) });
    }

    out.sort((a, b) => b.score - a.score);
    return Promise.resolve(out);
  }

  /**
   * Разделение результатов на relevant и serendipity.
   * Пороги берутся из Config (настраиваются пользователем).
   *
   * @param {Array<{id: string, score: number}>} scored - Результаты cosineBatch.
   * @returns {{relevant: Array, seren: Array}}
   */
  function split(scored) {
    const threshold = Config.get('threshold', 0.81);
    const serendipity = Config.get('serendipity', 0.07);

    // Нижний порог = threshold - serendipity (без ограничений).
    const lowerBound = threshold - serendipity;

    const relevant = [];
    const seren = [];

    for (const s of scored) {
      if (s.score < lowerBound) {
        continue;
      }

      if (s.score >= threshold) {
        relevant.push(s);
      } else {
        seren.push(s);
      }
    }

    return { relevant, seren };
  }

  /**
   * Проверка на дубликат: два вектора считаются одинаковыми,
   * если их сходство >= duplicateThreshold.
   * Используется для предотвращения повторных запросов в сеть.
   *
   * Для Granite R2 (диапазон ~0.55–0.93) порог 0.88 означает
   * «практически идентичные по смыслу».
   *
   * @param {Float32Array|number[]} a
   * @param {Float32Array|number[]} b
   * @returns {boolean}
   */
  function isSimilar(a, b) {
    return Vec.cosine(a, b) >= Config.get('duplicateThreshold', 0.88);
  }

  return { cosineBatch, split, isSimilar };
}, ['Vec', 'Config']);
// ─── AI/Ranker ─── END ──────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// СЛОЙ: NET — криптография, транспорт, протокол, сетевой сервис
// ═══════════════════════════════════════════════════════════════════════════════

// ─── NET/Crypto ─── START ───────────────────────────────────────────────────
/**
 * Криптография аккаунта (НОВЫЙ модуль).
 *
 * Две зоны ответственности:
 *
 * 1. NIP-44 v2 — шифрование «самому себе»: ECDH(sk, pk(sk)).
 *    conversationKey, который может вычислить только владелец sk, —
 *    на нём держится приватный канон (kind 30078).
 *
 * 2. Форматы ключа:
 *    - nsec / hex — ввод (вход с другого устройства);
 *    - npub — публичный адрес (безопасен для показа);
 *    - ncryptsec (NIP-49) — ключ, обёрнутый паролем (scrypt + ChaCha20).
 *
 * Все методы ждут Nostr.init() — загрузка nostr-tools асинхронная.
 * Методы форматов возвращают null при неудаче (UI показывает тост);
 * encryptSelf/decryptSelf бросают исключение (вызовы обёрнуты в try/catch
 * в Protocol).
 *
 * NIP-49 API-drift защита: nostr-tools в разных версиях возвращал из
 * decrypt() то Uint8Array, то {data}, то {secretKey} — поддержаны все
 * три формы.
 */
DI.register('Crypto', function (Nostr, Logger) {
  /**
   * Дождаться загрузки nostr-tools и вернуть её пространство имён.
   * @returns {Promise<Object>}
   * @throws {Error} Если библиотека не загрузилась.
   */
  async function lib() {
    await Nostr.init();
    const n = Nostr.lib();
    if (!n) throw new Error('nostr-tools not loaded');
    return n;
  }

  /**
   * Шифрование текста самому себе (NIP-44 v2).
   * @param {string} plaintext - Открытый текст.
   * @returns {Promise<string>} Шифртекст.
   * @throws {Error} Если NIP-44 недоступен или нет ключа.
   */
  async function encryptSelf(plaintext) {
    const n = await lib();
    const nip44 = n.nip44 && n.nip44.v2;
    if (!nip44 || !nip44.utils || typeof nip44.encrypt !== 'function') {
      throw new Error('NIP-44 unavailable');
    }

    const sk = Nostr.getSecretKey();
    const pk = Nostr.getPubkey();
    if (!sk || !pk) throw new Error('no secret key');

    const conversationKey = nip44.utils.getConversationKey(sk, pk);
    return nip44.encrypt(plaintext, conversationKey);
  }

  /**
   * Расшифровка своего шифртекста (NIP-44 v2).
   * @param {string} ciphertext - Шифртекст.
   * @returns {Promise<string>} Открытый текст.
   * @throws {Error} При неудаче расшифровки.
   */
  async function decryptSelf(ciphertext) {
    const n = await lib();
    const nip44 = n.nip44 && n.nip44.v2;
    if (!nip44 || !nip44.utils || typeof nip44.decrypt !== 'function') {
      throw new Error('NIP-44 unavailable');
    }

    const sk = Nostr.getSecretKey();
    const pk = Nostr.getPubkey();
    if (!sk || !pk) throw new Error('no secret key');

    const conversationKey = nip44.utils.getConversationKey(sk, pk);
    return nip44.decrypt(ciphertext, conversationKey);
  }

  /**
   * Классификация ввода ключа (синхронно, по префиксу).
   * @param {*} input - Строка от пользователя.
   * @returns {'nsec'|'ncryptsec'|'hex'|null} Тип или null.
   */
  function classifyKeyInput(input) {
    const t = String(input || '').trim();
    if (t.startsWith('ncryptsec1')) return 'ncryptsec';
    if (t.startsWith('nsec1')) return 'nsec';
    if (/^[0-9a-fA-F]{64}$/.test(t)) return 'hex';
    return null;
  }

  /**
   * Декодировать приватный ключ из nsec… или hex (без пароля).
   * @param {*} input - Строка от пользователя.
   * @returns {Promise<Uint8Array|null>} 32-байтный ключ или null.
   */
  async function decodeSecret(input) {
    const t = String(input || '').trim();
    if (!t) return null;

    // Raw hex
    if (/^[0-9a-fA-F]{64}$/.test(t)) {
      return new Uint8Array(t.match(/.{2}/g).map(b => parseInt(b, 16)));
    }

    // nsec (bech32) — валидация библиотекой
    try {
      const n = await lib();
      if (t.startsWith('nsec1') && n.nip19 && typeof n.nip19.decode === 'function') {
        const dec = n.nip19.decode(t);
        if (dec && dec.type === 'nsec' && dec.data instanceof Uint8Array && dec.data.length === 32) {
          return dec.data;
        }
      }
    } catch (_) {}

    return null;
  }

  /**
   * Обернуть ключ паролем → ncryptsec (NIP-49).
   * scrypt с logn=16 (~1–2 сек на мобильном) — осознанная цена
   * для экспорта ключа.
   * @param {Uint8Array} sk - Приватный ключ.
   * @param {string} password - Пароль.
   * @returns {Promise<string|null>} Строка ncryptsec1… или null.
   */
  async function encryptKey(sk, password) {
    try {
      const n = await lib();
      if (!n.nip49 || typeof n.nip49.encrypt !== 'function') return null;
      return n.nip49.encrypt(sk, String(password || ''));
    } catch (e) {
      Logger.warn('Crypto: encryptKey', String(e && e.message || e));
      return null;
    }
  }

  /**
   * Снять ncryptsec → приватный ключ (NIP-49).
   * @param {string} ncryptsec - Строка ncryptsec1….
   * @param {string} password - Пароль.
   * @returns {Promise<Uint8Array|null>} 32-байтный ключ или null
   *   (неверный пароль → null, не исключение).
   */
  async function decryptKey(ncryptsec, password) {
    try {
      const n = await lib();
      if (!n.nip49 || typeof n.nip49.decrypt !== 'function') return null;

      const res = n.nip49.decrypt(String(ncryptsec || '').trim(), String(password || ''));

      // API-drift защита: три исторические формы возврата
      if (res instanceof Uint8Array) return res.length === 32 ? res : null;
      if (res && res.secretKey instanceof Uint8Array && res.secretKey.length === 32) return res.secretKey;
      if (res && res.data instanceof Uint8Array && res.data.length === 32) return res.data;

      return null;
    } catch (_) {
      // Неверный пароль или битая строка — тихий null
      return null;
    }
  }

  /**
   * Кодировать ключ в nsec… (bech32).
   * @param {Uint8Array} sk - Приватный ключ.
   * @returns {Promise<string|null>}
   */
  async function encodeNsec(sk) {
    try {
      const n = await lib();
      return n.nip19 ? n.nip19.nsecEncode(sk) : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Кодировать публичный ключ в npub… (bech32).
   * @param {string} pk - Публичный ключ (hex).
   * @returns {Promise<string|null>}
   */
  async function encodeNpub(pk) {
    try {
      const n = await lib();
      return n.nip19 ? n.nip19.npubEncode(pk) : null;
    } catch (_) {
      return null;
    }
  }

  return {
    encryptSelf,
    decryptSelf,
    classifyKeyInput,
    decodeSecret,
    encryptKey,
    decryptKey,
    encodeNsec,
    encodeNpub,
  };
}, ['Nostr', 'Logger']);
// ─── NET/Crypto ─── END ─────────────────────────────────────────────────────

// ─── NET/Nostr ─── START ────────────────────────────────────────────────────
/**
 * Транспортный слой Nostr.
 * Управляет ключами, пулом рэлеев, публикацией и подписками.
 * Не содержит бизнес-логики — только отправка/приём.
 *
 * Отличие от v0.6: три новых метода для аккаунта и криптографии —
 * lib() (доступ к загруженной nostr-tools для NET/Crypto),
 * getSecretKey() и setKey() (замена ключа при входе с другого устройства).
 */
DI.register('Nostr', function (Config, bus, Logger) {
  const CDN = 'https://cdn.jsdelivr.net/npm/nostr-tools@2.7.2/+esm';
  const SK_KEY = 'noomium:sk';

  /** @type {Object|null} Загруженное пространство имён nostr-tools. */
  let nostr = null;
  /** @type {Object|null} Пул рэлеев. */
  let pool = null;
  /** @type {Uint8Array|null} Приватный ключ. */
  let sk = null;
  /** @type {string|null} Публичный ключ (hex). */
  let pk = null;
  /** @type {Promise|null} */
  let initPromise = null;

  /**
   * Загрузить ключ из localStorage.
   * @returns {Uint8Array|null}
   */
  function loadKey() {
    try {
      const hex = localStorage.getItem(SK_KEY);
      if (hex && /^[0-9a-f]{64}$/i.test(hex)) {
        return new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
      }
    } catch (_) {}
    return null;
  }

  /**
   * Сохранить ключ в localStorage (hex).
   * @param {Uint8Array} key
   */
  function saveKey(key) {
    try {
      localStorage.setItem(
        SK_KEY,
        Array.from(key).map(b => b.toString(16).padStart(2, '0')).join('')
      );
    } catch (_) {}
  }

  /**
   * Инициализация: загрузка nostr-tools с CDN, восстановление/генерация
   * ключа, создание пула. Идемпотентна.
   * @returns {Promise<string>} Публичный ключ.
   */
  function init() {
    if (initPromise) return initPromise;

    initPromise = import(CDN).then(mod => {
      nostr = (typeof mod.generateSecretKey === 'function')
        ? mod
        : (mod.default && typeof mod.default.generateSecretKey === 'function' ? mod.default : mod);

      if (typeof nostr.generateSecretKey !== 'function') {
        throw new Error('nostr-tools: несовместимый модуль');
      }

      sk = loadKey();
      if (!sk) {
        sk = nostr.generateSecretKey();
        saveKey(sk);
      }

      pk = nostr.getPublicKey(sk);
      pool = new nostr.SimplePool();

      Logger.info('Nostr: готов, pubkey ' + pk.slice(0, 8) + '…');
      return pk;
    }).catch(err => {
      initPromise = null;
      Logger.error('Nostr: не загрузить nostr-tools', String(err && err.message || err));
      try { bus.emit('net:status', { status: 'failed' }); } catch (_) {}
      throw err;
    });

    return initPromise;
  }

  /**
   * Доступ к загруженному пространству имён nostr-tools.
   * Используется NET/Crypto (nip19/nip44/nip49) — не для транспорта.
   * @returns {Object|null}
   */
  function lib() {
    return nostr;
  }

  /**
   * Текущий приватный ключ (для экспорта/шифрования).
   * @returns {Uint8Array|null}
   */
  function getSecretKey() {
    return sk;
  }

  /**
   * Заменить ключ (вход с другого устройства). Пересчитывает pubkey,
   * сохраняет новый ключ. Пул рэлеев не зависит от ключа и не пересоздаётся.
   * Вызывать только после init().
   * @param {Uint8Array} newSk - Новый приватный ключ (32 байта).
   * @returns {string} Новый публичный ключ.
   * @throws {Error} Если ключ невалиден или библиотека не загружена.
   */
  function setKey(newSk) {
    if (!nostr) throw new Error('Nostr not ready');
    if (!(newSk instanceof Uint8Array) || newSk.length !== 32) {
      throw new Error('invalid secret key');
    }

    sk = newSk;
    pk = nostr.getPublicKey(sk);
    saveKey(sk);
    Logger.info('Nostr: ключ заменён, pubkey ' + pk.slice(0, 8) + '…');
    return pk;
  }

  /**
   * Подписать шаблон события текущим ключом.
   * @param {Object} template - Шаблон события.
   * @returns {Object} Подписанное событие.
   */
  function sign(template) {
    if (!nostr || !sk) throw new Error('Nostr not ready');
    return nostr.finalizeEvent(template, sk);
  }

  /**
   * Публикация события на все настроенные рэлеи.
   * Резолвится при успехе хотя бы на одном рэлее, таймаут 30 секунд.
   * @param {Object} template - Шаблон события.
   * @returns {Promise<Object>} Подписанное опубликованное событие.
   */
  function publish(template) {
    let ev;
    try {
      ev = sign(template);
    } catch (e) {
      return Promise.reject(e);
    }

    if (!pool) return Promise.reject(new Error('Nostr not ready'));

    const urls = relays();
    if (!urls.length) return Promise.reject(new Error('no relays configured'));

    const PUBLISH_TIMEOUT = 30000;

    const publishPromise = new Promise((resolve, reject) => {
      let settled = false;
      let failures = 0;

      urls.forEach(url => {
        pool.ensureRelay(url)
          .then(relay => relay.publish(ev))
          .then(() => {
            if (!settled) {
              settled = true;
              resolve(ev);
            }
          })
          .catch(err => {
            failures++;
            Logger.warn('Nostr: релей ' + url + ' не принял', String(err && err.message || err));

            if (!settled && failures === urls.length) {
              settled = true;
              reject(new Error('no relay accepted'));
            }
          });
      });
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('publish timeout')), PUBLISH_TIMEOUT);
    });

    return Promise.race([publishPromise, timeoutPromise]);
  }

  /**
   * Подписка на события через пул.
   * @param {Array<Object>} filters - Фильтры Nostr.
   * @param {Object} handlers - {onevent, onclose}.
   * @returns {Object|null} Объект подписки с методом close().
   */
  function subscribe(filters, handlers) {
    if (!pool) return null;
    return pool.subscribeMany(relays(), filters, handlers);
  }

  /**
   * Список настроенных рэлеев.
   * @returns {Array<string>}
   */
  function relays() {
    return Config.get('relays', []);
  }

  /**
   * Текущий публичный ключ.
   * @returns {string|null}
   */
  function getPubkey() {
    return pk;
  }

  /**
   * Готовность к работе.
   * @returns {boolean}
   */
  function isReady() {
    return !!(nostr && sk && pool);
  }

  /** Закрыть соединения пула. */
  function close() {
    if (pool && typeof pool.close === 'function') {
      try { pool.close(relays()); } catch (_) {}
    }
  }

  return {
    init,
    sign,
    publish,
    subscribe,
    ensureRelay(url) {
      if (!pool) return Promise.reject(new Error('Nostr not ready'));
      return pool.ensureRelay(url);
    },
    getPubkey,
    getSecretKey,
    setKey,
    lib,
    isReady,
    relays,
    close,
  };
}, ['Config', 'EventBus', 'Logger']);
// ─── NET/Nostr ─── END ──────────────────────────────────────────────────────

// ─── NET/Protocol ─── START ─────────────────────────────────────────────────
/**
 * Сериализация/десериализация Nostr-событий NOOmium.
 *
 * Виды событий:
 * - kind 1:     Публичная проекция заметки (текст + вектор + parent + uid)
 * - kind 30078: Приватный канон (NIP-78, replaceable, d-tag = uid,
 *               content = NIP-44-шифрованный JSON). Источник истины для
 *               синхронизации между устройствами.
 * - kind 21000: Запрос (вектор + параметры)
 * - kind 21001: Ответ (заметка + скор)
 * - kind 5:     Удаление публичных проекций (список event ID)
 *
 * Формат payload kind 30078 (до шифрования):
 *   { v: 1, text, vec: base64|null, parent: uid|null, shared: bool,
 *     ev: eventId|null, ts: ms }
 * Tombstone (удаление через replaceable-семантику):
 *   { v: 1, del: true, ts: ms }
 *
 * КРИТИЧНО: created_at для 30078 строго монотонен (счётчик ниже) —
 * иначе релей не заменит предыдущую версию.
 *
 * Безопасность:
 * - Все входящие тексты ограничены по длине (защита от переполнения)
 * - Все входящие векторы валидируются (конечность, числовой тип)
 */
DI.register('Protocol', function (Config, Vec, Crypto) {
  /** Максимальная длина шифртекста 30078 (с запасом на NIP-44 оверхед). */
  const MAX_PRIVATE_CONTENT = 65536;

  /** Монотонный счётчик created_at для replaceable-событий. */
  let lastPrivateTs = 0;

  /**
   * Следующий строго возрастающий timestamp (секунды).
   * Два апдейта в одну секунду не коллизируют.
   * @returns {number}
   */
  function nextPrivateTs() {
    let t = Math.floor(Date.now() / 1000);
    if (t <= lastPrivateTs) t = lastPrivateTs + 1;
    lastPrivateTs = t;
    return t;
  }

  /**
   * Найти тег по имени.
   * @param {Array} tags - Теги события.
   * @param {string} name - Имя тега.
   * @returns {Array|null}
   */
  function findTag(tags, name) {
    if (!Array.isArray(tags)) return null;
    for (const t of tags) {
      if (Array.isArray(t) && t[0] === name) return t;
    }
    return null;
  }

  // ─── Публичная проекция (kind 1) ──────────────────────────────────────────

  /**
   * Событие публичной проекции заметки.
   * @param {Object} note - Заметка (id = uid).
   * @param {string} room - Имя комнаты (тег t).
   * @param {string} [parentRef] - Ссылка на родителя для тега parent.
   *   По умолчанию note.parentId. NetService передаёт eventId родителя,
   *   если родитель опубликован (иначе сеть увидит неразрешимый uid).
   * @param {string} [parentPubkey] - Публичный ключ автора родителя
   *   (для чужих родителей). По умолчанию note.parentPubkey.
   * @returns {Object} Шаблон события (без подписи).
   */
  function noteEvent(note, room, parentRef, parentPubkey) {
    const tags = [['t', room], ['uid', note.id]];
    if (note.vector) tags.push(['v', Vec.toB64(note.vector)]);
    if (note.parentId) {
      tags.push(['parent', parentRef || note.parentId, parentPubkey !== undefined ? parentPubkey : (note.parentPubkey || '')]);
    }

    return {
      kind: Config.get('kNote', 1),
      created_at: Math.floor((note.createdAt || Date.now()) / 1000),
      tags,
      content: note.text || '',
    };
  }

  /**
   * Декодирование чужой публичной заметки (kind 1).
   * @param {Object} ev - Nostr-событие.
   * @returns {Object|null} Заметка-кандидат для сетевого кэша.
   */
  function decodeNote(ev) {
    if (!ev || ev.kind !== Config.get('kNote', 1)) return null;

    const maxLen = Config.get('maxNoteTextLength', 10000);
    if (typeof ev.content === 'string' && ev.content.length > maxLen) return null;

    const vTag = findTag(ev.tags, 'v');
    const pTag = findTag(ev.tags, 'parent');

    return {
      id: ev.id,
      text: ev.content || '',
      vector: vTag ? Vec.fromB64(vTag[1]) : null,
      shared: true,
      authorPubkey: ev.pubkey,
      parentId: pTag ? pTag[1] : null,
      parentPubkey: pTag ? (pTag[2] || null) : null,
      createdAt: (ev.created_at || 0) * 1000,
    };
  }

  // ─── Приватный канон (kind 30078, NIP-78) ────────────────────────────────

  /**
   * Событие приватного канона заметки. Полная версия (upsert).
   * @param {Object} note - Локальная заметка (id = uid).
   * @returns {Promise<Object>} Шаблон события с зашифрованным content.
   * @throws {Error} При недоступности NIP-44.
   */
  async function privateEvent(note) {
    const payload = {
      v: 1,
      text: note.text || '',
      vec: note.vector ? Vec.toB64(note.vector) : null,
      parent: note.parentId || null,
      shared: note.shared === true,
      ev: note.eventId || null,
      ts: Number(note.updatedAt || note.createdAt) || Date.now(),
    };

    const content = await Crypto.encryptSelf(JSON.stringify(payload));

    return {
      kind: Config.get('kPrivate', 30078),
      created_at: nextPrivateTs(),
      tags: [['d', note.id], ['client', 'noomium']],
      content,
    };
  }

  /**
   * Tombstone приватного канона: «заметка удалена».
   * Заменяет собой последнюю версию 30078 на релеях — все устройства
   * при синхронизации удалят локальную копию.
   * @param {string} uid - Идентификатор заметки.
   * @returns {Promise<Object>} Шаблон события.
   * @throws {Error} При недоступности NIP-44.
   */
  async function privateTombstone(uid) {
    const content = await Crypto.encryptSelf(JSON.stringify({ v: 1, del: true, ts: Date.now() }));

    return {
      kind: Config.get('kPrivate', 30078),
      created_at: nextPrivateTs(),
      tags: [['d', uid], ['client', 'noomium']],
      content,
    };
  }

  /**
   * Декодирование приватного канона (kind 30078): расшифровка + парсинг.
   * Чужие события не расшифруются (NIP-44 keys не совпадут) → null.
   *
   * @param {Object} ev - Nostr-событие kind 30078.
   * @returns {Promise<Object|null>}
   *   При полной версии: объект заметки для DB.put (id = uid, authorPubkey
   *   = null — заметка своя, own-семантика сохранена) + syncTs для LWW.
   *   При tombstone: {id, deleted: true, syncTs}.
   *   null — событие невалидно или не наше.
   */
  async function decodePrivate(ev) {
    if (!ev || ev.kind !== Config.get('kPrivate', 30078)) return null;

    const dTag = findTag(ev.tags, 'd');
    if (!dTag || typeof dTag[1] !== 'string' || !dTag[1]) return null;

    if (typeof ev.content !== 'string' || !ev.content) return null;
    if (ev.content.length > MAX_PRIVATE_CONTENT) return null;

    let plaintext;
    try {
      plaintext = await Crypto.decryptSelf(ev.content);
    } catch (_) {
      return null;
    }

    let data;
    try {
      data = JSON.parse(plaintext);
    } catch (_) {
      return null;
    }
    if (!data || typeof data !== 'object') return null;

    const syncTs = (ev.created_at || 0) * 1000;

    // Tombstone — удаление
    if (data.del === true) {
      return { id: dTag[1], deleted: true, syncTs };
    }

    // Полная версия — валидация полей
    if (typeof data.text !== 'string') return null;
    if (data.text.length > Config.get('maxNoteTextLength', 10000)) return null;

    let vector = null;
    if (typeof data.vec === 'string') {
      const v = Vec.fromB64(data.vec);
      if (v) vector = Array.from(v);
    }

    const ts = typeof data.ts === 'number' && data.ts > 0 ? data.ts : syncTs;

    return {
      id: dTag[1],
      text: data.text,
      vector,
      shared: data.shared === true,
      parentId: (typeof data.parent === 'string' && data.parent) ? data.parent : null,
      parentPubkey: null,
      authorPubkey: null,
      eventId: (typeof data.ev === 'string' && data.ev) ? data.ev : null,
      createdAt: ts,
      updatedAt: ts,
      syncTs,
    };
  }

  // ─── Запрос / ответ / удаление ────────────────────────────────────────────

  /**
   * Событие запроса (kind 21000).
   * @param {Float32Array|Array<number>} vector - Вектор запроса.
   * @param {number} maxResponses - Максимум ответов.
   * @param {number} window - Окно ответа (мс).
   * @returns {Object} Шаблон события.
   */
  function queryEvent(vector, maxResponses, window) {
    return {
      kind: Config.get('kQuery', 21000),
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', Config.get('room', 'noomium-main')]],
      content: JSON.stringify({ vector: Array.from(vector), maxResponses, window }),
    };
  }

  /**
   * Декодирование запроса (kind 21000).
   * @param {Object} ev - Nostr-событие.
   * @returns {Object|null}
   */
  function decodeQuery(ev) {
    if (!ev || ev.kind !== Config.get('kQuery', 21000)) return null;

    let data;
    try {
      data = JSON.parse(ev.content);
    } catch (_) {
      return null;
    }

    if (!data || !Array.isArray(data.vector) || !data.vector.length) return null;

    for (const x of data.vector) {
      if (typeof x !== 'number' || !isFinite(x)) return null;
    }

    return {
      vector: data.vector,
      maxResponses: typeof data.maxResponses === 'number' ? data.maxResponses : Config.get('maxResponses', 8),
      window: typeof data.window === 'number' ? data.window : Config.get('responseWindow', 6000),
      authorPubkey: ev.pubkey,
      queryId: ev.id,
    };
  }

  /**
   * Событие ответа (kind 21001).
   * @param {Object} note - Локальная заметка.
   * @param {number} score - Скор сходства.
   * @param {string} queryId - ID запроса.
   * @param {string} room - Имя комнаты.
   * @returns {Object} Шаблон события.
   */
  function answerEvent(note, score, queryId, room) {
    return {
      kind: Config.get('kAnswer', 21001),
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', room], ['e', queryId]],
      content: JSON.stringify({
        noteId: note.id,
        text: note.text,
        vector: note.vector ? Array.from(note.vector) : null,
        score,
      }),
    };
  }

  /**
   * Декодирование ответа (kind 21001).
   * @param {Object} ev - Nostr-событие.
   * @returns {Object|null}
   */
  function decodeAnswer(ev) {
    if (!ev || ev.kind !== Config.get('kAnswer', 21001)) return null;

    const eTag = findTag(ev.tags, 'e');
    if (!eTag) return null;

    let data;
    try {
      data = JSON.parse(ev.content);
    } catch (_) {
      return null;
    }

    if (!data || typeof data.text !== 'string') return null;
    if (data.text.length > Config.get('maxAnswerTextLength', 10000)) return null;

    let vector = null;
    if (Array.isArray(data.vector)) {
      for (const x of data.vector) {
        if (typeof x !== 'number' || !isFinite(x)) return null;
      }
      vector = data.vector;
    }

    return {
      id: ev.id,
      queryId: eTag[1],
      noteId: data.noteId || ev.id,
      text: data.text,
      vector,
      score: typeof data.score === 'number' ? data.score : 0,
      authorPubkey: ev.pubkey,
      createdAt: (ev.created_at || 0) * 1000,
    };
  }

  /**
   * Событие удаления публичных проекций (kind 5).
   * @param {string|Array<string>} eventIds - ID удаляемых событий.
   * @param {string} [room] - Имя комнаты (тег t).
   * @returns {Object|null} Шаблон события или null при пустом списке.
   */
  function deleteEvent(eventIds, room) {
    const ids = Array.isArray(eventIds) ? eventIds : [eventIds];
    const tags = ids.filter(Boolean).map(id => ['e', id]);

    if (!tags.length) return null;
    if (room) tags.push(['t', room]);

    return {
      kind: Config.get('kDelete', 5),
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: '',
    };
  }

  /**
   * Декодирование события удаления (kind 5).
   * @param {Object} ev - Nostr-событие.
   * @returns {Object|null} {eventIds, authorPubkey}.
   */
  function decodeDelete(ev) {
    if (!ev || ev.kind !== Config.get('kDelete', 5)) return null;

    const eTags = (ev.tags || []).filter(t => Array.isArray(t) && t[0] === 'e' && t[1]);
    if (!eTags.length) return null;

    return {
      eventIds: eTags.map(t => t[1]),
      authorPubkey: ev.pubkey,
    };
  }

  return {
    noteEvent,
    decodeNote,
    privateEvent,
    privateTombstone,
    decodePrivate,
    queryEvent,
    decodeQuery,
    answerEvent,
    decodeAnswer,
    deleteEvent,
    decodeDelete,
  };
}, ['Config', 'Vec', 'Crypto']);
// ─── NET/Protocol ─── END ───────────────────────────────────────────────────

// ─── NET/NetService ─── START ───────────────────────────────────────────────
/**
 * Оркестрация Nostr-сети: подписки, публикация, обработка входящих событий.
 *
 * Три канала:
 * 1. Комнатная подписка (kind 1/21000/21001/5 по тегу t) — как в v0.6.
 * 2. Подписка на себя (kind 30078, authors = свой pk) — живой синк между
 *    устройствами. NIP-01: для replaceable-событий релей отдаёт только
 *    последнюю версию каждого d-тега → restore = один дешёвый REQ.
 * 3. Исходящая публикация: приватный канон (30078) на каждое изменение
 *    заметки + публичная проекция (kind 1) для shared.
 *
 * LWW-модель канона:
 * - note.syncTs ставится при локальной правке (Notes, волна 7) и при
 *   применении входящего события;
 * - входящий 30078 применяется только при syncTs > локального
 *   (равенство = эхо собственной публикации → пропуск);
 * - удаление канона — tombstone (30078 с del:true), НЕ kind 5:
 *   replaceable-семантика гарантирует доставку всем устройствам.
 *
 * Удалено из v0.6: migrateChildrenParentId (uid стабилен, миграция
 * идентификаторов больше не нужна).
 *
 * Outbox (localStorage «noomium:outbox») — четыре очереди:
 * - priv:     uid'ы заметок, ждущих публикации канона (30078);
 * - announce: uid'ы заметок, ждущих публичной проекции (kind 1);
 * - del:      eventId'ы для kind 5 (удаление проекций);
 * - privdel:  uid'ы для tombstone канона.
 */
DI.register('NetService', function (Nostr, Protocol, DB, Ranker, Vec, Store, Config, Logger, bus) {
  let started = false;
  let startPromise = null;
  let subscription = null;
  let selfSubscription = null;
  let hbTimer = null;
  let activeQueryId = null;
  let lastQueryVec = null;
  let lastQueryTime = 0;
  let centroids = [];
  let contextUnsub = null;
  let hasReceivedEvent = false;
  let flushing = false;
  let flushTimer = null;
  let startRetryTimer = null;
  let onlineListenerAdded = false;
  let reconnectAttempts = 0;
  let busUnsubs = [];

  /** @type {Set<string>} seen для комнатной подписки. */
  const seen = new Set();
  /** @type {Set<string>} seen для подписки на себя (оптимизация расшифровки). */
  const selfSeen = new Set();
  /** @type {Map<string, boolean>} дедупликация контента pubkey::text. */
  const contentSeen = new Map();
  /** @type {Map<string, number>} активные пиры (последний контакт). */
  const peers = new Map();
  /** @type {Map<string, number>} время последнего запроса от пира. */
  const peerQueryTimes = new Map();
  /** @type {Map<string, {tokens:number, ts:number}>} token bucket'ы пиров. */
  const peerNoteBudgets = new Map();

  let currentWindow = Config.get('subWindow', 300);
  let historyLoading = false;
  let subEpoch = 0;

  const OUTBOX_KEY = 'noomium:outbox';

  /**
   * Загрузка outbox из localStorage (четыре очереди, устойчиво к старому
   * формату v0.6 без priv/privdel).
   * @returns {{announce: string[], del: string[], priv: string[], privdel: string[]}}
   */
  function loadOutbox() {
    try {
      const raw = localStorage.getItem(OUTBOX_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        return {
          announce: Array.isArray(o.announce) ? o.announce.filter(Boolean) : [],
          del: Array.isArray(o.del) ? o.del.filter(Boolean) : [],
          priv: Array.isArray(o.priv) ? o.priv.filter(Boolean) : [],
          privdel: Array.isArray(o.privdel) ? o.privdel.filter(Boolean) : [],
        };
      }
    } catch (_) {}

    return { announce: [], del: [], priv: [], privdel: [] };
  }

  /** Сохранить outbox в localStorage. */
  function saveOutbox() {
    try {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
    } catch (_) {}
  }

  let outbox = loadOutbox();

  const kNote = () => Config.get('kNote', 1);
  const kPrivate = () => Config.get('kPrivate', 30078);
  const kQuery = () => Config.get('kQuery', 21000);
  const kAnswer = () => Config.get('kAnswer', 21001);
  const kDelete = () => Config.get('kDelete', 5);
  const room = () => Config.get('room', 'noomium-main');

  function setStatus(s) {
    try { bus.emit('net:status', { status: s }); } catch (_) {}
  }

  function emitSync(phase) {
    try { bus.emit('sync:status', { phase }); } catch (_) {}
  }

  function notifyPeers() {
    try { bus.emit('net:peers', { count: peers.size }); } catch (_) {}
  }

  /**
   * @param {boolean} loading
   * @param {number} [windowSec]
   */
  function emitHistory(loading, windowSec) {
    try { bus.emit('net:history', { loading: loading, window: windowSec }); } catch (_) {}
  }

  /** @returns {boolean} Браузер считает себя офлайн. */
  function isOffline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }

  /** @returns {boolean} Можно ли публиковать. */
  function canPublish() {
    return Nostr.isReady() && !isOffline();
  }

  // ─── Outbox: очереди ──────────────────────────────────────────────────────

  /** @param {string} id */
  function queueAnnounce(id) {
    if (!id) return;
    if (outbox.announce.indexOf(id) === -1) {
      outbox.announce.push(id);
      saveOutbox();
    }
    scheduleFlush();
  }

  /** @param {string} id */
  function unqueueAnnounce(id) {
    if (!id) return;
    const i = outbox.announce.indexOf(id);
    if (i > -1) {
      outbox.announce.splice(i, 1);
      saveOutbox();
    }
  }

  /** @param {string} id */
  function queuePrivate(id) {
    if (!id) return;
    if (outbox.priv.indexOf(id) === -1) {
      outbox.priv.push(id);
      saveOutbox();
    }
    scheduleFlush();
  }

  /** @param {string} id */
  function unqueuePrivate(id) {
    if (!id) return;
    const i = outbox.priv.indexOf(id);
    if (i > -1) {
      outbox.priv.splice(i, 1);
      saveOutbox();
    }
  }

  /** @param {string} id */
  function queuePrivDel(id) {
    if (!id) return;
    if (outbox.privdel.indexOf(id) === -1) {
      outbox.privdel.push(id);
      saveOutbox();
    }
    scheduleFlush();
  }

  /** @param {string} id */
  function unqueuePrivDel(id) {
    if (!id) return;
    const i = outbox.privdel.indexOf(id);
    if (i > -1) {
      outbox.privdel.splice(i, 1);
      saveOutbox();
    }
  }

  /** @param {string} id */
  function queueDelete(id) {
    if (!id) return;
    if (outbox.del.indexOf(id) === -1) {
      outbox.del.push(id);
      saveOutbox();
    }
    scheduleFlush();
  }

  /** @param {string} id */
  function unqueueDelete(id) {
    if (!id) return;
    const i = outbox.del.indexOf(id);
    if (i > -1) {
      outbox.del.splice(i, 1);
      saveOutbox();
    }
  }

  /**
   * Отложить сброс outbox.
   * @param {number} [delay]
   */
  function scheduleFlush(delay) {
    if (flushTimer) return;

    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushOutbox();
    }, delay || 5000);
  }

  /**
   * Сброс накопившихся офлайн-операций: priv → announce → del → privdel.
   * Фазы независимы; сбой одной задачи не блокирует остальные.
   * @returns {Promise<void>}
   */
  async function flushOutbox() {
    if (flushing) return;
    if (!canPublish()) return;
    if (!outbox.announce.length && !outbox.del.length && !outbox.priv.length && !outbox.privdel.length) return;

    flushing = true;

    try {
      // Фаза 1: приватный канон — последовательно, мягко к релеям.
      for (const uid of outbox.priv.slice()) {
        const note = await DB.get(uid).catch(() => null);
        if (!note) {
          unqueuePrivate(uid);
          continue;
        }
        try {
          const tpl = await Protocol.privateEvent(note);
          await Nostr.publish(tpl);
          unqueuePrivate(uid);
          if (!note.syncTs) {
            note.syncTs = Date.now();
            DB.put(note).catch(() => {});
          }
        } catch (_) {
          // Остаётся в очереди для повторной попытки.
        }
      }

      // Фаза 2: публичные проекции — параллельно, allSettled.
      const announceIds = outbox.announce.slice();
      const tasks = announceIds.map(async noteId => {
        const note = await DB.get(noteId).catch(() => null);
        if (!note || !note.shared || !note.vector || note.eventId) {
          unqueueAnnounce(noteId);
          return;
        }
        try {
          const tpl = await buildNoteEvent(note);
          const ev = await Nostr.publish(tpl);
          unqueueAnnounce(noteId);

          if (ev && ev.id && note.id) {
            const cur = await DB.get(note.id).catch(() => null);
            if (cur && cur.eventId !== ev.id) {
              cur.eventId = ev.id;
              await DB.put(cur).catch(() => {});
              // eventId должен доехать в канон на другие устройства
              publishPrivate(cur);
            }
          }
        } catch (_) {
          // Остаётся в очереди.
        }
      });
      await Promise.allSettled(tasks);

      // Фаза 3: kind 5 — пачкой одним событием.
      if (outbox.del.length) {
        const ev = Protocol.deleteEvent(outbox.del.slice(), room());
        if (ev) {
          try {
            await Nostr.publish(ev);
            outbox.del = [];
            saveOutbox();
          } catch (_) {
            // Остаётся в очереди.
          }
        }
      }

      // Фаза 4: tombstone канона — последовательно.
      for (const uid of outbox.privdel.slice()) {
        try {
          const tpl = await Protocol.privateTombstone(uid);
          await Nostr.publish(tpl);
          unqueuePrivDel(uid);
        } catch (_) {
          // Остаётся в очереди.
        }
      }
    } catch (_) {} finally {
      flushing = false;

      if (outbox.announce.length || outbox.del.length || outbox.priv.length || outbox.privdel.length) {
        scheduleFlush(10000);
      }
    }
  }

  /**
   * Ищем локальные опубликованные заметки без eventId → очередь анонса.
   * (Ремонт заметок, созданных офлайн или переживших перезагрузку.)
   * @returns {Promise<void>}
   */
  async function scanLocalUnpublished() {
    try {
      const notes = await DB.all();
      notes.forEach(n => {
        if (n && n.shared && n.vector && !n.eventId) {
          queueAnnounce(n.id);
        }
      });
      flushOutbox();
    } catch (_) {}
  }

  // ─── Приватный канон: публикация ──────────────────────────────────────────

  /**
   * Опубликовать канон заметки (kind 30078). Очередь при офлайне/сбое.
   * @param {Object} note - Локальная заметка.
   * @returns {Promise<void>}
   */
  async function publishPrivate(note) {
    if (!Config.get('syncEnabled', true)) return;
    if (!note || !note.id) return;

    if (!canPublish()) {
      queuePrivate(note.id);
      return;
    }

    try {
      const tpl = await Protocol.privateEvent(note);
      await Nostr.publish(tpl);
      unqueuePrivate(note.id);
      if (!note.syncTs) {
        note.syncTs = Date.now();
        DB.put(note).catch(() => {});
      }
    } catch (e) {
      Logger.warn('NetService: канон в очередь', String(e && e.message || e));
      queuePrivate(note.id);
    }
  }

  /**
   * Опубликовать tombstone канона (удаление заметки из синка).
   * @param {string} uid - Идентификатор заметки.
   * @returns {Promise<void>}
   */
  async function tombstoneNote(uid) {
    if (!Config.get('syncEnabled', true)) return;
    if (!uid) return;

    if (!canPublish()) {
      queuePrivDel(uid);
      return;
    }

    try {
      const tpl = await Protocol.privateTombstone(uid);
      await Nostr.publish(tpl);
      unqueuePrivDel(uid);
    } catch (e) {
      Logger.warn('NetService: tombstone в очередь', String(e && e.message || e));
      queuePrivDel(uid);
    }
  }

  /**
   * Резолв ссылки на родителя для публичной проекции: если родитель
   * опубликован — его eventId (резолвимо сетью); иначе Protocol использует
   * uid (orphan для чужих, но связь сохранена в приватном каноне —
   * та же семантика, что в v0.6 для неопубликованных родителей).
   * @param {Object} note - Заметка.
   * @returns {Promise<{tpl: Object}|null>} Шаблон kind 1.
   */
  async function buildNoteEvent(note) {
    let parentRef;
    let parentPubkey;

    if (note.parentId) {
      const parent = await DB.get(note.parentId).catch(() => null);
      if (parent && parent.eventId) {
        parentRef = parent.eventId;
        parentPubkey = note.parentPubkey || '';
      }
    }

    return Protocol.noteEvent(note, room(), parentRef, parentPubkey);
  }

  /**
   * Одноразовый backsweep: публикация канона для всех локальных заметок
   * (миграция v0.6 → v0.7). Флаг ставится после enqueue — недоставшее
   * доедет через outbox.
   * @returns {Promise<void>}
   */
  async function runBacksweep() {
    if (!Config.get('syncEnabled', true)) {
      emitSync('off');
      return;
    }
    if (Config.get('syncMigrated', false)) {
      emitSync('idle');
      return;
    }

    emitSync('active');

    try {
      const notes = await DB.all();
      let queued = 0;

      for (const n of notes) {
        if (n && n.id) {
          if (canPublish()) {
            await publishPrivate(n);
          } else {
            queuePrivate(n.id);
          }
          queued++;
        }
      }

      Config.set('syncMigrated', true);
      Logger.info('NetService: backsweep — ' + queued + ' заметок в канон');
    } catch (e) {
      Logger.warn('NetService: backsweep ошибка', String(e && e.message || e));
    }

    emitSync('idle');
    flushOutbox();
  }

  // ─── Приватный канон: приём ───────────────────────────────────────────────

  /**
   * Применить входящий канон (от своего ключа с другого устройства).
   * LWW: применяется только при отсутствии локальной версии или при
   * строго большем syncTs (равенство = эхо своей публикации).
   * @param {Object} d - Результат Protocol.decodePrivate.
   * @returns {Promise<void>}
   */
  async function applyIncomingPrivate(d) {
    if (!d || !d.id) return;

    try {
      const cur = await DB.get(d.id);

      // Tombstone — удаление
      if (d.deleted) {
        if (!cur) return;
        if (!cur.syncTs || d.syncTs > cur.syncTs) {
          await DB.del(d.id);
          try { bus.emit('sync:applied', { uid: d.id, deleted: true }); } catch (_) {}
        }
        return;
      }

      // Полная версия
      if (!cur) {
        await DB.put({
          id: d.id,
          text: d.text,
          vector: d.vector,
          shared: d.shared,
          parentId: d.parentId,
          parentPubkey: d.parentPubkey,
          authorPubkey: null,
          eventId: d.eventId,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          syncTs: d.syncTs,
        });
        try { bus.emit('sync:applied', { uid: d.id }); } catch (_) {}
        return;
      }

      if (!cur.syncTs || d.syncTs > cur.syncTs) {
        await DB.put({
          id: d.id,
          text: d.text,
          vector: d.vector,
          shared: d.shared,
          parentId: d.parentId,
          parentPubkey: d.parentPubkey,
          authorPubkey: null,
          eventId: d.eventId,
          createdAt: cur.createdAt || d.createdAt,
          updatedAt: d.updatedAt,
          syncTs: d.syncTs,
        });
        try { bus.emit('sync:applied', { uid: d.id }); } catch (_) {}
      }
    } catch (e) {
      Logger.warn('NetService: applyIncomingPrivate', String(e && e.message || e));
    }
  }

  // ─── Подписка на себя ─────────────────────────────────────────────────────

  /** Подписка на собственный приватный канон (живой синк + restore). */
  function subscribeSelf() {
    const pk = Nostr.getPubkey();
    if (!pk) return;

    if (!Config.get('syncEnabled', true)) {
      emitSync('off');
      return;
    }

    if (selfSubscription && typeof selfSubscription.close === 'function') {
      try { selfSubscription.close(); } catch (_) {}
    }

    selfSubscription = Nostr.subscribe(
      [{ authors: [pk], kinds: [kPrivate()] }],
      {
        onevent: ev => {
          if (!ev || !ev.id) return;

          // Оптимизация: не расшифровывать повторно одно и то же событие.
          if (selfSeen.has(ev.id)) return;
          selfSeen.add(ev.id);
          if (selfSeen.size > 500) {
            const arr = Array.from(selfSeen);
            selfSeen.clear();
            for (let i = Math.floor(arr.length / 2); i < arr.length; i++) {
              selfSeen.add(arr[i]);
            }
          }

          Protocol.decodePrivate(ev)
            .then(d => { if (d) applyIncomingPrivate(d); })
            .catch(() => {});
        },
        onclose: () => {
          // Синк критичен: переподписка с фиксированной задержкой, без статусов.
          setTimeout(() => {
            if (started && Config.get('syncEnabled', true)) {
              subscribeSelf();
            }
          }, 5000);
        },
      }
    );
  }

  // ─── Вспомогательные сети ─────────────────────────────────────────────────

  function ensureOnlineListener() {
    if (onlineListenerAdded) return;
    onlineListenerAdded = true;

    window.addEventListener('online', () => {
      if (!started) {
        start();
        return;
      }

      if (!isOffline()) {
        if (!subscription) subscribeToRoom();
        if (!selfSubscription && Config.get('syncEnabled', true)) subscribeSelf();
      }

      flushOutbox();
    });

    window.addEventListener('offline', () => {
      if (!started) return;

      setStatus('failed');

      // Инвалидируем подписки, чтобы onclose не запускал переподключение.
      subEpoch++;

      if (subscription && typeof subscription.close === 'function') {
        try { subscription.close(); } catch (_) {}
      }
      subscription = null;
    });
  }

  /** Обрезка seen-множества (комнатного). */
  function trimSeen() {
    const max = Config.get('seenMaxSize', 1000);
    if (seen.size <= max) return;

    const arr = Array.from(seen);
    seen.clear();

    for (let i = arr.length - Math.floor(max / 2); i < arr.length; i++) {
      seen.add(arr[i]);
    }
  }

  /**
   * Дедупликация контента от одного автора.
   * @param {string} pubkey
   * @param {string} text
   * @returns {boolean} true, если уже видели такой же текст.
   */
  function isContentDuplicate(pubkey, text) {
    const key = pubkey + '::' + String(text || '').trim();
    if (contentSeen.has(key)) return true;

    contentSeen.set(key, true);

    if (contentSeen.size > 2000) {
      const first = contentSeen.keys().next().value;
      contentSeen.delete(first);
    }

    return false;
  }

  /**
   * Token bucket для входящих заметок от одного автора.
   * Стартовый бюджет позволяет загрузить историю при первичной
   * синхронизации, но защищает от флуда.
   * @param {string} pubkey
   * @returns {boolean}
   */
  function allowIncomingNote(pubkey) {
    const now = Date.now();
    const capacity = Math.max(1, Number(Config.get('maxIncomingNotesPerPeer', 20)) || 20);
    const refillPerSec = 2;

    let bucket = peerNoteBudgets.get(pubkey);

    if (!bucket) {
      bucket = { tokens: capacity, ts: now };
      peerNoteBudgets.set(pubkey, bucket);
    }

    const elapsedSec = Math.max(0, (now - bucket.ts) / 1000);
    if (elapsedSec > 0) {
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
      bucket.ts = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  /** Перестройка центроидов префильтра (k-means по публичным заметкам). */
  function rebuildCentroids() {
    DB.all().then(notes => {
      const vecs = notes.filter(n => n.shared && n.vector).map(n => n.vector);
      if (!vecs.length) {
        centroids = [];
        return;
      }

      centroids = Vec.kmeans(
        vecs,
        Math.min(Config.get('centroidCount', 12), vecs.length),
        8
      );
    }).catch(() => {});
  }

  /**
   * @param {Float32Array|Array<number>} queryVector
   * @returns {boolean}
   */
  function passesPrefilter(queryVector) {
    if (!centroids.length) return true;

    const floor = Config.get('threshold', 0.81) - 0.20;
    for (const c of centroids) {
      if (Vec.cosine(queryVector, c) >= floor) return true;
    }

    return false;
  }

  // ─── Входящие события (комната) ───────────────────────────────────────────

  /**
   * @param {boolean} hard - true при реальном получении события
   *   (сбрасывает счётчик реконнектов); false — по 5с-таймауту.
   */
  function markConnected(hard) {
    if (!started) return;

    if (hard) {
      hasReceivedEvent = true;
      reconnectAttempts = 0;
    }

    setStatus('connected');
    flushOutbox();
  }

  /** Обработчик событий комнатной подписки. */
  function onEvent(ev) {
    if (!ev) return;

    // Любое полученное событие подтверждает, что сеть жива.
    if (!hasReceivedEvent) {
      markConnected(true);
    }

    if (seen.has(ev.id)) return;

    // Свои события комнаты игнорируем, но помечаем как виденные.
    // (30078 сюда не попадает — отдельная подписка на себя.)
    if (ev.pubkey === Nostr.getPubkey()) {
      seen.add(ev.id);
      trimSeen();
      return;
    }

    let accepted = false;

    if (ev.kind === kNote()) {
      accepted = handleIncomingNote(ev);
    } else if (ev.kind === kQuery()) {
      accepted = handleIncomingQuery(ev);
    } else if (ev.kind === kAnswer()) {
      accepted = handleIncomingAnswer(ev);
    } else if (ev.kind === kDelete()) {
      accepted = handleIncomingDelete(ev);
    }

    if (accepted) {
      seen.add(ev.id);
      trimSeen();
    }
  }

  /**
   * @param {Object} ev
   * @returns {boolean} true — пометить seen; false — оставить для повторной обработки.
   */
  function handleIncomingNote(ev) {
    const note = Protocol.decodeNote(ev);

    if (!note) return true;

    // Rate-limit: НЕ помечаем seen, чтобы событие могло пройти позже.
    if (!allowIncomingNote(note.authorPubkey)) {
      return false;
    }

    if (isContentDuplicate(note.authorPubkey, note.text)) {
      return true;
    }

    peers.set(note.authorPubkey, Date.now());

    // O(1): своя заметка, вернувшаяся от релея (по id или eventId).
    if (DB.hasLocal(note.id)) return true;

    DB.cacheGet(note.id).then(existing => {
      if (existing && existing.createdAt && note.createdAt && existing.createdAt > note.createdAt) {
        return;
      }

      DB.cachePut(note);
      notifyPeers();
    }).catch(() => {});

    return true;
  }

  /**
   * @param {Object} ev
   * @returns {boolean}
   */
  function handleIncomingQuery(ev) {
    const q = Protocol.decodeQuery(ev);

    if (!q) return true;

    const now = Date.now();
    const last = peerQueryTimes.get(ev.pubkey) || 0;

    if (now - last < Config.get('queryRateLimit', 3000)) {
      return true;
    }

    peerQueryTimes.set(ev.pubkey, now);

    if (!passesPrefilter(q.vector)) {
      return true;
    }

    DB.all().then(notes => {
      const candidates = notes.filter(n => n.shared && n.vector);
      if (!candidates.length) return null;

      const byId = new Map(candidates.map(n => [n.id, n]));
      const items = candidates.map(n => ({ id: n.id, vector: n.vector }));

      return Ranker.cosineBatch(q.vector, items).then(scored => {
        const top = scored
          .filter(s => s.score >= Config.get('threshold', 0.81))
          .slice(0, q.maxResponses || Config.get('maxResponses', 8));

        top.forEach((s, i) => {
          const note = byId.get(s.id);
          if (!note) return;

          setTimeout(() => {
            Nostr.publish(Protocol.answerEvent(note, s.score, q.queryId, room()))
              .catch(e => Logger.warn('NetService: не отправить ответ', String(e)));
          }, i * 250);
        });
      });
    }).catch(e => Logger.warn('NetService: ошибка обработки запроса', String(e)));

    return true;
  }

  /**
   * @param {Object} ev
   * @returns {boolean}
   */
  function handleIncomingAnswer(ev) {
    const a = Protocol.decodeAnswer(ev);

    if (!a) return true;

    if (a.queryId !== activeQueryId) {
      return true;
    }

    if (isContentDuplicate(a.authorPubkey, a.text)) {
      return true;
    }

    peers.set(a.authorPubkey, Date.now());

    DB.cachePut({
      id: a.id,
      text: a.text,
      vector: a.vector,
      shared: true,
      authorPubkey: a.authorPubkey,
      createdAt: a.createdAt,
      score: a.score,
    });

    notifyPeers();

    return true;
  }

  /**
   * @param {Object} ev
   * @returns {boolean}
   */
  function handleIncomingDelete(ev) {
    const del = Protocol.decodeDelete(ev);

    if (!del) return true;

    del.eventIds.forEach(eventId => {
      if (eventId) DB.cacheDel(eventId);
    });

    if (del.authorPubkey) peers.set(del.authorPubkey, Date.now());
    notifyPeers();

    return true;
  }

  // ─── Исходящие операции ───────────────────────────────────────────────────

  /**
   * Анонс публичной проекции заметки (kind 1). При успехе eventId
   * сохраняется и уезжает в канон (чтобы другие устройства могли
   * удалить проекцию при необходимости).
   * @param {Object} note
   * @returns {Promise<void>}
   */
  async function announceNote(note) {
    if (!note || !note.shared || !note.vector) return;

    if (note.eventId) {
      unqueueAnnounce(note.id);
      return;
    }

    if (!canPublish()) {
      queueAnnounce(note.id);
      return;
    }

    try {
      const tpl = await buildNoteEvent(note);
      const ev = await Nostr.publish(tpl);
      unqueueAnnounce(note.id);
      Logger.info('NetService: анонс заметки ' + note.id);

      if (ev && ev.id && note.id) {
        const cur = await DB.get(note.id).catch(() => null);
        if (cur && cur.eventId !== ev.id) {
          cur.eventId = ev.id;
          await DB.put(cur).catch(() => {});
          publishPrivate(cur);
        }
      }
    } catch (e) {
      Logger.warn('NetService: не анонсировать, поставлено в очередь', String(e && e.message || e));
      queueAnnounce(note.id);
    }
  }

  /**
   * Запрос удаления публичной проекции с рэлеев (kind 5).
   * @param {Object} note
   * @returns {Promise<void>}
   */
  async function forgetNote(note) {
    if (!note || !note.eventId) return;

    if (!canPublish()) {
      queueDelete(note.eventId);
      return;
    }

    const ev = Protocol.deleteEvent(note.eventId, room());
    if (!ev) return;

    try {
      await Nostr.publish(ev);
      unqueueDelete(note.eventId);
      Logger.info('NetService: запрос удаления с рэлеев ' + note.id);
    } catch (e) {
      Logger.warn('NetService: не удалить с рэлеев, поставлено в очередь', String(e && e.message || e));
      queueDelete(note.eventId);
    }
  }

  /**
   * Отправка запроса в сеть при изменении контекста.
   * В офлайне запросы не отправляем.
   */
  function maybeSendQuery() {
    const ctx = Store.get('context');

    if ((ctx.source !== 'pin' && ctx.source !== 'drift') || !ctx.vector) {
      lastQueryVec = null;
      return;
    }

    if (!canPublish()) {
      lastQueryVec = null;
      return;
    }

    const now = Date.now();
    if (now - lastQueryTime < Config.get('queryRateLimit', 3000)) return;

    if (lastQueryVec && Ranker.isSimilar(lastQueryVec, ctx.vector)) return;

    lastQueryVec = ctx.vector;
    lastQueryTime = now;

    const tpl = Protocol.queryEvent(
      ctx.vector,
      Config.get('maxResponses', 8),
      Config.get('responseWindow', 6000)
    );

    Nostr.publish(tpl)
      .then(ev => {
        activeQueryId = ev.id;
        Logger.info('NetService: запрос ' + ev.id.slice(0, 8) + '…');
      })
      .catch(e => {
        lastQueryVec = null;
        lastQueryTime = 0;
        Logger.warn('NetService: не отправить запрос', String(e && e.message || e));
      });
  }

  // ─── Подписка на комнату ──────────────────────────────────────────────────

  /** Подписка на комнату с экспоненциальным реконнектом. */
  function subscribeToRoom() {
    const since = Math.floor(Date.now() / 1000) - currentWindow;
    const filters = [{
      kinds: [kNote(), kQuery(), kAnswer(), kDelete()],
      '#t': [room()],
      since,
    }];

    const myEpoch = ++subEpoch;

    if (subscription && typeof subscription.close === 'function') {
      try { subscription.close(); } catch (_) {}
    }

    subscription = Nostr.subscribe(filters, {
      onevent: onEvent,
      onclose: () => {
        if (myEpoch !== subEpoch) return;

        setStatus('reconnecting');

        // Экспоненциальный реконнект: base * 2^(n-1), максимум maxDelay,
        // джиттер ±25% против синхронных штормов.
        const maxAttempts = Config.get('reconnectMaxAttempts', 10);
        const baseDelay = Config.get('reconnectBaseDelay', 1000);
        const maxDelay = Config.get('reconnectMaxDelay', 60000);

        reconnectAttempts++;

        if (reconnectAttempts > maxAttempts) {
          Logger.warn('NetService: ' + maxAttempts + ' неудачных подключений, жду сеть/пользователя');
          setStatus('failed');
          return;
        }

        const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts - 1), maxDelay);
        const jitter = delay * 0.25 * Math.random();

        setTimeout(() => {
          if (started && myEpoch === subEpoch && !isOffline()) {
            subscribeToRoom();
          }
        }, delay + jitter);
      },
    });

    if (subscription) {
      setStatus('connecting');

      // Пустая комната: через 5 секунд считаем подключение установленным
      // (без сброса счётчика реконнектов — только реальное событие его сбрасывает).
      setTimeout(() => {
        if (myEpoch === subEpoch && started && !isOffline()) {
          markConnected(false);
        }
      }, 5000);
    }
  }

  /** Расширение окна истории («Загрузить ещё»). */
  function loadHistory() {
    if (!started || historyLoading) return;

    const maxWindow = Config.get('historyMaxWindow', 2592000);
    if (currentWindow >= maxWindow) {
      emitHistory(false, currentWindow);
      return;
    }

    historyLoading = true;
    emitHistory(true, currentWindow);

    currentWindow = Math.min(maxWindow, Math.max(currentWindow * 4, 86400));

    try {
      subscribeToRoom();
      Logger.info('NetService: окно истории → ' + currentWindow + 's');
    } finally {
      setTimeout(() => {
        historyLoading = false;
        emitHistory(false, currentWindow);
      }, 1200);
    }
  }

  /** Heartbeat: чистка пиров и лимитеров. */
  function startHeartbeat() {
    if (hbTimer) clearInterval(hbTimer);

    hbTimer = setInterval(() => {
      const now = Date.now();
      const ttl = Config.get('peerTTL', 60000);
      let changed = false;

      peers.forEach((ts, pk) => {
        if (now - ts > ttl) {
          peers.delete(pk);
          changed = true;
        }
      });

      peerQueryTimes.forEach((ts, pk) => {
        if (now - ts > 60000) peerQueryTimes.delete(pk);
      });

      peerNoteBudgets.forEach((bucket, pk) => {
        if (now - bucket.ts > 300000) peerNoteBudgets.delete(pk);
      });

      if (changed) notifyPeers();
      trimSeen();
    }, Config.get('heartbeat', 30000));
  }

  // ─── Старт/стоп ───────────────────────────────────────────────────────────

  function start() {
    if (started) return Promise.resolve();
    if (startPromise) return startPromise;

    ensureOnlineListener();

    startPromise = Nostr.init()
      .then(() => DB.ready())
      .then(() => {
        started = true;
        hasReceivedEvent = false;
        reconnectAttempts = 0;

        busUnsubs.forEach(u => {
          try { u(); } catch (_) {}
        });
        busUnsubs = [];

        busUnsubs.push(bus.on('note:created', note => {
          if (!note) return;
          publishPrivate(note);
          if (note.shared) announceNote(note);
        }));

        busUnsubs.push(bus.on('note:updated', note => {
          // Правки только личных заметок; канон должен узнать новую версию.
          if (note) publishPrivate(note);
        }));

        busUnsubs.push(bus.on('note:shared', note => {
          if (!note || !note.shared) return;
          publishPrivate(note);
          announceNote(note);
        }));

        busUnsubs.push(bus.on('note:unshared', note => {
          if (!note) return;

          if (note.id) unqueueAnnounce(note.id);
          publishPrivate(note);
          if (!note.shared && note.eventId) forgetNote(note);
        }));

        busUnsubs.push(bus.on('note:deleted', note => {
          if (!note) return;

          if (note.id) unqueueAnnounce(note.id);
          tombstoneNote(note.id);
          if (note.shared && note.eventId) forgetNote(note);
        }));

        busUnsubs.push(bus.on('db:change', () => rebuildCentroids()));

        busUnsubs.push(bus.on('sync:toggle', p => {
          if (!p) return;
          if (p.enabled) {
            subscribeSelf();
            runBacksweep();
          } else {
            if (selfSubscription && typeof selfSubscription.close === 'function') {
              try { selfSubscription.close(); } catch (_) {}
            }
            selfSubscription = null;
            emitSync('off');
          }
        }));

        contextUnsub = Store.subscribe(s => s.context, () => maybeSendQuery());

        startHeartbeat();
        rebuildCentroids();
        scanLocalUnpublished();

        if (isOffline()) {
          setStatus('failed');
          Logger.warn('NetService: офлайн, ожидаем появление сети');
        } else {
          subscribeToRoom();
        }

        subscribeSelf();
        runBacksweep();

        Logger.info('NetService: запущен, комната #' + room());
      }).catch(e => {
        Logger.error('NetService: не стартовать', String(e && e.message || e));
        setStatus('failed');

        if (startRetryTimer) clearTimeout(startRetryTimer);
        startRetryTimer = setTimeout(() => {
          if (!started) start();
        }, 10000);
      }).finally(() => {
        startPromise = null;
      });

    return startPromise;
  }

  /**
   * @param {boolean} full - Полная остановка с очисткой лимитеров.
   */
  function stop(full) {
    started = false;
    hasReceivedEvent = false;

    if (subscription && typeof subscription.close === 'function') {
      try { subscription.close(); } catch (_) {}
    }
    subscription = null;

    if (selfSubscription && typeof selfSubscription.close === 'function') {
      try { selfSubscription.close(); } catch (_) {}
    }
    selfSubscription = null;

    if (hbTimer) {
      clearInterval(hbTimer);
      hbTimer = null;
    }

    if (contextUnsub) {
      try { contextUnsub(); } catch (_) {}
      contextUnsub = null;
    }

    busUnsubs.forEach(u => {
      try { u(); } catch (_) {}
    });
    busUnsubs = [];

    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    if (startRetryTimer) {
      clearTimeout(startRetryTimer);
      startRetryTimer = null;
    }

    activeQueryId = null;
    lastQueryVec = null;
    lastQueryTime = 0;
    reconnectAttempts = 0;

    if (full) {
      peers.clear();
      seen.clear();
      selfSeen.clear();
      contentSeen.clear();
      peerQueryTimes.clear();
      peerNoteBudgets.clear();
    }

    setStatus('disconnected');
  }

  /**
   * Публичный wipe для Boot: tombstone всех канонов + kind 5 всех
   * публичных проекций (перед DB.reset). Best-effort.
   * @returns {Promise<void>}
   */
  async function publishWipeAll() {
    if (!canPublish()) return;

    try {
      const notes = await DB.all();

      // Публичные проекции — одним kind 5.
      const pubIds = notes.filter(n => n && n.eventId).map(n => n.eventId);
      if (pubIds.length) {
        const ev = Protocol.deleteEvent(pubIds, room());
        if (ev) {
          await Nostr.publish(ev).catch(() => {});
        }
      }

      // Каноны — tombstone последовательно.
      if (Config.get('syncEnabled', true)) {
        for (const n of notes) {
          if (!n || !n.id) continue;
          try {
            const tpl = await Protocol.privateTombstone(n.id);
            await Nostr.publish(tpl);
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  return { start, stop, loadHistory, publishWipeAll };
}, ['Nostr', 'Protocol', 'DB', 'Ranker', 'Vec', 'Store', 'Config', 'Logger', 'EventBus']);
// ─── NET/NetService ─── END ─────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// СЛОЙ: DOMAIN — бизнес-логика
// ═══════════════════════════════════════════════════════════════════════════════

// ─── DOMAIN/Notes ─── START ─────────────────────────────────────────────────
/**
 * CRUD для локальных заметок.
 * Каждая заметка при создании/редактировании получает вектор через Embedder.
 * События: note:created, note:updated, note:deleted, note:shared, note:unshared.
 *
 * Модель v0.7:
 * - id — стабильный uid (Utils.uid('n')), никогда не меняется;
 * - parentId — всегда uid родителя (никаких eventId в ссылках);
 * - syncTs — метка последнего локального изменения; NetService использует
 *   её для LWW при синхронизации канона (kind 30078). Ставится при каждом
 *   изменении: равенство syncTs у входящего события = эхо собственной
 *   публикации, событие не применяется;
 * - eventId — ссылка на публичную проекцию (kind 1), проставляется
 *   NetService'ом после анонса.
 */
DI.register('Notes', function (DB, Embedder, bus, Logger, Utils) {
  /**
   * Эмит события в шину (никогда не бросает).
   * @param {string} event - Имя события.
   * @param {*} payload - Полезная нагрузка.
   */
  function emit(event, payload) {
    try { bus.emit(event, payload); } catch (_) {}
  }

  /**
   * Создание заметки.
   * @param {string} text - Текст заметки.
   * @param {string} mode - 'private' или 'world'.
   * @param {string|null} parentId - uid родительской заметки (связь «по мотивам»).
   * @returns {Promise<Object|null>} Созданная заметка или null при пустом тексте.
   */
  function create(text, mode, parentId) {
    const t = (text || '').trim();
    if (!t) return Promise.resolve(null);

    return Embedder.embed(t).then(vector => {
      const now = Date.now();
      const note = {
        id: Utils.uid('n'),
        text: t,
        vector: vector ? Array.from(vector) : null,
        shared: mode === 'world',
        parentId: parentId || null,
        parentPubkey: null,
        createdAt: now,
        updatedAt: now,
        syncTs: now,
      };

      return DB.put(note).then(() => {
        emit('note:created', note);
        return note;
      });
    });
  }

  /**
   * Редактирование заметки. Пересчитывает вектор.
   * Публичные заметки редактировать нельзя (immutable в Nostr) —
   * проверяется на уровне UI (NoteView), здесь не блокируется.
   * @param {string} id - uid заметки.
   * @param {string} newText - Новый текст.
   * @returns {Promise<Object|null>} Обновлённая заметка или null.
   */
  function edit(id, newText) {
    const t = (newText || '').trim();
    if (!t) return Promise.resolve(null);

    return DB.get(id).then(note => {
      if (!note) return null;

      return Embedder.embed(t).then(vector => {
        const now = Date.now();
        note.text = t;
        note.vector = vector ? Array.from(vector) : null;
        note.updatedAt = now;
        note.syncTs = now;

        return DB.put(note).then(() => {
          emit('note:updated', note);
          return note;
        });
      });
    });
  }

  /**
   * Удаление заметки.
   * @param {string} id - uid заметки.
   * @returns {Promise<Object|null>} Удалённая заметка (для NetService) или null.
   */
  function remove(id) {
    return DB.get(id).then(note => {
      if (!note) return null;

      return DB.del(id).then(() => {
        emit('note:deleted', note);
        return note;
      });
    });
  }

  /**
   * Переключение видимости: личное ↔ мир.
   * При публикации NetService (слушает note:shared/note:unshared)
   * обновляет канон и анонсирует/удаляет публичную проекцию.
   * @param {string} id - uid заметки.
   * @returns {Promise<Object|null>} Обновлённая заметка или null.
   */
  function toggleShared(id) {
    return DB.get(id).then(note => {
      if (!note) return null;

      note.shared = !note.shared;
      note.updatedAt = Date.now();
      note.syncTs = Date.now();

      return DB.put(note).then(() => {
        emit(note.shared ? 'note:shared' : 'note:unshared', note);
        return note;
      });
    });
  }

  /**
   * Получить заметку по uid.
   * @param {string} id
   * @returns {Promise<Object|undefined>}
   */
  function get(id) {
    return DB.get(id);
  }

  return { create, edit, remove, toggleShared, get };
}, ['DB', 'Embedder', 'EventBus', 'Logger', 'Utils']);
// ─── DOMAIN/Notes ─── END ───────────────────────────────────────────────────

// ─── DOMAIN/Context ─── START ───────────────────────────────────────────────
/**
 * Управление текущим контекстом поиска.
 *
 * Состояния контекста:
 * - 'pin':   Заметка закреплена (клик по карточке). Лента показывает созвучное.
 * - 'drift': Закреплённая заметка + пользователь печатает. Контекст плавно
 *            смещается от закреплённой мысли к вводимому тексту.
 * - 'input': Пользователь печатает без закреплённой заметки.
 * - null:    Контекста нет. Лента в хронологическом порядке.
 *
 * Событие 'note:pin' от NoteView/FeedView активирует пин.
 *
 * pinNote хранит eventId, если родитель опубликован: Composer передаёт
 * parentId = eventId || id (v0.6-семантика), NetService дополнительно
 * резолвит ссылку родителя при публикации проекции.
 */
DI.register('Context', function (Store, Embedder, Config, Utils, bus) {
  /** @type {string} */
  let inputText = '';
  /** @type {Float32Array|null} */
  let inputVector = null;
  /** @type {Object|null} */
  let pinNote = null;

  /**
   * Вычисление активного контекста на основе текущего состояния.
   * Приоритет: drift > pin > input > none.
   * @returns {Object} Контекст для Store.
   */
  function activeContext() {
    const hasInput = !!inputText.trim();

    if (pinNote && hasInput) {
      return {
        source: 'drift',
        noteId: pinNote.id,
        text: inputText.trim(),
        vector: inputVector,
        pinText: pinNote.text,
      };
    }

    if (pinNote) {
      return {
        source: 'pin',
        noteId: pinNote.id,
        text: pinNote.text,
        vector: pinNote.vector,
      };
    }

    if (hasInput) {
      return {
        source: 'input',
        noteId: null,
        text: inputText.trim(),
        vector: inputVector,
      };
    }

    return {
      source: null,
      noteId: null,
      text: '',
      vector: null,
      pinText: null,
    };
  }

  /** Пуш активного контекста в Store. */
  function push() {
    Store.setState({ context: activeContext() });
  }

  /**
   * Дебаунс для эмбеддинга вводимого текста.
   * Если пользователь быстро печатает, вектор пересчитывается
   * только после паузы в `debounce` мс.
   */
  const debouncedEmbed = Utils.debounce(() => {
    const t = inputText.trim();
    if (!t) {
      inputVector = null;
      push();
      return;
    }

    Embedder.embed(t).then(v => {
      // Защита от race condition: если текст изменился пока считался вектор,
      // не применяем устаревший результат.
      if (inputText.trim() === t) {
        inputVector = v;
        push();
      }
    });
  }, Config.get('debounce', 350));

  return {
    /**
     * Обновить вводимый текст (из Composer).
     * @param {string} text - Текущее значение поля ввода.
     */
    setInput(text) {
      inputText = text || '';
      if (!inputText.trim()) inputVector = null;
      push();
      debouncedEmbed();
    },

    /**
     * Закрепить заметку (пин).
     * @param {Object} note - Заметка с вектором.
     */
    setPin(note) {
      if (!note || !note.vector) return;
      pinNote = {
        id: note.id,
        eventId: note.eventId || null,
        text: note.text,
        vector: note.vector,
      };
      push();
    },

    /** Снять пин. */
    clearPin() {
      pinNote = null;
      push();
    },

    /** Полная очистка (ввод + пин). */
    clear() {
      inputText = '';
      inputVector = null;
      pinNote = null;
      debouncedEmbed.cancel();
      push();
    },

    /**
     * Вектор активного контекста.
     * @returns {Float32Array|Array<number>|null}
     */
    getVector() {
      return activeContext().vector;
    },

    /**
     * Активный контекст (снапшот).
     * @returns {Object}
     */
    getActive() {
      return activeContext();
    },

    /**
     * Текущий пин (для Composer).
     * @returns {Object|null}
     */
    getPin() {
      return pinNote;
    },

    /**
     * Инициализация: подписка на note:pin из шины.
     * Вызывается через Context.init() (метод, не деструктуризация).
     */
    init() {
      bus.on('note:pin', note => {
        if (note) this.setPin(note);
      });
    },
  };
}, ['Store', 'Embedder', 'Config', 'Utils', 'EventBus']);
// ─── DOMAIN/Context ─── END ─────────────────────────────────────────────────

// ─── DOMAIN/Feed ─── START ──────────────────────────────────────────────────
/**
 * Формирование ленты.
 *
 * Два режима:
 * 1. Без контекста (source === null):
 *    Все заметки (локальные + сетевые) в хронологическом порядке.
 *
 * 2. С контекстом (pin / drift / input):
 *    Ранжирование по косинусному сходству с вектором контекста.
 *    Разделение на relevant (>= threshold) и serendipity (ниже порога,
 *    но в пределах окна озарений).
 *
 * Обновление триггерится:
 * - Изменением контекста (подписка на Store)
 * - Изменением локальной БД (db:change) — включая заметки, применённые
 *   из приватного канона (sync)
 * - Изменением сетевого кэша (db:cache)
 */
DI.register('Feed', function (DB, Ranker, Store, bus, Logger) {
  /** Счётчик поколений для защиты от гонок. */
  let seq = 0;
  /** @type {Array<Function>} */
  let unsubs = [];

  /**
   * Пересборка ленты. Если за время асинхронной работы пришёл новый вызов,
   * результат устаревшего отбрасывается (seq-guard).
   * @returns {Promise<void>}
   */
  function refresh() {
    const my = ++seq;
    const ctx = Store.get('context');

    return Promise.all([DB.all(), DB.cacheAll()]).then(([local, cached]) => {
      if (my !== seq) return;

      if (!ctx.source) {
        // Режим 1: без контекста — хронологический поток

        // Дедупликация: исключаем из cached заметки, уже существующие
        // локально (по id или eventId). Вторая линия обороны после
        // DB.hasLocal в NetService.
        const localIds = new Set();
        local.forEach(n => {
          if (n && n.id) localIds.add(n.id);
          if (n && n.eventId) localIds.add(n.eventId);
        });

        const filteredCached = cached.filter(n => {
          if (!n || !n.id) return false;
          return !localIds.has(n.id);
        });

        const merged = [
          ...local.map(n => Object.assign({}, n, { own: true })),
          ...filteredCached.map(n => Object.assign({}, n, { own: false })),
        ].sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));

        Store.setState({
          feed: merged,
          lists: { local: [], world: [], seren: [] },
        });

        return;
      }

      if (!ctx.vector) return;

      // Режим 2: ранжирование по сходству
      const items = [];
      const dataMap = new Map();

      for (const n of local) {
        if (n && n.vector) {
          items.push({ id: n.id, vector: n.vector });
          dataMap.set(n.id, Object.assign({}, n, { own: true }));
        }
      }

      for (const n of cached) {
        if (n && n.vector) {
          items.push({ id: n.id, vector: n.vector });
          dataMap.set(n.id, Object.assign({}, n, { own: false }));
        }
      }

      return Ranker.cosineBatch(ctx.vector, items).then(scored => {
        if (my !== seq) return;

        const { relevant, seren } = Ranker.split(scored);

        const toRes = s => {
          const n = dataMap.get(s.id);
          return n ? Object.assign({}, n, { score: s.score }) : null;
        };

        const rel = relevant.map(toRes).filter(Boolean);

        Store.setState({
          lists: {
            local: rel.filter(n => n.own),
            world: rel.filter(n => !n.own),
            seren: seren.map(toRes).filter(Boolean),
          },
          feed: [],
        });
      });
    }).catch(err => {
      Logger.warn('Feed: ошибка refresh', String(err && err.message || err));
    });
  }

  /**
   * Инициализация: подписки на триггеры + первичная сборка.
   */
  function init() {
    unsubs.push(Store.subscribe(s => s.context, () => refresh(), Store.shallowEqual));
    unsubs.push(bus.on('db:change', () => refresh()));
    unsubs.push(bus.on('db:cache', () => refresh()));

    refresh();
  }

  /** Отписка от всех триггеров. */
  function destroy() {
    unsubs.forEach(u => {
      try { u(); } catch (_) {}
    });
    unsubs = [];
  }

  return { init, destroy, refresh };
}, ['DB', 'Ranker', 'Store', 'EventBus', 'Logger']);
// ─── DOMAIN/Feed ─── END ────────────────────────────────────────────────────

// ─── DOMAIN/Provenance ─── START ────────────────────────────────────────────
/**
 * Построение генеалогических связей между заметками.
 *
 * Заметки связаны через поле parentId:
 * - свои заметки (в т.ч. пришедшие из приватного канона): parentId = uid;
 * - чужие заметки: parentId = eventId публичной проекции родителя.
 *
 * Поэтому поиск родителя/детей всегда проверяет оба поля (id и eventId).
 *
 * Отличие от v0.6: кэш предков (TTL 5с) инвалидируется сам — модуль
 * подписан на db:change / db:cache в теле фабрики. Внешний вызов
 * clearCache из MenuView удалён (мёртвый код в новой версии).
 *
 * Модуль инстанцируется при резолве FeedView (BOOT, шаг 5) — до
 * первого сетевого события, подписка безопасна.
 */
DI.register('Provenance', function (DB, bus) {
  /** @type {Map<string, {chain: Array, timestamp: number}>} */
  const ancestorsCache = new Map();
  const CACHE_TTL = 5000;

  /**
   * Все заметки: локальные + сетевой кэш.
   * @returns {Promise<Array<Object>>}
   */
  function loadAll() {
    return Promise.all([DB.all(), DB.cacheAll()]).then(([own, cached]) => own.concat(cached));
  }

  /**
   * Прямые дети заметки по её id или eventId.
   * @param {string} id - uid или eventId заметки.
   * @returns {Promise<Array<Object>>}
   */
  function children(id) {
    if (!id) return Promise.resolve([]);

    return loadAll().then(all => all.filter(n => n && n.parentId === id));
  }

  /**
   * Все потомки (BFS). Защита от циклов через seenIds.
   * @param {string} id - uid или eventId заметки.
   * @returns {Promise<Array<Object>>}
   */
  function descendants(id) {
    if (!id) return Promise.resolve([]);

    return loadAll().then(all => {
      const out = [];
      const seenIds = new Set([id]);
      let frontier = [id];

      while (frontier.length) {
        const next = [];

        for (const n of all) {
          if (n && n.parentId && frontier.indexOf(n.parentId) !== -1 && !seenIds.has(n.id)) {
            seenIds.add(n.id);
            out.push(n);
            next.push(n.id);
          }
        }

        frontier = next;
      }

      return out;
    });
  }

  /**
   * Цепочка предков от текущей заметки до корня.
   *
   * Поиск родителя учитывает:
   * 1. Точное совпадение по id (локальная/своя заметка, uid)
   * 2. Совпадение по eventId (опубликованная проекция)
   * 3. Локальная заметка с matching eventId
   *
   * Защита от циклов через seen.
   *
   * @param {string} id - uid или eventId заметки.
   * @returns {Promise<Array<Object>>} Цепочка от непосредственного родителя к корню.
   */
  function ancestors(id) {
    if (!id) return Promise.resolve([]);

    const cached = ancestorsCache.get(id);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return Promise.resolve(cached.chain);
    }

    return loadAll().then(all => {
      const byId = new Map();

      all.forEach(n => {
        if (!n) return;
        if (n.id) byId.set(n.id, n);
        if (n.eventId) byId.set(n.eventId, n);
      });

      function findNote(targetId) {
        if (!targetId) return null;

        // 1. Прямое совпадение по id или eventId
        if (byId.has(targetId)) return byId.get(targetId);

        // 2. Локальная заметка, которая была опубликована (имеет matching eventId)
        const localPublished = all.find(n => n && n.id === targetId && n.eventId);
        if (localPublished) return localPublished;

        // 3. Сетевая заметка с matching eventId
        const byEvent = all.find(n => n && n.eventId === targetId);
        if (byEvent) return byEvent;

        return null;
      }

      const chain = [];
      const seen = new Set();
      let current = findNote(id);

      while (current && current.parentId) {
        if (seen.has(current.parentId)) break;
        seen.add(current.parentId);

        const parent = findNote(current.parentId);
        if (!parent) break;

        chain.push(parent);
        current = parent;
      }

      ancestorsCache.set(id, { chain, timestamp: Date.now() });
      return chain;
    });
  }

  /**
   * Принудительная очистка кеша предков.
   * @returns {void}
   */
  function clearCache() {
    ancestorsCache.clear();
  }

  // Самоинвалидация кэша при любом изменении данных.
  bus.on('db:change', clearCache);
  bus.on('db:cache', clearCache);

  return { children, descendants, ancestors, loadAll, clearCache };
}, ['DB', 'EventBus']);
// ─── DOMAIN/Provenance ─── END ──────────────────────────────────────────────

// ─── DOMAIN/Influence ─── START ─────────────────────────────────────────────
/**
 * Подсчёт резонанса: сколько уникальных авторов создали потомков заметки.
 *
 * Резонанс показывает влияние заметки на сеть. Если заметка A породила
 * 5 заметок от 3 разных авторов, её резонанс = 3 (уникальные авторы).
 * Свои потомки учитываются как автор 'self'.
 *
 * Карта resonanceMap перестраивается при изменении БД или создании/
 * удалении заметок; инкрементальное обновление при создании/обновлении.
 *
 * Ключи карты — значения parentId детей (uid для своих, eventId для
 * чужих). Consumers проверяют оба: resonance(n.id) + resonance(n.eventId).
 */
DI.register('Influence', function (DB, bus, Logger) {
  /** @type {Map<string, Set<string>>} uid/eventId → множество авторов. */
  const resonanceMap = new Map();
  /** Счётчик поколений для защиты от гонок. */
  let seq = 0;

  /**
   * Полная перестройка карты резонанса.
   * @returns {Promise<void>}
   */
  function rebuild() {
    const my = ++seq;

    return Promise.all([DB.all(), DB.cacheAll()]).then(([own, cached]) => {
      if (my !== seq) return;

      const map = new Map();

      own.concat(cached).forEach(n => {
        if (n && n.parentId) {
          if (!map.has(n.parentId)) map.set(n.parentId, new Set());
          map.get(n.parentId).add(n.authorPubkey || 'self');
        }
      });

      resonanceMap.clear();
      map.forEach((v, k) => resonanceMap.set(k, v));

      try { bus.emit('influence:updated'); } catch (_) {}
    }).catch(e => Logger.warn('Influence: ошибка rebuild', String(e)));
  }

  /**
   * Инкрементальное обновление при создании/обновлении заметки.
   * @param {Object} note - Заметка с parentId.
   */
  function updateForNote(note) {
    if (!note || !note.parentId) return;

    if (!resonanceMap.has(note.parentId)) {
      resonanceMap.set(note.parentId, new Set());
    }

    resonanceMap.get(note.parentId).add(note.authorPubkey || 'self');

    try { bus.emit('influence:updated'); } catch (_) {}
  }

  /**
   * Резонанс заметки по id (uid).
   * @param {string} id - uid заметки.
   * @returns {number} Число уникальных авторов потомков.
   */
  function resonance(id) {
    if (!id) return 0;
    const s = resonanceMap.get(id);
    return s ? s.size : 0;
  }

  /**
   * Инициализация: подписки на изменения + первичная перестройка.
   */
  function init() {
    bus.on('note:created', updateForNote);
    bus.on('note:updated', updateForNote);
    bus.on('note:deleted', () => rebuild());
    bus.on('db:change', () => rebuild());
    bus.on('db:cache', () => rebuild());

    rebuild();
  }

  return { init, resonance, rebuild };
}, ['DB', 'EventBus', 'Logger']);
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
