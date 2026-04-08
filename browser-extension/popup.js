const statusEl = document.getElementById('status');
const tabInfoEl = document.getElementById('tab-info');
const dotEl = document.getElementById('dot');

async function checkConnection() {
  try {
    const res = await fetch('http://127.0.0.1:7979/commands', { method: 'GET' });
    if (res.ok) {
      statusEl.textContent = 'connected to thera';
      statusEl.className = 'status connected';
      dotEl.style.background = '#4ade80';
      dotEl.style.boxShadow = '0 0 6px #4ade8099';
    }
  } catch (_) {
    statusEl.textContent = 'thera not running';
    statusEl.className = 'status disconnected';
    dotEl.style.background = 'rgba(255,255,255,0.2)';
    dotEl.style.boxShadow = 'none';
  }
}

async function showCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (tab) {
    tabInfoEl.innerHTML = `
      <div class="tab-title">${tab.title || 'untitled'}</div>
      <div class="tab-info">${tab.url?.slice(0, 60) || ''}${(tab.url?.length || 0) > 60 ? '…' : ''}</div>
    `;
  }
}

checkConnection();
showCurrentTab();
