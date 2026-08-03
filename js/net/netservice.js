// ─── NET/NetService ─── START ────────────────────────────────
/**
 * Оркестратор децентрализованного обмена.
 *
 *  - Подписка на комнату: заметки (kind 1), запросы (21000), ответы (21001),
 *    удаления (kind 5, NIP-09).
 *  - Анонсирует открытые заметки; после анонса сохраняет eventId.
 *  - На чужой запрос: центроидный префильтр → ранжирование → top-N ответов.
 *  - На пин шлёт запрос и собирает ответы в кеш.
 *  - loadHistory: расширяет окно подписки (история сети).
 *  - forgetNote: при удалении расшаренной заметки шлёт kind 5 (NIP-09),
 *    прося релеи удалить событие; другие участники, получив kind 5,
 *    вычищают заметку из кэша (DB.cacheDel) — метка резонанса гаснет.
 *
 * Переподключение защищено «эпохой» подписки (subEpoch): намеренное
 * закрытие подписки (например, в loadHistory) не ложится в статус reconnecting.
 *
 * Дедупликация: seen по ev.id + contentSeen по (автор+текст).
 * Нагрузочная устойчивость: rate-limit ответов, префильтр, лимит ответов,
 * ступенчатая отправка, переподключение.
 *
 * @deps Nostr, Protocol, DB, Ranker, Vec, Store, Config, Logger, EventBus
 * @exports NetService
 */
