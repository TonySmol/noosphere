// ─── CORE/EventBus ─── START ─────────────────────────────────
/**
 * Шина событий (pub/sub) — единственный канал «кто кому не друг».
 *
 * Подписчики вызываются в порядке подписки; ошибка одного не валит остальных.
 * Wildcard '*' получает (event, payload) для всех событий — удобно для отладки.
 * on() возвращает функцию отписки: держи её и вызывай в cleanup.
 *
 * @example
 *   const off = bus.on('note:created', note => render(note));
 *   bus.once('model:ready', () => start());
 *   bus.emit('note:created', { id: 'n1' });
 *   off();
 *
 * @exports EventBus
 */
DI.register('EventBus', function () {
  /** event -> Set<fn>. @type {Map<string, Set<Function>>} */
  const map = new Map();
  /** wildcard-слушатели. @type {Set<Function>} */
  const wild = new Set();

  /**
   * Подписывает обработчик.
   * @param {string} event - Имя события или '*'.
   * @param {Function} fn - (payload) для обычных; (event, payload) для '*'.
   * @returns {Function} Функция отписки.
   */
  function on(event, fn) {
    if (typeof fn !== 'function') return () => {};
    if (event === '*') { wild.add(fn); return () => wild.delete(fn); }
    if (!map.has(event)) map.set(event, new Set());
    map.get(event).add(fn);
    return () => {
      const s = map.get(event);
      if (s) { s.delete(fn); if (!s.size) map.delete(event); }
    };
  }

  /**
   * Подписка на одно срабатывание.
   * @param {string} event
   * @param {Function} fn
   * @returns {Function} Функция отписки (можно вызвать раньше).
   */
  function once(event, fn) {
    const off = on(event, (...a) => { off(); fn(...a); });
    return off;
  }

  /**
   * Отписка по ссылке (альтернатива вызову функции отписки).
   * @param {string} event
   * @param {Function} fn
   */
  function off(event, fn) {
    if (event === '*') { wild.delete(fn); return; }
    const s = map.get(event);
    if (s) { s.delete(fn); if (!s.size) map.delete(event); }
  }

  /**
   * Публикует событие. Список слушателей копируется до обхода,
   * чтобы отписка/подписка внутри обработчика не ломала итерацию.
   * @param {string} event - Имя события.
   * @param {*} [payload] - Данные.
   */
  function emit(event, payload) {
    const s = map.get(event);
    if (s) for (const fn of Array.from(s)) {
      try { fn(payload); } catch (e) { console.error('[bus:' + event + ']', e); }
    }
    if (wild.size) for (const fn of Array.from(wild)) {
      try { fn(event, payload); } catch (e) { console.error('[bus:*]', e); }
    }
  }

  return { on, once, off, emit };
});
// ─── CORE/EventBus ─── END ───────────────────────────────────
