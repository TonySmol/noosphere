// ─── DOMAIN/Notes ─── START ──────────────────────────────────
/**
 * Жизненный цикл заметок: создание, правка, удаление, переключение видимости.
 * Вектор считается при каждом сохранении текста. Вектор храним обычным массивом
 * (JSON-безопасно для экспорта/импорта); Vec/Ranker переваривают оба формата.
 *
 * Сеть сюда не знает: модуль эмитит 'note:created'/'note:updated'/'note:deleted',
 * NetService подпишется и сделает announce / forgetNote (NIP-09).
 * remove отдаёт в 'note:deleted' ПОЛНЫЙ объект заметки (включая eventId) — это
 * нужно NetService, чтобы опубликовать kind-5 удаление с рэлеев.
 *
 * @deps DB, Embedder, EventBus, Logger, Utils
 * @exports Notes
 */
DI.register('Notes', function (DB, Embedder, bus, Logger, Utils) {
  function emit(event, payload) { try { bus.emit(event, payload); } catch (_) {} }

  /**
   * Создаёт заметку, считая её вектор.
   * @param {string} text - Текст.
   * @param {'private'|'world'} mode - Видимость.
   * @param {string} [parentId] - id заметки-родителя («по мотивам»).
   * @returns {Promise<Object|null>} Созданная заметка или null (пустой текст).
   */
  function create(text, mode, parentId) {
    const t = (text || '').trim();
    if (!t) return Promise.resolve(null);
    return Embedder.embed(t).then(vector => {
      const note = {
        id: Utils.uid('n'),
        text: t,
        vector: vector ? Array.from(vector) : null,
        shared: mode === 'world',
        parentId: parentId || null,
        parentPubkey: null,
        createdAt: Date.now(),
      };
      return DB.put(note).then(() => { emit('note:created', note); return note; });
    });
  }

  /**
   * Правит текст заметки, пересчитывая вектор.
   * @param {string} id
   * @param {string} newText
   * @returns {Promise<Object|null>}
   */
  function edit(id, newText) {
    const t = (newText || '').trim();
    if (!t) return Promise.reject(new Error('empty text'));
    return DB.get(id).then(note => {
      if (!note) return null;
      return Embedder.embed(t).then(vector => {
        note.text = t;
        note.vector = vector ? Array.from(vector) : null;
        note.updatedAt = Date.now();
        return DB.put(note).then(() => { emit('note:updated', note); return note; });
      });
    });
  }

  /**
   * Удаляет заметку. Эмитит 'note:deleted' с ПОЛНЫМ объектом (включая eventId),
   * чтобы NetService мог опубликовать kind-5 удаление с рэлеев.
   * @param {string} id
   * @returns {Promise<Object|null>} Удалённая заметка или null.
   */
  function remove(id) {
    return DB.get(id).then(note => {
      if (!note) return null;
      return DB.del(id).then(() => { emit('note:deleted', note); return note; });
    });
  }

  /**
   * Переключает видимость (личное ↔ открытое).
   * @param {string} id
   * @returns {Promise<Object|null>} Обновлённая заметка.
   */
  function toggleShared(id) {
    return DB.get(id).then(note => {
      if (!note) return null;
      note.shared = !note.shared;
      return DB.put(note).then(() => {
        emit(note.shared ? 'note:shared' : 'note:unshared', note);
        return note;
      });
    });
  }

  /**
   * Читает заметку по id.
   * @param {string} id
   * @returns {Promise<Object|undefined>}
   */
  function get(id) { return DB.get(id); }

  return { create, edit, remove, toggleShared, get };
}, ['DB', 'Embedder', 'EventBus', 'Logger', 'Utils']);
// ─── DOMAIN/Notes ─── END ────────────────────────────────────
