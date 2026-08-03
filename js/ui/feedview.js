// ─── UI/FeedView ─── START ───────────────────────────────────
/**
 * Рендер ленты и хром режимов.
 *  - просмотр: хронология Store.feed; бар скрыт.
 *  - input / drift (режим автора): бар виден, лента = Store.lists[seg].
 *  - pin: баннер, единый список похожего (закреплённая исключена).
 * Жесты: клик по карточке = пин/отпин; ✎ на своих = NoteView;
 * «↳ по мотивам» = линейка предков; «◆ N» = потомки;
 * «Загрузить ещё» = история сети.
 * Резонанс = сумма уникальных авторов по локальному id и по eventId.
 * @deps Store, Context, I18n, Utils, EventBus, Influence, Provenance, Modal, NetService
 * @exports FeedView
 */
DI.register('FeedView', function (Store, Context, I18n, Utils, bus, Influence, Provenance, Modal, NetService) {
  let feedEl, emptyEl, emptyT, segBar, ctxBanner, ctxSrc, ctxTxt, ctxX;
  let cLocal, cWorld, cSeren, histBtn;
  let unsubs = [];
  let rafPending = false;

  function bind() {
    feedEl = document.getElementById('feed');
    emptyEl = document.getElementById('feed-empty');
    emptyT = document.getElementById('feed-empty-t');
    segBar = document.getElementById('seg');
    ctxBanner = document.getElementById('ctx-banner');
    ctxSrc = document.getElementById('ctx-src');
    ctxTxt = document.getElementById('ctx-txt');
    ctxX = document.getElementById('ctx-x');
    cLocal = document.getElementById('c-local');
    cWorld = document.getElementById('c-world');
    cSeren = document.getElementById('c-seren');
    histBtn = document.getElementById('btn-history');
  }

  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; render(); });
  }

  function isPinned(n) {
    const ctx = Store.get('context');
    return ctx.source === 'pin' && ctx.noteId === n.id;
  }

  function onNoteClick(n) {
    const ctx = Store.get('context');
    if ((ctx.source === 'pin' || ctx.source === 'drift') && ctx.noteId === n.id) { Context.clearPin(); return; }
    if (n.vector) Context.setPin(n);
  }

  function renderChildrenModal(children) {
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    if (!children.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--text-3);font-size:13px;';
      empty.textContent = I18n.t('inf.nochildren');
      body.appendChild(empty);
    } else {
      children.forEach(c => {
        const item = document.createElement('button');
        item.className = 'nv-act';
        item.style.cssText = 'text-align:left;justify-content:flex-start;white-space:normal;height:auto;min-height:40px;';
        item.textContent = (c.text || '').slice(0, 140);
        item.addEventListener('click', () => {
          Modal.close();
          try { bus.emit('note:open', { id: c.id }); } catch (_) {}
        });
        body.appendChild(item);
      });
    }
    Modal.open({
      title: I18n.t('inf.children') + (children.length ? ' · ' + children.length : ''),
      body,
      buttons: [{ text: I18n.t('btn.close'), onClick: () => Modal.close() }],
    });
  }

  function showChildren(note) {
    const ids = [note.id];
    if (note.eventId) ids.push(note.eventId);
    Promise.all(ids.map(id => Provenance.children(id))).then(results => {
      const seenIds = new Set();
      const children = [];
      results.forEach(list => (list || []).forEach(c => {
        if (c && !seenIds.has(c.id)) { seenIds.add(c.id); children.push(c); }
      }));
      renderChildrenModal(children);
    }).catch(() => {});
  }

  function renderAncestorsModal(note, chain) {
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    if (!chain.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--text-3);font-size:13px;';
      empty.textContent = I18n.t('inf.noancestors');
      body.appendChild(empty);
    } else {
      chain.forEach((c, i) => {
        const item = document.createElement('button');
        item.className = 'nv-act';
        item.style.cssText = 'text-align:left;justify-content:flex-start;white-space:normal;height:auto;min-height:40px;';
        item.style.paddingLeft = (16 + i * 14) + 'px';
        item.textContent = '↳ ' + (c.text || '').slice(0, 140);
        item.addEventListener('click', () => {
          Modal.close();
          try { bus.emit('note:open', { id: c.id }); } catch (_) {}
        });
        body.appendChild(item);
      });
    }
    Modal.open({
      title: I18n.t('inf.lineage') + (chain.length ? ' · ' + chain.length : ''),
      body,
      buttons: [{ text: I18n.t('btn.close'), onClick: () => Modal.close() }],
    });
  }

  function showAncestors(note) {
    Provenance.ancestors(note.id).then(chain => {
      renderAncestorsModal(note, chain);
    }).catch(() => {});
  }

  function card(n, isRanked, i) {
    const el = document.createElement('div');
    el.className = 'note' + (isPinned(n) ? ' pinned' : '');
    el.style.animationDelay = Math.min(i * 25, 300) + 'ms';
    el.dataset.id = n.id;

    const txt = document.createElement('div');
    txt.className = 'note-txt';
    txt.textContent = n.text || '';
    el.appendChild(txt);

    const meta = document.createElement('div');
    meta.className = 'note-meta';

    const tag = document.createElement('span');
    if (n.own) {
      tag.className = 'note-tag ' + (n.shared ? 'world' : 'priv');
      tag.textContent = n.shared ? I18n.t('base.tag.shared') : I18n.t('base.tag.private');
    } else {
      tag.className = 'note-tag world';
      tag.textContent = '· ' + Utils.shortPk(n.authorPubkey || '');
    }
    meta.appendChild(tag);

    if (n.parentId) {
      const link = document.createElement('button');
      link.className = 'note-parent';
      link.style.cssText = 'background:none;border:none;padding:0;cursor:pointer;font:inherit;color:var(--teal);';
      link.textContent = '↳ ' + I18n.t('inf.bymotif');
      link.title = I18n.t('inf.lineage');
      link.addEventListener('click', e => {
        e.stopPropagation();
        showAncestors(n);
      });
      meta.appendChild(link);
    }

    if (isRanked && typeof n.score === 'number') {
      const sim = document.createElement('span');
      sim.className = 'note-sim';
      sim.textContent = I18n.t('sim.score') + ' ' + Math.round(n.score * 100) + '%';
      meta.appendChild(sim);
    }

    const res = Influence.resonance(n.id) + Influence.resonance(n.eventId);
    if (res > 0) {
      const r = document.createElement('button');
      r.className = 'note-sim';
      r.style.cssText = 'color:var(--teal);background:none;border:none;padding:0;cursor:pointer;font:inherit;';
      r.textContent = '◆ ' + res;
      r.title = I18n.t('inf.resonance');
      r.addEventListener('click', e => {
        e.stopPropagation();
        showChildren(n);
      });
      meta.appendChild(r);
    }

    const date = document.createElement('span');
    date.textContent = Utils.fmtTime(n.createdAt, I18n.getLang());
    meta.appendChild(date);

    el.appendChild(meta);

    if (n.own) {
      const openBtn = document.createElement('button');
      openBtn.className = 'na';
      openBtn.style.cssText = 'position:absolute;top:10px;right:10px;font-size:12px;opacity:.7;';
      openBtn.textContent = '✎';
      openBtn.title = I18n.t('btn.edit');
      openBtn.addEventListener('click', e => {
        e.stopPropagation();
        try { bus.emit('note:open', { id: n.id }); } catch (_) {}
      });
      el.appendChild(openBtn);
    }

    el.addEventListener('click', () => onNoteClick(n));
    return el;
  }

  function render() {
    if (!feedEl) return;
    const state = Store.getState();
    const ctx = state.context;
    const isPinnedMode = ctx.source === 'pin';
    const isTyping = ctx.source === 'input';
    const isDrift = ctx.source === 'drift';
    const isRanked = isPinnedMode || isTyping || isDrift;

    segBar.classList.toggle('on', isTyping || isDrift);
    ctxBanner.classList.toggle('on', isPinnedMode || isDrift);
    if (isPinnedMode || isDrift) {
      ctxSrc.textContent = isDrift ? I18n.t('ctx.drift') : I18n.t('ctx.pinned');
      ctxTxt.textContent = isDrift ? (ctx.pinText || ctx.text) : ctx.text;
    }

    document.querySelectorAll('.seg-b').forEach(b =>
      b.classList.toggle('on', b.getAttribute('data-k') === state.seg));
    cLocal.textContent = state.lists.local.length;
    cWorld.textContent = state.lists.world.length;
    cSeren.textContent = state.lists.seren.length;

    let notes;
    if (isPinnedMode) {
      notes = [...state.lists.local, ...state.lists.world, ...state.lists.seren]
        .filter(n => n.id !== ctx.noteId)
        .sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (isTyping || isDrift) {
      notes = state.lists[state.seg] || [];
    } else {
      notes = state.feed;
    }

    feedEl.innerHTML = '';
    if (!notes.length) {
      emptyEl.classList.add('on');
      emptyT.textContent = isPinnedMode
        ? I18n.t('empty.world.t')
        : ((isTyping || isDrift) ? I18n.t('empty.' + state.seg + '.t') : I18n.t('empty.local.t'));
    } else {
      emptyEl.classList.remove('on');
      const frag = document.createDocumentFragment();
      notes.forEach((n, i) => frag.appendChild(card(n, isRanked, i)));
      feedEl.appendChild(frag);
    }
  }

  function init() {
    bind();
    if (!feedEl) return;
    // ключи линейки предков, отсутствующие в базовом словаре
    I18n.addDict('ru', { 'inf.lineage': 'Линейка «по мотивам»', 'inf.noancestors': 'Это корень — предков нет' });
    I18n.addDict('en', { 'inf.lineage': '“Inspired by” lineage', 'inf.noancestors': 'This is the root — no ancestors' });

    unsubs.push(Store.subscribe(s => s.context, scheduleRender, Store.shallowEqual));
    unsubs.push(Store.subscribe(s => s.lists, scheduleRender));
    unsubs.push(Store.subscribe(s => s.feed, scheduleRender));
    unsubs.push(Store.subscribe(s => s.seg, scheduleRender));
    unsubs.push(bus.on('i18n:change', scheduleRender));
    unsubs.push(bus.on('db:change', scheduleRender));
    unsubs.push(bus.on('db:cache', scheduleRender));
    unsubs.push(bus.on('influence:updated', scheduleRender));
    // история сети
    if (histBtn) {
      histBtn.addEventListener('click', () => NetService.loadHistory());
      unsubs.push(bus.on('net:history', e => {
        if (!histBtn) return;
        if (e && e.loading) {
          histBtn.disabled = true;
          histBtn.textContent = I18n.t('net.loading');
        } else {
          histBtn.disabled = false;
          histBtn.textContent = I18n.t('net.loadmore');
        }
      }));
    }
    document.querySelectorAll('.seg-b').forEach(b =>
      b.addEventListener('click', () => Store.setState({ seg: b.getAttribute('data-k') })));
    if (ctxX) ctxX.addEventListener('click', () => Context.clearPin());
    render();
  }

  function destroy() {
    unsubs.forEach(u => { try { u(); } catch (_) {} });
    unsubs = [];
  }

  return { init, destroy, render };
}, ['Store', 'Context', 'I18n', 'Utils', 'EventBus', 'Influence', 'Provenance', 'Modal', 'NetService']);
// ─── UI/FeedView ─── END ─────────────────────────────────────
