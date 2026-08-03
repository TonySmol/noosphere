// ─── DOMAIN/Provenance ─── START ─────────────────────────────
/**
 * Граф «по мотивам»: parent-связи между заметками (свои + сетевые).
 * Читает DB (свои) и DB.cache (сетевые), строит связи по parentId.
 *  - children(id)    — прямые дети (вниз).
 *  - descendants(id) — все потомки рекурсивно (вниз).
 *  - ancestors(id)   — цепочка предков вверх (мама → бабушка → … до корня).
 * При поиске индексирует заметки и по id, и по eventId (свои дети ссылаются
 * на id, чужие — на eventId).
 * @deps DB
 * @exports Provenance
 */
DI.register('Provenance', function (DB) {
  /**
   * Все заметки (свои + сетевые) одним списком.
   * @returns {Promise<Object[]>}
   */
  function loadAll() {
    return Promise.all([DB.all(), DB.cacheAll()]).then(([own, cached]) => own.concat(cached));
  }

  /**
   * Прямые дети заметки (заметки с parentId = id).
   * @param {string} id
   * @returns {Promise<Object[]>}
   */
  function children(id) {
    if (!id) return Promise.resolve([]);
    return loadAll().then(all => all.filter(n => n && n.parentId === id));
  }

  /**
   * Все потомки (рекурсивно, BFS), без циклов.
   * @param {string} id
   * @returns {Promise<Object[]>}
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
   * Цепочка предков заметки вверх по parentId: от непосредственного родителя
   * к корню. Останавливается, если родитель не найден или обнаружен цикл.
   * @param {string} id
   * @returns {Promise<Object[]>} Массив предков [мама, бабушка, ...].
   */
  function ancestors(id) {
    if (!id) return Promise.resolve([]);
    return loadAll().then(all => {
      const byId = new Map();
      all.forEach(n => {
        if (n) {
          if (n.id) byId.set(n.id, n);
          if (n.eventId) byId.set(n.eventId, n);
        }
      });
      const chain = [];
      const seen = new Set();
      let current = byId.get(id);
      while (current && current.parentId) {
        if (seen.has(current.parentId)) break;      // защита от цикла
        seen.add(current.parentId);
        const parent = byId.get(current.parentId);
        if (!parent) break;                          // предок не загружен
        chain.push(parent);
        current = parent;
      }
      return chain;
    });
  }

  return { children, descendants, ancestors, loadAll };
}, ['DB']);
// ─── DOMAIN/Provenance ─── END ───────────────────────────────
