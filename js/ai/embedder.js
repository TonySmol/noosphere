// ─── AI/Embedder ─── START ───────────────────────────────────
/**
 * Эмбеддинги в Web Worker (transformers.js, ленивая загрузка модели).
 *
 * Режимы: 'loading' → 'model' (успех) или 'demo' (fallback на hash-эмбеддинг).
 * В 'demo' и до вызова load() embed() мгновенно возвращает детерминированный
 * hash-вектор — приложение работает всегда, просто поиск грубее.
 *
 * Прогресс загрузки транслируется через 'ai:progress' и 'ai:status'
 * (их слушают Progress и HeaderStatus). Ошибка/таймаут отдельного embed
 * не роняет ничего — тихий hash-fallback.
 *
 * @deps Config, EventBus, Logger
 * @exports Embedder
 */
DI.register('Embedder', function (Config, bus, Logger) {
  /** Код Worker'а строкой: изолированный поток, модель не трогает UI. */
  const workerCode = `
let extractor = null;
let ready = false;
self.onmessage = async function (e) {
  const msg = e.data;
  if (msg.type === 'load') {
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
      mod.env.allowLocalModels = false;
      mod.env.useBrowserCache = true;
      extractor = await mod.pipeline('feature-extraction', msg.model, {
        quantized: true,
        progress_callback: function (p) {
          if (p.status === 'progress' && p.total > 0) {
            self.postMessage({ type: 'progress', pct: p.loaded / p.total * 100 });
          }
        }
      });
      ready = true;
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', id: null, message: String(err && err.message || err) });
    }
    return;
  }
  if (!ready) { self.postMessage({ type: 'error', id: msg.id, message: 'model not loaded' }); return; }
  if (msg.type === 'embed') {
    try {
      const out = await extractor(msg.text, { pooling: 'mean', normalize: true });
      self.postMessage({ type: 'result', id: msg.id, vector: Array.from(out.data) });
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, message: String(err && err.message || err) });
    }
  }
};
`;

  /** @type {Worker|null} */ let worker = null;
  /** @type {string|null} */ let workerUrl = null;
  /** @type {'loading'|'model'|'demo'} */ let mode = 'loading';
  /** @type {Promise|null} */ let loadPromise = null;
  /** @type {number} */ let nextId = 0;
  /** @type {number} */ let lastPct = 0;
  /** @type {Map<number,{resolve:Function,timer:number,text:string}>} */ const pending = new Map();
  /** @type {Function[]} */ const progressFns = [];
  /** LRU-кэш «текст → вектор». @type {Map<string,Float32Array>} */ const cache = new Map();

  function emitStatus() {
    try { bus.emit('ai:status', { mode, percent: lastPct }); } catch (_) {}
  }

  /**
   * Детерминированный hash-эмбеддинг (FNV-1a по токенам). Fallback, когда
   * модели нет: низкое качество, но мгновенно, стабильно и без сети.
   * @param {string} text
   * @returns {Float32Array} Нормализованный вектор размерности dim.
   */
  function hashEmbed(text) {
    const DIM = Config.get('dim', 384);
    const vec = new Float32Array(DIM);
    const tokens = (text || '').toLowerCase().match(/[a-zа-яё0-9]+/gi) || [];
    for (const tok of tokens) {
      let h = 2166136261;
      for (let i = 0; i < tok.length; i++) { h ^= tok.charCodeAt(i); h = Math.imul(h, 16777619); }
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

  /** LRU: чтение освежает позицию. @param {string} key */
  function cacheGet(key) {
    if (!cache.has(key)) return undefined;
    const v = cache.get(key);
    cache.delete(key); cache.set(key, v);
    return v;
  }
  /** LRU: вытесняет самый старый при переполнении. */
  function cacheSet(key, v) {
    if (cache.has(key)) cache.delete(key);
    else if (cache.size >= Config.get('aiCacheLimit', 300)) cache.delete(cache.keys().next().value);
    cache.set(key, v);
  }

  /** Завершает Worker, разрешает зависшие embed'ы hash-fallback'ом. */
  function cleanup() {
    pending.forEach(p => {
      clearTimeout(p.timer);
      const v = hashEmbed(p.text);
      cacheSet(p.text, v);
      p.resolve(v);
    });
    pending.clear();
    if (worker) { try { worker.terminate(); } catch (_) {} worker = null; }
    if (workerUrl) { try { URL.revokeObjectURL(workerUrl); } catch (_) {} workerUrl = null; }
  }

  /**
   * Создаёт Worker и грузит модель. Резолвится по 'ready'; при любой ошибке
   * переводит в 'demo' и резолвится (не реджектит) — приложение продолжает жить.
   * @returns {Promise<void>}
   */
  function doLoad() {
    return new Promise(resolve => {
      if (typeof Worker === 'undefined') {
        mode = 'demo'; emitStatus();
        Logger.warn('Embedder: Worker не поддерживается, demo mode');
        return resolve();
      }
      try {
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        workerUrl = URL.createObjectURL(blob);
        worker = new Worker(workerUrl, { type: 'module' });
      } catch (err) {
        mode = 'demo'; emitStatus();
        Logger.warn('Embedder: не создать Worker, demo mode', String(err));
        return resolve();
      }

      worker.onerror = err => {
        Logger.warn('Embedder: ошибка Worker, demo mode', String(err && err.message || err));
        cleanup();
        mode = 'demo'; emitStatus();
        resolve();
      };

      worker.onmessage = e => {
        const msg = e.data;
        if (msg.type === 'progress') {
          lastPct = msg.pct;
          for (const fn of progressFns) { try { fn(msg.pct); } catch (_) {} }
          try { bus.emit('ai:progress', { pct: msg.pct }); } catch (_) {}
          try { bus.emit('ai:status', { mode: 'loading', percent: msg.pct }); } catch (_) {}
        } else if (msg.type === 'ready') {
          mode = 'model'; emitStatus();
          Logger.info('Embedder: модель готова');
          resolve();
        } else if (msg.type === 'error' && msg.id === null) {
          Logger.warn('Embedder: ошибка загрузки модели, demo mode', msg.message);
          cleanup();
          mode = 'demo'; emitStatus();
          resolve();
        } else if (msg.type === 'result') {
          const p = pending.get(msg.id);
          if (p) {
            clearTimeout(p.timer); pending.delete(msg.id);
            const vec = Float32Array.from(msg.vector);
            cacheSet(p.text, vec);
            p.resolve(vec);
          }
        } else if (msg.type === 'error' && msg.id != null) {
          const p = pending.get(msg.id);
          if (p) {
            clearTimeout(p.timer); pending.delete(msg.id);
            Logger.warn('Embedder: ошибка embed, hash fallback', msg.message);
            const v = hashEmbed(p.text);
            cacheSet(p.text, v);
            p.resolve(v);
          }
        }
      };

      worker.postMessage({ type: 'load', model: Config.get('model', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2') });
    });
  }

  return {
    /**
     * Запускает загрузку модели (идемпотентна). Повторные вызовы возвращают
     * тот же Promise. Ошибки не пробрасываются — уходим в 'demo'.
     * @param {Function} [onProgress] - (pct:number)=>void.
     * @returns {Promise<void>}
     */
    load(onProgress) {
      if (typeof onProgress === 'function') progressFns.push(onProgress);
      if (mode === 'model' || mode === 'demo') return Promise.resolve();
      if (loadPromise) return loadPromise;
      mode = 'loading'; emitStatus();
      loadPromise = doLoad().then(() => { loadPromise = null; });
      return loadPromise;
    },

    /**
     * Вектор для текста. Кэш → Worker → hash-fallback. Пустой текст → null.
     * @param {string} text
     * @returns {Promise<Float32Array|null>}
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

    /** Готова ли векторизация (модель или demo). @returns {boolean} */
    ready() { return mode === 'model' || mode === 'demo'; },

    /** Текущий режим. @returns {'loading'|'model'|'demo'} */
    getMode() { return mode; },

    /** Подписка на прогресс загрузки. @param {Function} fn */
    onProgress(fn) { if (typeof fn === 'function') progressFns.push(fn); },
  };
}, ['Config', 'EventBus', 'Logger']);
// ─── AI/Embedder ─── END ─────────────────────────────────────
