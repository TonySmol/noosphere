// ─── DOMAIN/Context ─── START ────────────────────────────────
/**
 * Сердце режимов. Управляет активным контекстом, по которому Feed ранжирует ленту.
 *
 * Источники и приоритеты:
 *  - pin    — закреплена заметка, ввод пуст: контекст = пин.
 *  - drift  — есть и пин, и ввод (вектор ввода готов): контекст ВЕДЁТ введённый
 *             текст (дрейф от пина), пин остаётся якорем (баннер) и родителем
 *             при публикации. Вектор пина для ранжирования не используется.
 *  - input  — только ввод: контекст = ввод.
 *  - none   — просмотр.
 * Пока вектор ввода считается (debounce), при наличии пина лента остаётся на пине.
 *
 * Пишет в Store.context; подписчики (Feed, FeedView) реагируют сами.
 *
 * @deps Store, Embedder, Config, Utils
 * @exports Context
 */
DI.register('Context', function (Store, Embedder, Config, Utils) {
  /** @type {string} */ let inputText = '';
  /** @type {Float32Array|number[]|null} */ let inputVector = null;
  /** @type {{id:string,text:string,vector:*}|null} */ let pinNote = null;

  /**
   * Активный контекст. Пин + ввод = дрейф (ведёт ввод).
   * @returns {{source:(null|'input'|'pin'|'drift'), noteId:(string|null), text:string, vector:*, pinText:(string|null)}}
   */
  function activeContext() {
    const hasInput = !!inputText.trim();
    if (pinNote && hasInput) {
      return {
        source: 'drift',
        noteId: pinNote.id,
        text: inputText.trim(),
        vector: inputVector,            // null, пока вектор ввода не готов → лента на пине
        pinText: pinNote.text,
      };
    }
    if (pinNote) return { source: 'pin', noteId: pinNote.id, text: pinNote.text, vector: pinNote.vector };
    if (hasInput) return { source: 'input', noteId: null, text: inputText.trim(), vector: inputVector };
    return { source: null, noteId: null, text: '', vector: null, pinText: null };
  }

  /** Записывает активный контекст в Store. */
  function push() { Store.setState({ context: activeContext() }); }

  /**
   * Отложенный расчёт вектора ввода; если текст изменился — результат отбрасывается.
   */
  const debouncedEmbed = Utils.debounce(() => {
    const t = inputText.trim();
    if (!t) { inputVector = null; push(); return; }
    Embedder.embed(t).then(v => {
      if (inputText.trim() === t) { inputVector = v; push(); }
    });
  }, Config.get('debounce', 350));

  return {
    /** Обновляет текст ввода. @param {string} text */
    setInput(text) {
      inputText = text || '';
      if (!inputText.trim()) inputVector = null;
      push();
      debouncedEmbed();
    },

    /** Закрепляет заметку. @param {{id,text,vector}} note */
    setPin(note) {
      if (!note || !note.vector) return;
      pinNote = { id: note.id, text: note.text, vector: note.vector };
      push();
    },

    /** Снимает пин. */
    clearPin() { pinNote = null; push(); },

    /** Полный сброс (ввод + пин). */
    clear() {
      inputText = ''; inputVector = null; pinNote = null;
      debouncedEmbed.cancel();
      push();
    },

    /** Вектор активного контекста (или null). */
    getVector() { return activeContext().vector; },
    /** Снимок активного контекста. */
    getActive() { return activeContext(); },
    /** Закреплённая заметка (или null) — используется как родитель при публикации. */
    getPin() { return pinNote; },
  };
}, ['Store', 'Embedder', 'Config', 'Utils']);
// ─── DOMAIN/Context ─── END ──────────────────────────────────
