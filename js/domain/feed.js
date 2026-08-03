// ─── DOMAIN/Feed ─── START ───────────────────────────────────
/**
 * Готовит данные ленты под текущий режим.
 *
 *  - view  (контекста нет): свежая хронология — свои + сетевые заметки, feed[].
 *  - автор (контекст есть): ранжирование по вектору контекста → lists
 *    {local: свои релевантные, world: чужие релевантные, seren: озарения}.
 *
 * Источники: DB (свои) + DB.cache (сетевые). Обновляется по смене контекста
 * и по db:change/db:cache. Защищён от гонки sequence-номером: устаревшие
 * результаты не затирают свежие. Резонанс здесь НЕ считается (это Influence,
 * его рисует FeedView) — поэтому на influence:updated Feed не подписан.
 *
 * @deps DB, Ranker, Store, EventBus, Logger
 * @exports Feed
 */
DI.register('Feed', function (DB, Ranker, Store, bus, Logger) {
  /** Sequence-номер для отсечения устаревших асинхронных результатов. @type {number} */
  let seq = 0;
  /** Функции отписки (для destroy). @type {Function[]} */
  let unsubs = [];

  /**
   * Пересобирает данные ленты под текущий контекст.
   * @returns {Promise<void>}
   */
  function refresh() {
    const my = ++seq;
    const ctx = Store.get('context');

    return Promise.all([DB.all(), DB.cacheAll()]).then(([local, cached]) => {
      if (my !== seq) return;

      // ── Режим просмотра: хронология ──
      if (!ctx.source) {
        const merged = [
          ...local.map(n => Object.assign({}, n, { own: true })),
          ...cached.map(n => Object.assign({}, n, { own: false })),
        ].sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
        Store.setState({ feed: merged, lists: { local: [], world: [], seren: [] } });
        return;
      }

      // ── Режим автора, но вектор ещё считается — не дёргаем lists ──
      if (!ctx.vector) return;

      // ── Режим автора: ранжирование ──
      const items = [];
      const dataMap = new Map();
      for (const n of local) if (n && n.vector) {
        items.push({ id: n.id, vector: n.vector });
        dataMap.set(n.id, Object.assign({}, n, { own: true }));
      }
      for (const n of cached) if (n && n.vector) {
        items.push({ id: n.id, vector: n.vector });
        dataMap.set(n.id, Object.assign({}, n, { own: false }));
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
   * Подключает автообновление (контекст + изменения БД) и делает первый проход.
   */
  function init() {
    unsubs.push(Store.subscribe(s => s.context, () => refresh(), Store.shallowEqual));
    unsubs.push(bus.on('db:change', () => refresh()));
    unsubs.push(bus.on('db:cache', () => refresh()));
    refresh();
  }

  /** Отписывается от всего (для пересборки UI). */
  function destroy() {
    unsubs.forEach(u => { try { u(); } catch (_) {} });
    unsubs = [];
  }

  return { init, destroy, refresh };
}, ['DB', 'Ranker', 'Store', 'EventBus', 'Logger']);
// ─── DOMAIN/Feed ─── END ─────────────────────────────────────
