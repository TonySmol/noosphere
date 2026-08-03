// ─── DOMAIN/Influence ─── START ──────────────────────────────
/**
 * Резонанс заметки: сколько уникальных авторов породило её прямых детей.
 * Sybil-resistant: один человек не накрутит себе много, сколько бы детей ни создал.
 * Свои дети (authorPubkey=null) считаются одним автором «я».
 * Карта parentId→авторы строится асинхронно по db:change/db:cache; по
 * завершении эмитит 'influence:updated' (FeedView перерисовывает ◆).
 * @deps DB, EventBus, Logger
 * @exports Influence
 */
DI.register('Influence', function (DB, bus, Logger) {
  /** parentId -> Set авторов-детей. @type {Map<string,Set<string>>} */
  const resonanceMap = new Map();
  let seq = 0;

  /** Перестраивает карту резонанса из своих + сетевых заметок. */
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
   * Число уникальных авторов прямых детей заметки.
   * @param {string} id
   * @returns {number}
   */
  function resonance(id) {
    if (!id) return 0;
    const s = resonanceMap.get(id);
    return s ? s.size : 0;
  }

  function init() {
    bus.on('db:change', () => rebuild());
    bus.on('db:cache', () => rebuild());
    rebuild();
  }

  return { init, resonance, rebuild };
}, ['DB', 'EventBus', 'Logger']);
// ─── DOMAIN/Influence ─── END ────────────────────────────────
