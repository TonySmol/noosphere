// ─── UI/HeaderStatus ─── START ───────────────────────────────
/**
 * Индикаторы в шапке: сеть и ИИ. Реагирует на 'ai:status' и 'net:status'.
 * Пока NET не подключён, сеть показана как disconnected — оживёт с NetService.
 * @deps EventBus, I18n, Embedder
 * @exports HeaderStatus
 */
DI.register('HeaderStatus', function (bus, I18n, Embedder) {
  let netDot, netTxt, aiDot, aiTxt;
  let unsubs = [];

  function bind() {
    netDot = document.getElementById('st-net-dot');
    netTxt = document.getElementById('st-net-txt');
    aiDot = document.getElementById('st-ai-dot');
    aiTxt = document.getElementById('st-ai-txt');
  }

  /** @param {'loading'|'model'|'demo'} mode @param {number} [percent] */
  function setAI(mode, percent) {
    if (!aiDot || !aiTxt) return;
    if (mode === 'model') {
      aiDot.className = 'dot ok';
      aiTxt.textContent = I18n.t('st.ai.ready');
    } else if (mode === 'demo') {
      aiDot.className = 'dot warn';
      aiTxt.textContent = I18n.t('st.ai.demo');
    } else {
      aiDot.className = 'dot load';
      aiTxt.textContent = I18n.t('st.ai.loading') + (percent ? ' ' + Math.round(percent) + '%' : '');
    }
  }

  /** @param {'disconnected'|'connecting'|'connected'|'reconnecting'|'failed'} status */
  function setNet(status) {
    if (!netDot || !netTxt) return;
    const map = {
      connected: ['ok', 'st.net.online'],
      connecting: ['load', 'st.net.connecting'],
      reconnecting: ['warn', 'st.net.reconnecting'],
      failed: ['err', 'st.net.failed'],
      disconnected: ['', 'st.net'],
    };
    const [cls, key] = map[status] || ['', 'st.net'];
    netDot.className = 'dot' + (cls ? ' ' + cls : '');
    netTxt.textContent = I18n.t(key);
  }

  function init() {
    bind();
    unsubs.push(bus.on('ai:status', e => setAI(e.mode, e.percent)));
    unsubs.push(bus.on('net:status', e => setNet(e.status)));
    unsubs.push(bus.on('i18n:change', () => { setAI(Embedder.getMode()); setNet('disconnected'); }));
    setAI(Embedder.getMode());
    setNet('disconnected');
  }

  function destroy() {
    unsubs.forEach(u => { try { u(); } catch (_) {} });
    unsubs = [];
  }

  return { init, destroy };
}, ['EventBus', 'I18n', 'Embedder']);
// ─── UI/HeaderStatus ─── END ─────────────────────────────────
