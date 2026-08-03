// ─── DATA/DB ─── START ───────────────────────────────────────
/**
 * Персистентное хранилище: IndexedDB с прозрачным in-memory fallback.
 *
 * Два объектных хранилища:
 *   notes — заметки пользователя {id,text,vector,shared,parentId?,parentPubkey?,createdAt,updatedAt,eventId?};
 *   cache — принятые из сети заметки (их id = Nostr eventId).
 *
 * Мутации notes эмитят 'db:change', мутации cache — 'db:cache'
 * (по ним инвалидируются Feed/Influence/Provenance).
 * cacheDel нужен NetService для kind-5 (NIP-09) удаления из кэша.
 *
 * @deps Config, EventBus, Logger
 * @exports DB
 */
DI.register('DB', function (Config, bus, Logger) {
  /** @type {IDBDatabase|null} */ let db = null;
  /** @type {Map|null} */ let mem = null;        // fallback: notes
  /** @type {Map|null} */ let memCache = null;   // fallback: cache
  /** @type {Promise|null} */ let openPromise = null;

  const NOTES = () => Config.get('storeName', 'notes');
  const CACHE = () => Config.get('cacheStoreName', 'cache');

  function emitChange() { try { bus.emit('db:change'); } catch (_) {} }
  function emitCache()  { try { bus.emit('db:cache'); } catch (_) {} }

  /**
   * Открывает IDB (создаёт хранилища при первом запуске).
   * При недоступности — in-memory fallback. Кэширует результат.
   * @returns {Promise<IDBDatabase|null>}
   */
  function open() {
    if (openPromise) return openPromise;
    openPromise = new Promise(resolve => {
      if (!window.indexedDB) {
        mem = new Map(); memCache = new Map();
        Logger.warn('DB: IndexedDB недоступен, in-memory fallback');
        return resolve(null);
      }
      try {
        const req = indexedDB.open(Config.get('dbName', 'noomium_v2'), 1);
        req.onupgradeneeded = e => {
          const d = e.target.result;
          if (!d.objectStoreNames.contains(NOTES())) d.createObjectStore(NOTES(), { keyPath: 'id' });
          if (!d.objectStoreNames.contains(CACHE())) d.createObjectStore(CACHE(), { keyPath: 'id' });
        };
        req.onsuccess = e => { db = e.target.result; resolve(db); };
        req.onerror = () => { mem = new Map(); memCache = new Map(); Logger.warn('DB: ошибка открытия, fallback'); resolve(null); };
        req.onblocked = () => { mem = new Map(); memCache = new Map(); Logger.warn('DB: open blocked, fallback'); resolve(null); };
      } catch (err) {
        mem = new Map(); memCache = new Map();
        Logger.warn('DB: не поддерживается, fallback', String(err));
        resolve(null);
      }
    });
    return openPromise;
  }

  /**
   * Обёртка: выполняет операцию над store, возвращает Promise.
   * В fallback-режиме синхронно работает с Map.
   * @param {string} store - Имя хранилища.
   * @param {'readonly'|'readwrite'} mode
   * @param {function(Object):Object} fn - (store) => IDBRequest.
   * @param {Function} memFn - fallback на Map.
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
        } catch (e) { rej(e); }
      });
    });
  }

  // ── NOTES ──

  /**
   * Создаёт/обновляет заметку. Эмитит db:change.
   * @param {Object} note - С обязательным id.
   * @returns {Promise<*>}
   */
  function put(note) {
    return withStore(NOTES(), 'readwrite', s => s.put(note), () => { mem.set(note.id, note); return note.id; })
      .then(res => { emitChange(); return res; });
  }

  /**
   * Читает заметку по id.
   * @param {string} id
   * @returns {Promise<Object|undefined>}
   */
  function get(id) {
    return withStore(NOTES(), 'readonly', s => s.get(id), () => mem.get(id));
  }

  /**
   * Удаляет заметку. Эмитит db:change.
   * @param {string} id
   * @returns {Promise<*>}
   */
  function del(id) {
    return withStore(NOTES(), 'readwrite', s => s.delete(id), () => { mem.delete(id); })
      .then(res => { emitChange(); return res; });
  }

  /**
   * Все заметки.
   * @returns {Promise<Object[]>}
   */
  function all() {
    return withStore(NOTES(), 'readonly', s => s.getAll(), () => Array.from(mem.values()));
  }

  /**
   * Количество заметок.
   * @returns {Promise<number>}
   */
  function count() {
    return withStore(NOTES(), 'readonly', s => s.count(), () => mem.size);
  }

  /**
   * Порция заметок через курсор (экономит память на больших базах).
   * @param {number} offset - Пропустить.
   * @param {number} limit - Взять.
   * @returns {Promise<Object[]>}
   */
  function getAllPaginated(offset, limit) {
    return open().then(d => {
      if (!d) return Array.from(mem.values()).slice(offset, offset + limit);
      return new Promise((res, rej) => {
        const r = d.transaction(NOTES(), 'readonly').objectStore(NOTES()).openCursor();
        const out = [];
        let skipped = 0;
        r.onsuccess = e => {
          const cur = e.target.result;
          if (!cur || out.length >= limit) return res(out);
          if (skipped < offset) { skipped++; cur.continue(); return; }
          out.push(cur.value);
          cur.continue();
        };
        r.onerror = () => rej(r.error);
      });
    });
  }

  /**
   * Массовая запись в одной транзакции (импорт). Эмитит db:change.
   * @param {Object[]} notes
   * @returns {Promise<number>} Число записанных.
   */
  function bulkPut(notes) {
    return open().then(d => {
      if (!d) { notes.forEach(n => mem.set(n.id, n)); return notes.length; }
      return new Promise((res, rej) => {
        const t = d.transaction(NOTES(), 'readwrite');
        const s = t.objectStore(NOTES());
        notes.forEach(n => s.put(n));
        t.oncomplete = () => res(notes.length);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    }).then(n => { emitChange(); return n; });
  }

  /**
   * Полная очистка обеих stores (danger zone). Эмитит db:change.
   * @returns {Promise<void>}
   */
  function reset() {
    return open().then(d => {
      if (!d) { mem.clear(); memCache.clear(); return; }
      return new Promise((res, rej) => {
        const t = d.transaction([NOTES(), CACHE()], 'readwrite');
        t.objectStore(NOTES()).clear();
        t.objectStore(CACHE()).clear();
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
      });
    }).then(() => { emitChange(); });
  }

  // ── CACHE (сетевые заметки) ──

  /** @param {Object} note @returns {Promise<*>} */
  function cachePut(note) {
    return withStore(CACHE(), 'readwrite', s => s.put(note), () => { memCache.set(note.id, note); return note.id; })
      .then(res => { emitCache(); return res; });
  }
  /** @param {string} id @returns {Promise<Object|undefined>} */
  function cacheGet(id) {
    return withStore(CACHE(), 'readonly', s => s.get(id), () => memCache.get(id));
  }
  /** @returns {Promise<Object[]>} */
  function cacheAll() {
    return withStore(CACHE(), 'readonly', s => s.getAll(), () => Array.from(memCache.values()));
  }
  /**
   * Удаляет заметку из кэша (для kind-5 удаления). Эмитит db:cache.
   * @param {string} id
   * @returns {Promise<*>}
   */
  function cacheDel(id) {
    return withStore(CACHE(), 'readwrite', s => s.delete(id), () => { memCache.delete(id); })
      .then(res => { emitCache(); return res; });
  }
  /** @returns {Promise<void>} */
  function cacheClear() {
    return withStore(CACHE(), 'readwrite', s => s.clear(), () => { memCache.clear(); })
      .then(res => { emitCache(); return res; });
  }

  return { put, get, del, all, count, getAllPaginated, bulkPut, reset, cachePut, cacheGet, cacheAll, cacheDel, cacheClear };
}, ['Config', 'EventBus', 'Logger']);
// ─── DATA/DB ─── END ─────────────────────────────────────────
