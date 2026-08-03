// ─── CORE/I18n ─── START ─────────────────────────────────────
/**
 * Интернационализация: словари ru/en, подстановка {param}, fallback-цепочка
 * «текущий язык → en → fallback → сам ключ». Язык автодетектится, персистится
 * в Config, смена транслируется через шину ('i18n:change') и onChange-колбэки.
 *
 * Все ключи приложения собраны здесь единым словарём — разбрасывать addDict
 * по модулям не нужно (он оставлен на случай расширений).
 *
 * @deps Config, EventBus
 * @exports I18n
 */
DI.register('I18n', function (Config, bus) {
  /** Словари по языкам. @type {Object<string, Object<string,string>>} */
  const dicts = Object.create(null);
  /** onChange-подписчики. @type {Function[]} */
  const listeners = [];
  /** Текущий язык. @type {'ru'|'en'} */
  let current = 'ru';

  // Автодетект: сохранённый → язык браузера → ru.
  const saved = Config.get('lang', null);
  if (saved === 'ru' || saved === 'en') current = saved;
  else current = (navigator.language || 'ru').toLowerCase().indexOf('ru') === 0 ? 'ru' : 'en';

  /**
   * Подставляет {param} из объекта.
   * @param {string} str
   * @param {Object<string,*>} [params]
   * @returns {string}
   */
  function format(str, params) {
    const s = String(str == null ? '' : str);
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
  }

  /**
   * Перевод по ключу.
   * @param {string} key
   * @param {Object<string,*>} [params] - Подстановки {p}.
   * @param {string} [fallback] - Если ключа нет ни в одном словаре.
   * @returns {string}
   */
  function t(key, params, fallback) {
    const d = dicts[current] || {};
    let val = Object.prototype.hasOwnProperty.call(d, key) ? d[key] : undefined;
    if (val === undefined) {
      const en = dicts['en'] || {};
      val = Object.prototype.hasOwnProperty.call(en, key) ? en[key] : undefined;
    }
    return format(val !== undefined ? val : (fallback !== undefined ? fallback : key), params);
  }

  /**
   * Добавляет/дополняет словарь языка (для расширений).
   * @param {'ru'|'en'} lang
   * @param {Object<string,string>} dict
   */
  function addDict(lang, dict) { dicts[lang] = Object.assign(dicts[lang] || {}, dict || {}); }

  /**
   * Переключает язык, сохраняет и уведомляет (шина + onChange).
   * @param {'ru'|'en'} lang
   */
  function setLang(lang) {
    if (lang !== 'ru' && lang !== 'en') return;
    current = lang;
    Config.set('lang', current);
    for (const fn of listeners.slice()) { try { fn(current); } catch (_) {} }
    try { bus.emit('i18n:change', { lang: current }); } catch (_) {}
  }

  /** @returns {'ru'|'en'} Текущий язык. */
  const getLang = () => current;

  /**
   * Подписка на смену языка.
   * @param {Function} fn - (lang) => void.
   */
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  // ── Базовые словари: все ключи приложения ──
  addDict('ru', {
    'app.name': 'NOOmium',
    // статусы
    'st.net': 'сеть', 'st.ai.loading': 'модель', 'st.ai.ready': 'ии', 'st.ai.demo': 'ии/хеш',
    'st.net.online': 'онлайн', 'st.net.listen': 'слушаю', 'st.net.connecting': 'соединение',
    'st.net.reconnecting': 'пересоединение', 'st.net.failed': 'нет сети',
    // композер
    'ed.placeholder': 'О чём думаешь?', 'ed.chars': 'симв.',
    'btn.private': 'Личное', 'btn.public': 'Мир', 'btn.send': 'Отправить', 'btn.save': 'Сохранить',
    // вкладки и сегменты
    'tab.stream': 'Поток', 'tab.base': 'База',
    'seg.local': 'Моё', 'seg.world': 'Мир', 'seg.seren': 'Озарения',
    // контекст
    'ctx.pinned': 'пин', 'ctx.input': 'по тексту', 'ctx.drift': 'дрейф от', 'ctx.clear': 'снять',
    // сходство и связи
    'sim.score': 'похожа на',
    'inf.resonance': 'резонанс', 'inf.linked': 'по мотивам', 'inf.bymotif': 'по мотивам',
    'inf.openparent': 'Открыть заметку-источник', 'inf.children': 'Потомки',
    'inf.nochildren': 'Потомков пока нет', 'inf.lineage': 'Линейка «по мотивам»',
    'inf.noancestors': 'Это корень — предков нет',
    // пустые состояния
    'empty.local.t': 'Пока нет мыслей', 'empty.local.d': 'Напиши первую выше',
    'empty.world.t': 'Никто не думает так же', 'empty.world.d': 'Ждём открытые мысли',
    'empty.seren.t': 'Озарений нет', 'empty.seren.d': 'Попробуй иначе',
    'empty.base.t': 'База пуста', 'empty.base.d': 'Запиши первую мысль', 'empty.base.empty': 'Ничего не найдено',
    // база
    'base.search': 'поиск...',
    'base.sort.new': 'новые', 'base.sort.old': 'старые', 'base.sort.az': 'а-я',
    'base.stat.total': 'всего', 'base.stat.open': 'открыто', 'base.stat.priv': 'лично',
    'base.tag.private': 'лично', 'base.tag.shared': 'открыто',
    'base.wipe': 'Стереть базу', 'base.wipe.confirm': 'Удалить все ваши заметки навсегда?',
    // кнопки
    'btn.edit': 'Развить', 'btn.del': 'Удалить', 'btn.copy': 'Копия',
    'btn.cancel': 'Отмена', 'btn.close': 'Закрыть',
    'btn.toggle.priv': 'Скрыть', 'btn.toggle.pub': 'Открыть',
    // тосты
    'toast.saved.private': 'сохранено лично', 'toast.saved.public': 'опубликовано',
    'toast.copied': 'скопировано', 'toast.deleted': 'удалено', 'toast.copy.fail': 'не удалось',
    'toast.empty': 'напиши что-нибудь', 'toast.ai.notready': 'ии не готов',
    'toast.base.wiped': 'база стёрта', 'toast.edit.saved': 'сохранено',
    // меню
    'menu.settings': 'Настройки', 'menu.theme': 'Тема', 'menu.lang': 'Язык', 'menu.help': 'Как это работает',
    // удаление
    'del.confirm': 'Удалить эту заметку навсегда?',
    // сеть
    'net.loadmore': 'Загрузить ещё', 'net.loading': 'Загружаю…',
    // онбординг
    'onb.title': 'Как это работает', 'onb.dontshow': 'Больше не показывать', 'onb.gotit': 'Понятно',
    'onb.what.t': 'NOOmium',
    'onb.what.d': 'Соцсеть смыслов: мысли ищутся не по словам и не по лайкам, а по значению. Каждая мысль превращается в вектор — точку в пространстве смыслов.',
    'onb.stream.t': 'Лента', 'onb.stream.d': 'Показывает свежие мысли — твои и из сети. Просто читай.',
    'onb.pin.t': 'Пин',
    'onb.pin.d': 'Кликни по мысли — она станет контекстом: лента покажет созвучное из твоей базы и из сети. Закреплённая мысль становится «мамой» для всего, что ты напишешь следом.',
    'onb.drift.t': 'Дрейф',
    'onb.drift.d': 'Начни печатать при пине — контекст плавно перейдёт к твоему тексту. Так можно органично уйти от исходной мысли к своей.',
    'onb.modes.t': 'Личное и Мир',
    'onb.modes.d': 'Личное остаётся только у тебя. Мир — делится мыслью с сетью, и другие смогут найти её по смыслу.',
    'onb.resonance.t': 'Резонанс ◆',
    'onb.resonance.d': 'Сколько чужих мыслей родила твоя. «↳ по мотивам» ведёт к заметке-источнику, клик по ◆ показывает потомков.',
    'onb.keys.t': 'Клавиши',
    'onb.keys.d': 'Ctrl/Cmd+Enter — отправить · / — фокус на поле · Esc — снять пин или закрыть окно.',
  });
  addDict('en', {
    'app.name': 'NOOmium',
    'st.net': 'net', 'st.ai.loading': 'model', 'st.ai.ready': 'ai', 'st.ai.demo': 'ai/hash',
    'st.net.online': 'online', 'st.net.listen': 'listening', 'st.net.connecting': 'connecting',
    'st.net.reconnecting': 'reconnecting', 'st.net.failed': 'offline',
    'ed.placeholder': 'What are you thinking?', 'ed.chars': 'chars',
    'btn.private': 'Private', 'btn.public': 'World', 'btn.send': 'Send', 'btn.save': 'Save',
    'tab.stream': 'Stream', 'tab.base': 'Base',
    'seg.local': 'Mine', 'seg.world': 'World', 'seg.seren': 'Insights',
    'ctx.pinned': 'pinned', 'ctx.input': 'by text', 'ctx.drift': 'drift from', 'ctx.clear': 'clear',
    'sim.score': 'similarity',
    'inf.resonance': 'resonance', 'inf.linked': 'inspired by', 'inf.bymotif': 'inspired by',
    'inf.openparent': 'Open source note', 'inf.children': 'Descendants',
    'inf.nochildren': 'No descendants yet', 'inf.lineage': '“Inspired by” lineage',
    'inf.noancestors': 'This is the root — no ancestors',
    'empty.local.t': 'No thoughts yet', 'empty.local.d': 'Write the first above',
    'empty.world.t': 'Nobody thinks alike', 'empty.world.d': 'Waiting for open thoughts',
    'empty.seren.t': 'No insights', 'empty.seren.d': 'Try different wording',
    'empty.base.t': 'Base is empty', 'empty.base.d': 'Write your first thought', 'empty.base.empty': 'Nothing found',
    'base.search': 'search...',
    'base.sort.new': 'newest', 'base.sort.old': 'oldest', 'base.sort.az': 'a-z',
    'base.stat.total': 'total', 'base.stat.open': 'open', 'base.stat.priv': 'private',
    'base.tag.private': 'private', 'base.tag.shared': 'open',
    'base.wipe': 'Wipe base', 'base.wipe.confirm': 'Delete all your notes forever?',
    'btn.edit': 'Develop', 'btn.del': 'Delete', 'btn.copy': 'Copy',
    'btn.cancel': 'Cancel', 'btn.close': 'Close',
    'btn.toggle.priv': 'Hide', 'btn.toggle.pub': 'Share',
    'toast.saved.private': 'saved privately', 'toast.saved.public': 'shared',
    'toast.copied': 'copied', 'toast.deleted': 'deleted', 'toast.copy.fail': 'copy failed',
    'toast.empty': 'write something', 'toast.ai.notready': 'ai not ready',
    'toast.base.wiped': 'base wiped', 'toast.edit.saved': 'saved',
    'menu.settings': 'Settings', 'menu.theme': 'Theme', 'menu.lang': 'Language', 'menu.help': 'How it works',
    'del.confirm': 'Delete this note forever?',
    'net.loadmore': 'Load more', 'net.loading': 'Loading…',
    'onb.title': 'How it works', 'onb.dontshow': 'Don’t show again', 'onb.gotit': 'Got it',
    'onb.what.t': 'NOOmium',
    'onb.what.d': 'A social network of meaning: thoughts are found not by words or likes, but by sense. Each thought becomes a vector — a point in meaning-space.',
    'onb.stream.t': 'Feed', 'onb.stream.d': 'Shows fresh thoughts — yours and from the network. Just read.',
    'onb.pin.t': 'Pin',
    'onb.pin.d': 'Click a thought to make it the context: the feed shows what resonates, from your base and the network. The pinned thought becomes the “mother” of what you write next.',
    'onb.drift.t': 'Drift',
    'onb.drift.d': 'Start typing while pinned — the context shifts toward your text. A natural way to drift from the original thought to your own.',
    'onb.modes.t': 'Private & World',
    'onb.modes.d': 'Private stays with you. World shares the thought with the network so others can find it by meaning.',
    'onb.resonance.t': 'Resonance ◆',
    'onb.resonance.d': 'How many thoughts yours inspired. “↳ inspired by” leads to the source note; click ◆ to see descendants.',
    'onb.keys.t': 'Keys',
    'onb.keys.d': 'Ctrl/Cmd+Enter — send · / — focus editor · Esc — unpin or close.',
  });

  return { t, addDict, setLang, getLang, onChange };
}, ['Config', 'EventBus']);
// ─── CORE/I18n ─── END ───────────────────────────────────────
