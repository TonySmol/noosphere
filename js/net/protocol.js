// ─── NET/Protocol ─── START ──────────────────────────────────
/**
 * Контракт событий NOOmium поверх Nostr. Чистые функции encode/decode/validate.
 *
 *   NOTE   = kind 1 (regular, хранится релеями): content = текст;
 *            теги ['t',room], ['v',b64-вектор], ['parent',id,pubkey]?.
 *   QUERY  = kind 21000 (ephemeral): content = JSON {vector, maxResponses, window}.
 *   ANSWER = kind 21001 (ephemeral): content = JSON {noteId, text, vector, score};
 *            тег ['e', queryId] — привязка к запросу.
 *   DELETE = kind 5 (NIP-09): теги ['e', eventId...] — просьба релеям удалить
 *            события; ['t',room] — чтобы попадал в комнатный фильтр подписки.
 *
 * Вектор в событиях — компактный base64 (Int16) от Float32Array.
 * @deps Config, Vec
 * @exports Protocol
 */
DI.register('Protocol', function (Config, Vec) {
  /**
   * Ищет тег по имени.
   * @param {Array} tags @param {string} name
   * @returns {Array|null}
   */
  function findTag(tags, name) {
    if (!Array.isArray(tags)) return null;
    for (const t of tags) if (Array.isArray(t) && t[0] === name) return t;
    return null;
  }

  /**
   * Шаблон события-заметки (для подписи и публикации).
   * @param {{id?:string,text:string,vector:*,shared?:boolean,parentId?:string,parentPubkey?:string,createdAt?:number}} note
   * @param {string} room
   * @returns {Object} Шаблон Nostr-события (без id/sig).
   */
  function noteEvent(note, room) {
    const tags = [['t', room]];
    if (note.vector) tags.push(['v', Vec.toB64(note.vector)]);
    if (note.parentId) tags.push(['parent', note.parentId, note.parentPubkey || '']);
    return {
      kind: Config.get('kNote', 1),
      created_at: Math.floor((note.createdAt || Date.now()) / 1000),
      tags,
      content: note.text || '',
    };
  }

  /**
   * Разбирает событие-заметку из сети.
   * @param {Object} ev - Подписанное событие.
   * @returns {Object|null} Заметка (shared=true, authorPubkey из ev.pubkey).
   */
  function decodeNote(ev) {
    if (!ev || ev.kind !== Config.get('kNote', 1)) return null;
    const vTag = findTag(ev.tags, 'v');
    const pTag = findTag(ev.tags, 'parent');
    return {
      id: ev.id,
      text: ev.content || '',
      vector: vTag ? Vec.fromB64(vTag[1]) : null,
      shared: true,
      authorPubkey: ev.pubkey,
      parentId: pTag ? pTag[1] : null,
      parentPubkey: pTag ? (pTag[2] || null) : null,
      createdAt: (ev.created_at || 0) * 1000,
    };
  }

  /**
   * Шаблон поискового запроса.
   * @param {Float32Array|number[]} vector
   * @param {number} maxResponses
   * @param {number} window - мс
   * @returns {Object}
   */
  function queryEvent(vector, maxResponses, window) {
    return {
      kind: Config.get('kQuery', 21000),
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', Config.get('room', 'noomium-main')]],
      content: JSON.stringify({ vector: Array.from(vector), maxResponses, window }),
    };
  }

  /**
   * Разбирает поисковый запрос (с валидацией вектора).
   * @param {Object} ev
   * @returns {{vector:number[],maxResponses:number,window:number,authorPubkey:string,queryId:string}|null}
   */
  function decodeQuery(ev) {
    if (!ev || ev.kind !== Config.get('kQuery', 21000)) return null;
    let data;
    try { data = JSON.parse(ev.content); } catch (_) { return null; }
    if (!data || !Array.isArray(data.vector) || !data.vector.length) return null;
    for (const x of data.vector) if (typeof x !== 'number' || !isFinite(x)) return null;
    return {
      vector: data.vector,
      maxResponses: typeof data.maxResponses === 'number' ? data.maxResponses : Config.get('maxResponses', 8),
      window: typeof data.window === 'number' ? data.window : Config.get('responseWindow', 6000),
      authorPubkey: ev.pubkey,
      queryId: ev.id,
    };
  }

  /**
   * Шаблон ответа на запрос.
   * @param {{id:string,text:string,vector:*}} note
   * @param {number} score
   * @param {string} queryId - id запроса (тег e).
   * @param {string} room
   * @returns {Object}
   */
  function answerEvent(note, score, queryId, room) {
    return {
      kind: Config.get('kAnswer', 21001),
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', room], ['e', queryId]],
      content: JSON.stringify({
        noteId: note.id,
        text: note.text,
        vector: note.vector ? Array.from(note.vector) : null,
        score,
      }),
    };
  }

  /**
   * Разбирает ответ (с валидацией и защитой от огромного текста).
   * @param {Object} ev
   * @returns {{id:string,queryId:string,noteId:string,text:string,vector:number[]|null,score:number,authorPubkey:string,createdAt:number}|null}
   */
  function decodeAnswer(ev) {
    if (!ev || ev.kind !== Config.get('kAnswer', 21001)) return null;
    const eTag = findTag(ev.tags, 'e');
    if (!eTag) return null;
    let data;
    try { data = JSON.parse(ev.content); } catch (_) { return null; }
    if (!data || typeof data.text !== 'string') return null;
    if (data.text.length > Config.get('maxAnswerTextLength', 10000)) return null;
    let vector = null;
    if (Array.isArray(data.vector)) {
      for (const x of data.vector) if (typeof x !== 'number' || !isFinite(x)) return null;
      vector = data.vector;
    }
    return {
      id: ev.id,
      queryId: eTag[1],
      noteId: data.noteId || ev.id,
      text: data.text,
      vector,
      score: typeof data.score === 'number' ? data.score : 0,
      authorPubkey: ev.pubkey,
      createdAt: (ev.created_at || 0) * 1000,
    };
  }

  /**
   * Шаблон события удаления (NIP-09, kind 5). Ссылается на удаляемые события
   * тегами ['e', eventId]; тег ['t', room] нужен, чтобы событие попало в
   * комнатный фильтр подписки и другие участники его получили.
   * @param {string|string[]} eventIds - Один id или массив id удаляемых событий.
   * @param {string} room
   * @returns {Object|null} Шаблон, либо null если нет валидных id.
   */
  function deleteEvent(eventIds, room) {
    const ids = Array.isArray(eventIds) ? eventIds : [eventIds];
    const tags = ids.filter(Boolean).map(id => ['e', id]);
    if (!tags.length) return null;
    if (room) tags.push(['t', room]);
    return {
      kind: Config.get('kDelete', 5),
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: '',
    };
  }

  /**
   * Разбирает событие удаления (NIP-09). Возвращает список id, которые просят
   * удалить. Используется NetService, чтобы вычистить их из кэша (DB.cacheDel).
   * @param {Object} ev
   * @returns {{eventIds:string[], authorPubkey:string}|null}
   */
  function decodeDelete(ev) {
    if (!ev || ev.kind !== Config.get('kDelete', 5)) return null;
    const eTags = (ev.tags || []).filter(t => Array.isArray(t) && t[0] === 'e' && t[1]);
    if (!eTags.length) return null;
    return {
      eventIds: eTags.map(t => t[1]),
      authorPubkey: ev.pubkey,
    };
  }

  return { noteEvent, decodeNote, queryEvent, decodeQuery, answerEvent, decodeAnswer, deleteEvent, decodeDelete };
}, ['Config', 'Vec']);
// ─── NET/Protocol ─── END ────────────────────────────────────
