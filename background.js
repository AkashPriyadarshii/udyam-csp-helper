// Background service worker — queue orchestration, sheet fetch, messaging
// Top-level storage keys so popup and background share the same data
// Popup reads: queue, currentIndex, isProcessing, currentResult directly from chrome.storage.local

// Initialize: fetch sheet on install if config exists
chrome.runtime.onInstalled.addListener(async () => {
  const cfg = (await chrome.storage.local.get('config')).config;
  if (cfg?.sheetId && cfg?.apiKey) {
    await fetchSheet(cfg);
  }
});

// Keep service worker alive during processing
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'keepAlive') {
    const state = await getState();
    if (state.isProcessing) {
      // Wake content script if still active
      try {
        const tabs = await chrome.tabs.query({ url: '*://*.udyamregistration.gov.in/UdyamRegistration.aspx*' });
        if (tabs.length > 0) {
          await chrome.tabs.sendMessage(tabs[0].id, { action: 'ping' }).catch(() => {});
        }
      } catch {}
    }
  }
});

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = {
    async start() {
      let state = await getState();
      if (!state.queue || state.queue.length === 0) {
        notifyPopup({ action: 'stateUpdated' });
        return;
      }
      state.isProcessing = true;
      // Resume from current index if already started, else begin at 0
      const idx = state.currentIndex || 0;
      const alreadyProcessed = state.queue.slice(0, idx).filter(p => p.status === 'DONE' || p.status === 'SKIPPED');
      if (alreadyProcessed.length < idx) {
        // We're resuming after pause — don't reset statuses
      } else {
        // Fresh start — reset all to PENDING
        state.queue = state.queue.map(p => ({ ...p, status: 'PENDING', lastError: null }));
        state.currentIndex = 0;
      }
      await saveState(state);
      await processNext();
    },

    async pause() {
      let state = await getState();
      state.isProcessing = false;
      await saveState(state);
      notifyPopup({ action: 'stateUpdated' });
    },

    async skip() {
      let state = await getState();
      const current = state.queue[state.currentIndex];
      if (current) {
        current.status = 'SKIPPED';
        current.lastError = 'Manually skipped';
      }
      state.currentIndex++;
      if (state.currentIndex >= state.queue.length) {
        state.isProcessing = false;
        await saveState(state);
        notifyPopup({ action: 'queueFinished' });
      } else {
        await saveState(state);
        if (state.isProcessing) await processNext();
        else notifyPopup({ action: 'stateUpdated' });
      }
    },

    async retry() {
      let state = await getState();
      const current = state.queue[state.currentIndex];
      if (current && current.status === 'FAILED') {
        current.status = 'PENDING';
        current.lastError = null;
        current.retryCount = (current.retryCount || 0) + 1;
      }
      state.isProcessing = true;
      await saveState(state);
      await processNext();
    },

    async otpEntered(msg) {
      const tab = await getUdyamTab();
      if (tab) {
        await chrome.tabs.sendMessage(tab.id, { action: 'otpEntered', otp: msg.otp });
      }
    },

    async resendOtp() {
      const tab = await getUdyamTab();
      if (tab) {
        await chrome.tabs.sendMessage(tab.id, { action: 'resendOtp' });
      }
    },

    async captchaEntered(msg) {
      const tab = await getUdyamTab();
      if (tab) {
        await chrome.tabs.sendMessage(tab.id, { action: 'captchaEntered', captcha: msg.captcha });
      }
    },

    async finalOtpEntered(msg) {
      const tab = await getUdyamTab();
      if (tab) {
        await chrome.tabs.sendMessage(tab.id, { action: 'finalOtpEntered', otp: msg.otp });
      }
    }
  };

  if (msg.action === 'fetchSheet') {
    getConfig().then(cfg => fetchSheet(cfg).then(q => sendResponse({ ok: true, count: q.length })).catch(e => sendResponse({ ok: false, error: e.message })));
    return true;
  }

  const h = handler[msg.action];
  if (h) {
    h(msg);
    sendResponse({ ok: true });
  } else {
    // Handle messages FROM content script
    if (['stepUpdate', 'personDone', 'personFailed', 'otpWaiting', 'captchaWaiting', 'finalOtpWaiting'].includes(msg.action)) {
      handleContentMessage(msg, sender);
    }
  }
  return true; // keep channel open for async
});

// Handle messages FROM content script
async function handleContentMessage(msg, sender) {
  switch (msg.action) {
    case 'stepUpdate':
      await updateCurrentPerson(msg);
      break;

    case 'personDone':
      await markDone(msg);
      break;

    case 'personFailed':
      await markFailed(msg);
      break;

    case 'otpWaiting':
      await updateStatus('OTP_WAIT');
      notifyPopup({ action: 'stateUpdated' });
      break;

    case 'captchaWaiting':
      await updateStatus('CAPTCHA_WAIT', { captchaSrc: msg.captchaSrc });
      notifyPopup({ action: 'stateUpdated' });
      break;

    case 'finalOtpWaiting':
      await updateStatus('FINAL_OTP_WAIT');
      notifyPopup({ action: 'stateUpdated' });
      break;
  }
}

