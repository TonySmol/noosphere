// ─── CORE/Utils ─── START ────────────────────────────────────
/**
 * Чистые утилиты без зависимостей: экранирование, плюрализация,
 * форматирование дат, генерация id, debounce.
 * @exports Utils
 */
DI.register('Utils', function () {
  /** Таблица HTML-экранирования. @readonly */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /**
   * Экранирует HTML-спецсимволы для безопасной вставки в DOM.
   * @param {*} s - Любое значение (приводится к строке; null/undefined → '').
   * @returns {string}
   */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]); }

  /**
   * Экранирует спецсимволы регулярных выражений.
   * @param {*} s
   * @returns {string} Строка, безопасная для new RegExp().
   */
  function escRe(s) { return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /**
   * Русская плюрализация.
   * @param {number} n
   * @param {string} one - «мысль»
   * @param {string} few - «мысли»
   * @param {string} many - «мыслей»
   * @returns {string}
   */
  function plural(n, one, few, many) {
    n = Math.abs(n); const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
    return many;
  }

  /** Генераторы строк «N сущность» по языкам. @readonly */
  const words = {
    symbols:     (n, l) => n + ' ' + (l === 'en' ? plural(n, 'char', 'chars', 'chars') : plural(n, 'символ', 'символа', 'символов')),
    peers:       (n, l) => n + ' ' + (l === 'en' ? plural(n, 'peer', 'peers', 'peers')  : plural(n, 'узел', 'узла', 'узлов')),
    thoughts:    (n, l) => n + ' ' + (l === 'en' ? plural(n, 'note', 'notes', 'notes')  : plural(n, 'мысль', 'мысли', 'мыслей')),
    descendants: (n, l) => n + ' ' + (l === 'en' ? plural(n, 'heir', 'heirs', 'heirs')  : plural(n, 'потомок', 'потомка', 'потомков')),
  };

  /**
   * «N сущностей» на нужном языке.
   * @param {string} key - 'symbols' | 'peers' | 'thoughts' | 'descendants'.
   * @param {number} n
   * @param {string} lang - 'ru' | 'en'.
   * @returns {string}
   */
  function word(key, n, lang) { const fn = words[key]; return fn ? fn(n, lang) : String(n); }

  /**
   * Короткая дата («05 июн.»).
   * @param {number} ts - Timestamp, мс.
   * @param {string} lang
   * @returns {string} '' при ошибке.
   */
  function fmtDate(ts, lang) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', { day: '2-digit', month: 'short' }); }
    catch (_) { return ''; }
  }

  /**
   * Короткое время («14:30»).
   * @param {number} ts - Timestamp, мс.
   * @param {string} lang
   * @returns {string} '' при ошибке.
   */
  function fmtTime(ts, lang) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString(lang === 'en' ? 'en-US' : 'ru-RU', { hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return ''; }
  }

  /**
   * Короткий pubkey для UI («8a3f9c21…»).
   * @param {string} pk
   * @returns {string}
   */
  const shortPk = pk => (pk ? pk.slice(0, 8) + '…' : '');

  /**
   * Локальный уникальный id (не криптографический — для ключей в БД).
   * @param {string} [prefix='n']
   * @returns {string} Например 'nmd3k2x9f4a1'.
   */
  function uid(prefix) {
    return (prefix || 'n') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Debounce с возможностью отмены.
   * @param {Function} fn
   * @param {number} ms
   * @returns {Function & {cancel: Function}}
   */
  function debounce(fn, ms) {
    let timer = null;
    function debounced(...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fn(...args); }, ms);
    }
    debounced.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    return debounced;
  }

  return { esc, escRe, plural, word, fmtDate, fmtTime, shortPk, uid, debounce };
});
// ─── CORE/Utils ─── END ──────────────────────────────────────
