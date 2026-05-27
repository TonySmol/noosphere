export function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

export function setSendEnabled(enabled) {
  document.getElementById('send-btn').disabled = !enabled;
}

export function renderResults(results, container) {
  if (!results || results.length === 0) {
    container.innerHTML = '<div class="card">Ничего не найдено</div>';
    return;
  }
  container.innerHTML = results.map(r => 
    `<div class="card"><strong>(${r.score.toFixed(2)})</strong> ${escapeHtml(r.payload?.text || '—')}</div>`
  ).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
