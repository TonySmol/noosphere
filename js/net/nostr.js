// ─── NET/Nostr ─── START ─────────────────────────────────────
/**
 * Транспорт Nostr: динамический импорт nostr-tools, ключи, SimplePool,
 * публикация/подписка. Низкий уровень — оркестрирует NetService.
 *
 * Публикация порелейная (ensureRelay → relay.publish): переживает отказ
 * отдельных рэлеев, резолвится по первому принявшему.
 *
 * Универсален по типам событий: одинаково возит kind 1 / 21000 / 21001 / 5,
 * поэтому для NIP-09 удаления менять здесь ничего не нужно.
 *
 * TODO(security): секретный ключ сейчас в localStorage открыто.
 * Шифрование PBKDF2+AES-GCM добавим отдельным срезом.
 *
 * @deps Config, EventBus, Logger
 * @exports Nostr
 */
DI.register('Nostr', function (Config, bus, Logger) {
  const CDN = 'https://cdn.jsdelivr.net/npm/nostr-tools@2.7.2/+esm';
  const SK_KEY = 'noomium:sk';

  let nostr = null;
  let pool = null;
  let sk = null;
  let pk = null;
  let initPromise = null;

  function loadKey() {
    try {
      const hex = localStorage.getItem(SK_KEY);
      if (hex && /^[0-9a-f]{64}$/i.test(hex)) {
        return new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
      }
    } catch (_) {}
    return null;
  }
  function saveKey(key) {
    try {
      localStorage.setItem(SK_KEY, Array.from(key).map(b => b.toString(16).padStart(2, '0')).join(''));
    } catch (_) {}
  }

  /**
   * Грузит nostr-tools, создаёт/читает ключ и пул. Идемпотентна.
   * @returns {Promise<string>} hex pubkey.
   */
  function init() {
    if (initPromise) return initPromise;
    initPromise = import(CDN).then(mod => {
      nostr = (typeof mod.generateSecretKey === 'function')
        ? mod
        : (mod.default && typeof mod.default.generateSecretKey === 'function' ? mod.default : mod);
      if (typeof nostr.generateSecretKey !== 'function') throw new Error('nostr-tools: несовместимый модуль');

      sk = loadKey();
      if (!sk) { sk = nostr.generateSecretKey(); saveKey(sk); }
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

  /** @returns {string[]} Релеи из Config. */
  function relays() { return Config.get('relays', []); }

  /**
   * Подписывает шаблон (без публикации) — узнать id заранее.
   * @param {Object} template
   * @returns {Object} Подписанное событие.
   */
  function sign(template) {
    if (!nostr || !sk) throw new Error('Nostr not ready');
    return nostr.finalizeEvent(template, sk);
  }

  /**
   * Публикует событие порелейно. Резолвится по первому принявшему рэлею,
   * реджектит только если отказали все. Отдельные таймауты не роняют общее.
   * @param {Object} template
   * @returns {Promise<Object>} Подписанное событие.
   */
  function publish(template) {
    let ev;
    try { ev = sign(template); } catch (e) { return Promise.reject(e); }
    if (!pool) return Promise.reject(new Error('Nostr not ready'));
    const urls = relays();
    if (!urls.length) return Promise.reject(new Error('no relays configured'));
    return new Promise((resolve, reject) => {
      let settled = false;
      let failures = 0;
      urls.forEach(url => {
        pool.ensureRelay(url)
          .then(relay => relay.publish(ev))
          .then(() => { if (!settled) { settled = true; resolve(ev); } })
          .catch(err => {
            failures++;
            Logger.warn('Nostr: релей ' + url + ' не принял', String(err && err.message || err));
            if (!settled && failures === urls.length) { settled = true; reject(new Error('no relay accepted')); }
          });
      });
    });
  }

  /**
   * Подписка на многих релеях. Универсальна по kind (включая kind 5).
   * @param {Object[]} filters
   * @param {{onevent?:Function,onclose?:Function}} handlers
   * @returns {Object|null} Подписка с close().
   */
  function subscribe(filters, handlers) {
    if (!pool) return null;
    return pool.subscribeMany(relays(), filters, handlers);
  }

  /**
   * Доступ к конкретному релею (для NetService при надобности).
   * @param {string} url
   * @returns {Promise<Object>}
   */
  function ensureRelay(url) {
    if (!pool) return Promise.reject(new Error('Nostr not ready'));
    return pool.ensureRelay(url);
  }

  function getPubkey() { return pk; }
  function isReady() { return !!(nostr && sk && pool); }
  function close() {
    if (pool && typeof pool.close === 'function') { try { pool.close(relays()); } catch (_) {} }
  }

  return { init, sign, publish, subscribe, ensureRelay, getPubkey, isReady, relays, close };
}, ['Config', 'EventBus', 'Logger']);
// ─── NET/Nostr ─── END ───────────────────────────────────────
