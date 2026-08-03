'use strict';

import { DI } from './di.js';

// ═══════════════════════════════════════════════════════════════
// APP VERSION
// ═══════════════════════════════════════════════════════════════
const APP_VERSION = '0.2.0';

// ═══════════════════════════════════════════════════════════════
// CORE/Config
// ═══════════════════════════════════════════════════════════════
/**
 * Configuration: defaults + localStorage persistence + schema versioning.
 * @exports Config
 */
DI.register('Config', function () {
  const KEY = 'noomium:cfg';

  /** Current config schema version. @readonly */
  const SCHEMA_VERSION = 3;

  /** Default values (frozen). @readonly */
  const defaults = Object.freeze({
    schemaVersion: SCHEMA_VERSION,

    // ── General ──
    room: 'noomium-main',
    theme: 'dark',
    lang: null,
    onboarded: false,
    logLevel: 'info',

    // ── AI ──
    model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    dim: 384,
    aiCacheLimit: 300,
    aiEmbedTimeout: 15000,

    // ── Ranking ──
    threshold: 0.7,
    serendipity: 0.3,
    vectorSimilarityThreshold: 0.98,

    // ── Network ──
    relays: [
      'wss://relay.primal.net',
      'wss://relay.snort.social',
    ],
    kNote: 1,
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
    relayErrorThreshold: 5,
    relayCircuitBreakTime: 120000,
    relayBackoff1: 15000,
    relayBackoff2: 30000,
    reconnectMaxAttempts: 10,
    reconnectBaseDelay: 1000,
    reconnectMaxDelay: 60000,
    seenMaxSize: 1000,
    maxAnswerTextLength: 10000,

    // ── Data ──
    dbName: 'noomium_v2',
    storeName: 'notes',
    cacheStoreName: 'cache',

    // ── UI ──
    debounce: 350,
    baseSearchDebounce: 200,
    truncateTextLength: 140,
    toastMaxVisible: 3,
    toastDefaultDuration: 2200,
    maxPasswordAttempts: 3,
    influenceWeightByAge: true,

    // ── Future ──
    indexerUrl: null,
    premiumRelay: null,
    gpuRanking: false,
    cloudView: false,
  });

  /** Schema migrations. Key = version to migrate from. */
  const migrations = {
    1: s => s,
    2: s => {
      s.relays = defaults.relays.slice();
      return s;
    },
  };

  /** Current state. @type {Object} */
  const state = Object.assign({}, defaults);

  // Load + migrate + merge only known keys.
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      let saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        let v = saved.schemaVersion || saved.version || 1;
        while (v < SCHEMA_VERSION) {
          const migrate = migrations[v];
          if (typeof migrate === 'function') saved = migrate(saved);
          v++;
        }
        saved.schemaVersion = SCHEMA_VERSION;
        for (const k of Object.keys(defaults)) if (k in saved) state[k] = saved[k];
      }
    }
  } catch (_) { /* ignore */ }

  /** Persists state. */
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }

  return {
    get(k, def) { return (k in state) ? state[k] : def; },
    set(k, v) { state[k] = v; persist(); },
    save: persist,
    defaults() { return Object.assign({}, defaults); },
    all() { return Object.assign({}, state); },
    schemaVersion() { return SCHEMA_VERSION; },
    reset() {
      for (const k of Object.keys(defaults)) state[k] = defaults[k];
      persist();
    },
  };
});

export { APP_VERSION };