async function processNext() {
  const state = await getState();
  if (!state.isProcessing) return;

  if (state.currentIndex >= state.queue.length) {
    state.isProcessing = false;
    await saveState(state);
    notifyPopup({ action: 'queueFinished' });
    return;
  }

  const person = state.queue[state.currentIndex];
  person.status = 'PROCESSING';
  await saveState(state);
  notifyPopup({ action: 'stateUpdated' });

  // Ensure Udyam tab exists
  let tab = await getUdyamTab();
  if (!tab) {
    tab = await chrome.tabs.create({ url: 'https://www.udyamregistration.gov.in/UdyamRegistration.aspx', active: true });
    // Wait for page to load
    await new Promise(r => setTimeout(r, 3000));
  }

  // Send person data to content script
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'processPerson', person, config: await getConfig() });
  } catch (err) {
    // Content script not injected yet, wait and retry
    await new Promise(r => setTimeout(r, 2000));
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'processPerson', person, config: await getConfig() });
    } catch (err2) {
      await markFailed({ error: 'Content script not available. Reload the tab and click Start.' });
    }
  }
}

async function markDone(msg) {
  const state = await getState();
  const person = state.queue[state.currentIndex];
  if (person) {
    person.status = 'DONE';
    person.udyamNumber = msg.udyamNumber || '';
    person.completedAt = new Date().toISOString();
  }
  state.currentIndex++;
  if (state.currentIndex >= state.queue.length) {
    state.isProcessing = false;
    await saveState(state);
    notifyPopup({ action: 'queueFinished' });
  } else {
    await saveState(state);
    notifyPopup({ action: 'stateUpdated' });
    if (state.isProcessing) {
      // Small delay between persons
      await new Promise(r => setTimeout(r, 1000));
      await processNext();
    }
  }
}

async function markFailed(msg) {
  const state = await getState();
  const person = state.queue[state.currentIndex];
  if (person) {
    person.status = 'FAILED';
    person.lastError = msg.error || 'Unknown error';
  }
  await saveState(state);
  notifyPopup({ action: 'stateUpdated' });
  // Don't auto-advance on failure — user must click Retry or Skip
  state.isProcessing = false;
  await saveState(state);
}

async function updateCurrentPerson(msg) {
  const state = await getState();
  const person = state.queue[state.currentIndex];
  if (person) {
    person.step = msg.step;
    person.status = msg.status || person.status;
  }
  await saveState(state);
  notifyPopup({ action: 'stateUpdated' });
}

async function updateStatus(status, extra = {}) {
  const state = await getState();
  const person = state.queue[state.currentIndex];
  if (person) {
    person.status = status;
    Object.assign(person, extra);
  }
  await saveState(state);
}

// ===== Helpers =====

async function getState() {
  const data = await chrome.storage.local.get(['queue', 'currentIndex', 'isProcessing', 'currentResult']);
  return {
    queue: data.queue || [],
    currentIndex: data.currentIndex || 0,
    isProcessing: data.isProcessing || false,
    currentResult: data.currentResult || null
  };
}

async function saveState(state) {
  await chrome.storage.local.set({
    queue: state.queue,
    currentIndex: state.currentIndex,
    isProcessing: state.isProcessing
  });
}

async function getConfig() {
  const data = await chrome.storage.local.get('config');
  return data.config || {};
}

async function getUdyamTab() {
  const tabs = await chrome.tabs.query({ url: '*://*.udyamregistration.gov.in/UdyamRegistration.aspx*' });
  return tabs.length > 0 ? tabs[0] : null;
}

function notifyPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {}); // popup might be closed
}

// Sheet fetch (also called from options.js)
async function fetchSheet(cfg) {
  try {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(cfg.sheetRange || 'Sheet1!A1:Z')}?key=${cfg.apiKey}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    if (!data.values || data.values.length === 0) throw new Error('No data rows');

    // Map column headers from row 1, then parse data rows
    const headers = data.values[0] || [];
    const rows = data.values.slice(1).filter(r => r.some(c => c && c.trim()));

    const queue = rows.map((row, i) => {
      const obj = { id: i };
      headers.forEach((h, j) => {
        obj[h.trim()] = (row[j] || '').toString().trim();
      });
      obj.status = 'PENDING';
      obj.retryCount = 0;
      return obj;
    });

    const state = await getState();
    state.queue = queue;
    state.currentIndex = 0;
    state.isProcessing = false;
    await saveState(state);
    return queue;
  } catch (err) {
    console.error('Sheet fetch failed:', err);
    throw err;
  }
}


