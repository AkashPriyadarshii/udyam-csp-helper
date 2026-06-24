// Popup UI logic — communicates with background.js (queue) and content.js (tab)
let state = { queue: [], currentIndex: 0, isProcessing: false };

document.addEventListener('DOMContentLoaded', async () => {
  await refreshState();
  setupListeners();

  // Check if config exists
  const cfg = (await chrome.storage.local.get('config')).config;
  if (!cfg || !cfg.sheetId) {
    showMsg('⚠️ No configuration found. Open Options to set up.', 'error');
  }
});

async function refreshState() {
  const data = await chrome.storage.local.get(['queue', 'currentIndex', 'isProcessing', 'currentResult']);
  state.queue = data.queue || [];
  state.currentIndex = data.currentIndex || 0;
  state.isProcessing = data.isProcessing || false;
  state.currentResult = data.currentResult || null;
  render();
}

function render() {
  const queue = state.queue;
  const idx = state.currentIndex;
  const total = queue.length;
  const done = queue.filter(p => p.status === 'DONE').length;
  const failed = queue.filter(p => p.status === 'FAILED').length;
  const remaining = total - done - failed;

  document.getElementById('doneCount').textContent = done;
  document.getElementById('remainingCount').textContent = remaining;
  document.getElementById('failedCount').textContent = failed;

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById('progressFill').style.width = pct + '%';

  document.getElementById('queueCount').textContent = total;

  // Badge
  const badge = document.getElementById('statusBadge');
  if (state.isProcessing) { badge.textContent = 'Running'; badge.className = 'badge running'; }
  else { badge.textContent = 'Paused'; badge.className = 'badge paused'; }
  if (!state.isProcessing && done === 0 && total === 0) { badge.textContent = 'Idle'; badge.className = 'badge idle'; }

  // Current person
  const current = queue[idx];
  if (current) {
    document.getElementById('currentName').textContent = current.Proprietor_Name || current.name || '—';
    document.getElementById('currentAadhaar').textContent = current.Aadhaar_No ? '****' + current.Aadhaar_No.slice(-4) : '—';
    const curStatus = document.getElementById('currentStatus');
    curStatus.textContent = current.status || 'PENDING';
    curStatus.className = 'status-badge status-' + (current.status || 'PENDING');

    // Show/hide OTP/CAPTCHA/FinalOTP areas based on status
    document.getElementById('otpArea').classList.toggle('hidden', current.status !== 'OTP_WAIT');
    document.getElementById('captchaArea').classList.toggle('hidden', current.status !== 'CAPTCHA_WAIT');
    document.getElementById('finalOtpArea').classList.toggle('hidden', current.status !== 'FINAL_OTP_WAIT');

    // Show result message
    const msgEl = document.getElementById('resultMsg');
    if (current.status === 'DONE' && current.udyamNumber) {
      msgEl.className = 'msg done';
      msgEl.textContent = `✅ Udyam: ${current.udyamNumber}`;
      msgEl.classList.remove('hidden');
    } else if (current.status === 'FAILED') {
      msgEl.className = 'msg error';
      msgEl.textContent = `❌ ${current.lastError || 'Failed'}`;
      msgEl.classList.remove('hidden');
    } else {
      msgEl.classList.add('hidden');
    }

    // CAPTCHA image
    if (current.status === 'CAPTCHA_WAIT' && current.captchaSrc) {
      document.getElementById('captchaImg').src = current.captchaSrc;
    }
  } else {
    document.getElementById('currentName').textContent = '—';
    document.getElementById('currentAadhaar').textContent = '—';
    document.getElementById('currentStatus').textContent = total === 0 ? 'No data' : 'All done!';
    document.getElementById('otpArea').classList.add('hidden');
    document.getElementById('captchaArea').classList.add('hidden');
    document.getElementById('finalOtpArea').classList.add('hidden');
    document.getElementById('resultMsg').classList.add('hidden');
  }

  // Controls
  document.getElementById('startBtn').classList.toggle('hidden', state.isProcessing || (done + failed >= total && total > 0));
  document.getElementById('pauseBtn').classList.toggle('hidden', !state.isProcessing);

  // Queue list
  renderQueue();
}

function renderQueue() {
  const list = document.getElementById('queueList');
  const start = Math.max(0, state.currentIndex - 5);
  const end = Math.min(state.queue.length, state.currentIndex + 10);
  const items = state.queue.slice(start, end);

  list.innerHTML = items.map((p, i) => {
    const realIdx = start + i;
    const isCurrent = realIdx === state.currentIndex;
    const name = p.Proprietor_Name || p.name || 'Row ' + (realIdx + 1);
    const status = p.status || 'PENDING';
    const urn = p.udyamNumber || '';
    return `<div class="queue-item${isCurrent ? ' current' : ''}">
      <div>
        <span class="queue-name">${name}</span>
        ${urn ? `<span class="queue-urn"> — ${urn}</span>` : ''}
      </div>
      <span class="status-badge status-${status}">${status}</span>
    </div>`;
  }).join('');
}

function setupListeners() {
  document.getElementById('startBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'start' });
    window.close(); // popup closes, processing continues in background
  });

  document.getElementById('pauseBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'pause' });
    refreshState();
  });

  document.getElementById('skipBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'skip' });
    refreshState();
  });

  document.getElementById('retryBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'retry' });
    refreshState();
  });

  // OTP submit
  document.getElementById('otpSubmitBtn').addEventListener('click', () => {
    const otp = document.getElementById('otpInput').value.trim();
    if (otp.length < 4) return;
    chrome.runtime.sendMessage({ action: 'otpEntered', otp });
    document.getElementById('otpInput').value = '';
    refreshState();
  });

  document.getElementById('otpInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('otpSubmitBtn').click();
  });

  document.getElementById('otpResendBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'resendOtp' });
  });

  document.getElementById('otpCancelBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'skip' });
    refreshState();
  });

  // CAPTCHA submit
  document.getElementById('captchaSubmitBtn').addEventListener('click', () => {
    const captcha = document.getElementById('captchaInput').value.trim();
    if (!captcha) return;
    chrome.runtime.sendMessage({ action: 'captchaEntered', captcha });
    document.getElementById('captchaInput').value = '';
    refreshState();
  });
  document.getElementById('captchaInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('captchaSubmitBtn').click();
  });

  // Final OTP submit
  document.getElementById('finalOtpSubmitBtn').addEventListener('click', () => {
    const otp = document.getElementById('finalOtpInput').value.trim();
    if (otp.length < 4) return;
    chrome.runtime.sendMessage({ action: 'finalOtpEntered', otp });
    document.getElementById('finalOtpInput').value = '';
    refreshState();
  });
  document.getElementById('finalOtpInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('finalOtpSubmitBtn').click();
  });

  document.getElementById('optionsLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Listen for state updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'stateUpdated') {
      refreshState();
    }
    if (msg.action === 'queueFinished') {
      showMsg('🎉 All registrations processed!', 'done');
      refreshState();
    }
  });
}

let hideMsgTimer = null;
function showMsg(text, type) {
  const el = document.getElementById('resultMsg');
  el.textContent = text;
  el.className = 'msg ' + (type || 'info');
  el.classList.remove('hidden');
  if (hideMsgTimer) clearTimeout(hideMsgTimer);
  hideMsgTimer = setTimeout(() => { el.classList.add('hidden'); hideMsgTimer = null; }, 5000);
}