DI.register('NetService', function (Nostr, Protocol, DB, Ranker, Vec, Store, Config, Logger, bus) {
  let started = false;
  let subscription = null;
  let hbTimer = null;
  let activeQueryId = null;
  let lastQueryVec = null;
  let lastQueryTime = 0;
  let centroids = [];
  let contextUnsub = null;
  const seen = new Set();
  const contentSeen = new Map();
  const peers = new Map();
  const peerQueryTimes = new Map();

  // окно подписки и история
  let currentWindow = Config.get('subWindow', 300);
  let historyLoading = false;
  // «эпоха» подписки: отличает намеренное переподключение от обрыва
  let subEpoch = 0;

  const kNote = () => Config.get('kNote', 1);
  const kQuery = () => Config.get('kQuery', 21000);
  const kAnswer = () => Config.get('kAnswer', 21001);
  const kDelete = () => Config.get('kDelete', 5);
  const room = () => Config.get('room', 'noomium-main');

  function setStatus(s) { try { bus.emit('net:status', { status: s }); } catch (_) {} }
  function notifyPeers() { try { bus.emit('net:peers', { count: peers.size }); } catch (_) {} }
  function emitHistory(loading, windowSec) { try { bus.emit('net:history', { loading: loading, window: windowSec }); } catch (_) {} }

  function trimSeen() {
    const max = Config.get('seenMaxSize', 1000);
    if (seen.size <= max) return;
    const arr = Array.from(seen);
    seen.clear();
    for (let i = arr.length - Math.floor(max / 2); i < arr.length; i++) seen.add(arr[i]);
  }

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

  // ── центроидный префильтр ──
  function rebuildCentroids() {
    DB.all().then(notes => {
      const vecs = notes.filter(n => n.shared && n.vector).map(n => n.vector);
      if (!vecs.length) { centroids = []; return; }
      centroids = Vec.kmeans(vecs, Math.min(Config.get('centroidCount', 12), vecs.length), 8);
    }).catch(() => {});
  }
  function passesPrefilter(queryVector) {
    if (!centroids.length) return true;
    const floor = Config.get('threshold', 0.7) - 0.25;
    for (const c of centroids) if (Vec.cosine(queryVector, c) >= floor) return true;
    return false;
  }

  // ── входящие события ──
  function onEvent(ev) {
    if (!ev || seen.has(ev.id)) return;
    seen.add(ev.id);
    trimSeen();
    if (ev.pubkey === Nostr.getPubkey()) return;   // своё не обрабатываем

    if (ev.kind === kNote()) handleIncomingNote(ev);
    else if (ev.kind === kQuery()) handleIncomingQuery(ev);
    else if (ev.kind === kAnswer()) handleIncomingAnswer(ev);
    else if (ev.kind === kDelete()) handleIncomingDelete(ev);
  }

  function handleIncomingNote(ev) {
    const note = Protocol.decodeNote(ev);
    if (!note) return;
    if (isContentDuplicate(note.authorPubkey, note.text)) return;
    peers.set(note.authorPubkey, Date.now());
    DB.cachePut(note);
    notifyPeers();
  }

  function handleIncomingQuery(ev) {
    const q = Protocol.decodeQuery(ev);
    if (!q) return;
    const now = Date.now();
    const last = peerQueryTimes.get(ev.pubkey) || 0;
    if (now - last < Config.get('queryRateLimit', 3000)) return;   // rate-limit на пира
    peerQueryTimes.set(ev.pubkey, now);
    if (!passesPrefilter(q.vector)) return;

    DB.all().then(notes => {
      const candidates = notes.filter(n => n.shared && n.vector);
      if (!candidates.length) return null;
      const byId = new Map(candidates.map(n => [n.id, n]));
      const items = candidates.map(n => ({ id: n.id, vector: n.vector }));
      return Ranker.cosineBatch(q.vector, items).then(scored => {
        const top = scored
          .filter(s => s.score >= Config.get('threshold', 0.7))
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
  }

  function handleIncomingAnswer(ev) {
    const a = Protocol.decodeAnswer(ev);
    if (!a) return;
    if (a.queryId !== activeQueryId) return;   // ответ не на наш запрос
    if (isContentDuplicate(a.authorPubkey, a.text)) return;
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
  }

  /**
   * Входящее удаление (NIP-09): вычищаем указанные заметки из кэша.
   * DB.cacheDel эмитит db:cache → Feed/Influence/Provenance пересчитаются,
   * метка резонанса на родителе гаснет.
   */
  function handleIncomingDelete(ev) {
    const del = Protocol.decodeDelete(ev);
    if (!del) return;
    del.eventIds.forEach(eventId => {
      if (eventId) DB.cacheDel(eventId);
    });
    if (del.authorPubkey) peers.set(del.authorPubkey, Date.now());
    notifyPeers();
  }

  // ── анонс наших открытых заметок ──
  function announceNote(note) {
    if (!note || !note.shared || !note.vector) return;
    Nostr.publish(Protocol.noteEvent(note, room()))
      .then(ev => {
        Logger.info('NetService: анонс заметки ' + note.id);
        if (ev && ev.id && note.id) {
          DB.get(note.id).then(cur => {
            if (cur && cur.eventId !== ev.id) {
              cur.eventId = ev.id;
              DB.put(cur);
            }
          });
        }
      })
      .catch(e => Logger.warn('NetService: не анонсировать', String(e)));
  }

  /**
   * Просит релеи удалить событие заметки (kind 5, NIP-09). Best-effort:
   * поддерживают не все релеи, но это стандартный способ удаления.
   * @param {Object} note - заметка с eventId.
   */
  function forgetNote(note) {
    if (!note || !note.eventId) return;
    const ev = Protocol.deleteEvent(note.eventId, room());
    if (!ev) return;
    Nostr.publish(ev)
      .then(() => Logger.info('NetService: запрос удаления с рэлеев ' + note.id))
      .catch(e => Logger.warn('NetService: не удалить с рэлеев', String(e)));
  }

  // ── запрос при пине ──
  function maybeSendQuery() {
    const ctx = Store.get('context');
    if ((ctx.source !== 'pin' && ctx.source !== 'drift') || !ctx.vector) { lastQueryVec = null; return; }
    const now = Date.now();
    if (now - lastQueryTime < Config.get('queryRateLimit', 3000)) return;
    if (lastQueryVec && Ranker.isSimilar(lastQueryVec, ctx.vector)) return;
    lastQueryVec = ctx.vector;
    lastQueryTime = now;
    const tpl = Protocol.queryEvent(ctx.vector, Config.get('maxResponses', 8), Config.get('responseWindow', 6000));
    Nostr.publish(tpl)
      .then(ev => { activeQueryId = ev.id; Logger.info('NetService: запрос ' + ev.id.slice(0, 8) + '…'); })
      .catch(e => {
        lastQueryVec = null; lastQueryTime = 0;   // даём повторить
        Logger.warn('NetService: не отправить запрос', String(e));
      });
  }

  // ── подписка на комнату (с «эпохой» от ложных reconnect) ──
  function subscribeToRoom() {
    const since = Math.floor(Date.now() / 1000) - currentWindow;
    const filters = [{ kinds: [kNote(), kQuery(), kAnswer(), kDelete()], '#t': [room()], since }];
    const myEpoch = ++subEpoch;
    if (subscription && typeof subscription.close === 'function') { try { subscription.close(); } catch (_) {} }
    subscription = Nostr.subscribe(filters, {
      onevent: onEvent,
      onclose: () => {
        // устаревшая подписка (уже переподключились намеренно) — не дёргаем статус
        if (myEpoch !== subEpoch) return;
        setStatus('reconnecting');
        setTimeout(() => { if (started && myEpoch === subEpoch) subscribeToRoom(); }, Config.get('reconnectBaseDelay', 1000));
      },
    });
  }

  /**
   * Расширяет окно подписки, чтобы подтянуть старые заметки с рэлеев.
   * Каждый вызов увеличивает окно (×4), вплоть до historyMaxWindow.
   */
  function loadHistory() {
    if (!started || historyLoading) return;
    const maxWindow = Config.get('historyMaxWindow', 2592000); // 30 дней по умолчанию
    if (currentWindow >= maxWindow) { emitHistory(false, currentWindow); return; }
    historyLoading = true;
    emitHistory(true, currentWindow);
    currentWindow = Math.min(maxWindow, Math.max(currentWindow * 4, 86400));
    try {
      subscribeToRoom();
      Logger.info('NetService: окно истории → ' + currentWindow + 's');
    } finally {
      setTimeout(() => { historyLoading = false; emitHistory(false, currentWindow); }, 1200);
    }
  }

  // ── heartbeat ──
  function startHeartbeat() {
    if (hbTimer) clearInterval(hbTimer);
    hbTimer = setInterval(() => {
      const now = Date.now();
      const ttl = Config.get('peerTTL', 60000);
      let changed = false;
      peers.forEach((ts, pk) => { if (now - ts > ttl) { peers.delete(pk); changed = true; } });
      if (changed) notifyPeers();
      trimSeen();
    }, Config.get('heartbeat', 30000));
  }

  // ── lifecycle ──
  function start() {
    if (started) return Promise.resolve();
    return Nostr.init().then(() => {
      started = true;
      subscribeToRoom();
      bus.on('note:created', note => { if (note && note.shared) announceNote(note); });
      bus.on('note:shared', note => { if (note && note.shared) announceNote(note); });
      bus.on('note:deleted', note => { if (note && note.shared && note.eventId) forgetNote(note); });
      bus.on('db:change', () => rebuildCentroids());
      contextUnsub = Store.subscribe(s => s.context, () => maybeSendQuery());
      startHeartbeat();
      rebuildCentroids();
      setStatus('connected');
      Logger.info('NetService: запущен, комната #' + room());
    }).catch(e => {
      Logger.error('NetService: не стартовать', String(e && e.message || e));
      setStatus('failed');
    });
  }

  function stop() {
    started = false;
    if (subscription && typeof subscription.close === 'function') { try { subscription.close(); } catch (_) {} }
    subscription = null;
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
    if (contextUnsub) { try { contextUnsub(); } catch (_) {} contextUnsub = null; }
    peers.clear();
    seen.clear();
    contentSeen.clear();
    setStatus('disconnected');
  }

  return { start, stop, loadHistory };
}, ['Nostr', 'Protocol', 'DB', 'Ranker', 'Vec', 'Store', 'Config', 'Logger', 'EventBus']);
// ─── NET/NetService ─── END ─────────────────────────────────
