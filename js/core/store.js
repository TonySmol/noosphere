// ─── CORE/Store ─── START ────────────────────────────────────
/**
 * Единый источник истины для UI-состояния.
 *
 * Режим (просмотр/автор) НЕ хранится отдельным полем — выводится из
 * context.source методом mode(): source пуст → просмотр, иначе автор.
 * Хранимый mode пришлось бы синхронизировать вручную, выводимый не рассинхронится.
 * Тема — в Config (это настройка, а не UI-состояние).
 *
 * Контракт: getState() возвращает замороженный снимок верхнего уровня;
 * вложенные структуры меняем только через setState с НОВЫМ объектом.
 *
 * @example
 *   Store.subscribe(s => s.context.source, src => {
 *     segBar.classList.toggle('on', src === 'input' || src === 'drift');
 *   });
 *
 * @exports Store
 */
DI.register('Store', function () {
  /** Внутреннее состояние. @type {Object} */
  const state = {
    view: 'stream',          // 'stream' | 'base' — активный экран
    seg: 'local',            // 'local' | 'world' | 'seren' — активный сегмент (автор)
    context: { source: null, noteId: null, text: '', vector: null, pinText: null }, // source: null|'input'|'pin'|'drift'
    sendMode: 'private',     // 'private' | 'world' — куда публикуем
    sendLock: false,         // блокировка отправки (анти-дабл)
    lists: { local: [], world: [], seren: [] }, // результаты автор-режима
    feed: [],                // свежая лента режима просмотра
    netAuthorized: false,    // ключ сети загружен
  };
  /** Подписчики. @type {Function[]} */
  const listeners = [];

  /**
   * Поверхностное сравнение (для equals в subscribe).
   * @param {*} a @param {*} b @returns {boolean}
   */
  function shallowEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!Object.is(a[k], b[k])) return false;
    return true;
  }

  /** Замороженный снимок верхнего уровня. @returns {Object} */
  const snapshot = () => Object.freeze(Object.assign({}, state));

  /** Уведомляет подписчиков (копия списка + try/catch на каждого). */
  function notify() {
    const snap = snapshot();
    for (const l of listeners.slice()) { try { l(snap); } catch (e) { console.error('[store]', e); } }
  }

  /** @returns {Object} Замороженный снимок состояния. */
  const getState = () => snapshot();

  /**
   * Прямое чтение поля (для редких случаев; обычно — getState/subscribe).
   * @param {string} k @returns {*}
   */
  const get = k => state[k];

  /**
   * Частичное обновление + уведомление.
   * @param {Object} partial - Поля для слияния.
   */
  function setState(partial) {
    if (!partial || typeof partial !== 'object') return;
    Object.assign(state, partial);
    notify();
  }

  /**
   * Текущий режим — выводится из контекста.
   * @returns {'view'|'author'}
   */
  const mode = () => (state.context.source ? 'author' : 'view');

  /**
   * Подписка. Две формы:
   *   subscribe(fn) — на любое изменение, fn(snapshot);
   *   subscribe(selector, fn, equals?) — fn(selected, snapshot) только при
   *     изменении выбранного (по умолчанию Object.is; можно shallowEqual).
   * @param {Function} a - fn или selector.
   * @param {Function} [b] - listener (для формы с селектором).
   * @param {Function} [equals] - компаратор.
   * @returns {Function} Отписка.
   */
  function subscribe(a, b, equals) {
    if (typeof b === 'function') {
      const selector = a, listener = b, eq = equals || Object.is;
      let prev = selector(snapshot());
      const wrap = s => { const next = selector(s); if (!eq(next, prev)) { prev = next; listener(next, s); } };
      listeners.push(wrap);
      return () => { const i = listeners.indexOf(wrap); if (i > -1) listeners.splice(i, 1); };
    }
    listeners.push(a);
    return () => { const i = listeners.indexOf(a); if (i > -1) listeners.splice(i, 1); };
  }

  return { getState, get, setState, subscribe, mode, shallowEqual };
}, []);
// ─── CORE/Store ─── END ──────────────────────────────────────
