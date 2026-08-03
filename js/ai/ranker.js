// ─── AI/Ranker ─── START ─────────────────────────────────────
/**
 * Ранжирование по векторному сходству.
 *
 * Интерфейс Promise-based и стабилен: сейчас cosineBatch считается синхронно,
 * позже его можно заменить на GPU/Worker-реализацию (Config.gpuRanking),
 * не трогая вызывающий код.
 *
 * @deps Vec, Config
 * @exports Ranker
 */
DI.register('Ranker', function (Vec, Config) {
  /**
   * Скорит массив элементов против вектора запроса, сортирует по убыванию.
   * @param {Float32Array|number[]} queryVector
   * @param {Array<{id:string, vector:(Float32Array|number[])}>} items
   * @param {AbortSignal} [signal] - Отмена (проверяется между итерациями).
   * @returns {Promise<Array<{id:string, score:number}>>}
   */
  function cosineBatch(queryVector, items, signal) {
    if (!queryVector || !items || !items.length) return Promise.resolve([]);
    if (signal && signal.aborted) return Promise.reject(new Error('aborted'));
    const out = [];
    for (const it of items) {
      if (signal && signal.aborted) return Promise.reject(new Error('aborted'));
      out.push({ id: it.id, score: Vec.cosine(queryVector, it.vector) });
    }
    out.sort((a, b) => b.score - a.score);
    return Promise.resolve(out);
  }

  /**
   * Делит скорённые элементы на relevant (≥ threshold) и seren
   * (threshold−serendipity ≤ score < threshold). Всё, что ниже, — шум.
   * @param {Array<{id:string, score:number}>} scored
   * @returns {{relevant:Array, seren:Array}}
   */
  function split(scored) {
    const threshold = Config.get('threshold', 0.7);
    const serenMin = threshold - Config.get('serendipity', 0.3);
    const relevant = [], seren = [];
    for (const s of scored) {
      if (s.score >= threshold) relevant.push(s);
      else if (s.score >= serenMin) seren.push(s);
    }
    return { relevant, seren };
  }

  /**
   * «Это почти тот же вектор?» — для дедупликации запросов в сеть.
   * @param {Float32Array|number[]} a
   * @param {Float32Array|number[]} b
   * @returns {boolean}
   */
  function isSimilar(a, b) {
    return Vec.cosine(a, b) >= Config.get('vectorSimilarityThreshold', 0.98);
  }

  return { cosineBatch, split, isSimilar };
}, ['Vec', 'Config']);
// ─── AI/Ranker ─── END ───────────────────────────────────────
