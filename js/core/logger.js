// ─── CORE/Logger ─── START ───────────────────────────────────
/**
 * Логгер с уровнями, цветным выводом и кольцевой историей.
 *
 * - Порог отбрасывает всё ниже уровня (debug < info < warn < error).
 * - Уровни подсвечены в консоли — логи читаются глазами, а не grep'ом.
 * - Кольцевой буфер хранит последние 200 записей ВСЕХ уровней (даже скрытых
 *   порогом): историю можно отмотать при разборе инцидента (history/dump).
 *
 * Фундамент: ни от кого не зависит. Порог из Config выставляет Boot.
 *
 * @exports Logger
 */
DI.register('Logger', function () {
  /** Числовые веса уровней. @readonly */
  const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

  /** Цвета уровней для консоли. @readonly */
  const COLORS = {
    debug: 'color:#56c2b8',
    info:  'color:#e8a33d',
    warn:  'color:#e5c156',
    error: 'color:#e5646e;font-weight:bold',
  };

  /** Текущий порог. @type {number} */
  let threshold = LEVELS.info;

  /** Кольцевой буфер. @type {Array<{ts:string,level:string,msg:string,data:*}>} */
  const ring = [];
  const RING_MAX = 200;

  /** Время HH:MM:SS.mmm. @returns {string} */
  const ts = () => new Date().toISOString().substr(11, 12);

  /**
   * Вывод в консоль + запись в буфер (буфер пишется ДО порога —
   * чтобы скрытые debug-записи всё равно попали в историю).
   * @param {string} level
   * @param {string} msg
   * @param {*} [data]
   */
  function write(level, msg, data) {
    const time = ts();
    ring.push({ ts: time, level, msg, data });
    if (ring.length > RING_MAX) ring.shift();

    if (LEVELS[level] < threshold) return;
    const fn = console[level] || console.log;
    const prefix = '%c[' + time + '][' + level.toUpperCase() + ']';
    if (data === undefined) fn(prefix, COLORS[level], msg);
    else fn(prefix, COLORS[level], msg, data);
  }

  return {
    /**
     * Устанавливает порог.
     * @param {'debug'|'info'|'warn'|'error'} l
     */
    setLevel(l) { if (LEVELS[l]) threshold = LEVELS[l]; },

    /** @param {string} m @param {*} [d] */ debug(m, d) { write('debug', m, d); },
    /** @param {string} m @param {*} [d] */ info(m, d)  { write('info', m, d); },
    /** @param {string} m @param {*} [d] */ warn(m, d)  { write('warn', m, d); },
    /** @param {string} m @param {*} [d] */ error(m, d) { write('error', m, d); },

    /** Копия истории (до 200 записей). @returns {Array} */
    history() { return ring.slice(); },

    /** Выводит всю историю в консоль — для разбора инцидентов. */
    dump() {
      for (const r of ring) {
        const fn = console[r.level] || console.log;
        fn('[' + r.ts + '][' + r.level.toUpperCase() + ']', r.msg, r.data === undefined ? '' : r.data);
      }
    },
  };
});
// ─── CORE/Logger ─── END ─────────────────────────────────────
