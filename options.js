// Options page — save config, test connection via background worker
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const data = await chrome.storage.local.get('config');
    const cfg = data.config || {};

    for (const id of ['sheetId', 'apiKey', 'sheetRange', 'nic2', 'nic4', 'nic5',
      'orgType', 'sector', 'gstApplicable', 'defaultEmployees',
      'actionDelay', 'otpTimeout']) {
      const el = document.getElementById(id);
      if (el) {
        if (el.type === 'checkbox') el.checked = cfg[id] ?? false;
        else el.value = cfg[id] ?? '';
      }
    }

    const dryRunEl = document.getElementById('dryRun');
    if (dryRunEl) dryRunEl.checked = cfg.dryRun || false;

    document.querySelectorAll('.fld').forEach(el => {
      el.value = cfg[el.dataset.key] || '';
    });

    document.getElementById('saveBtn').addEventListener('click', save);
    document.getElementById('testBtn').addEventListener('click', testConnection);
  } catch (err) {
    showStatus('Load error: ' + err.message, 'error');
  }
});

async function save() {
  try {
    const get = id => {
      const el = document.getElementById(id);
      if (!el) return '';
      return el.type === 'checkbox' ? el.checked : el.value.trim();
    };

    const config = {
      sheetId: get('sheetId'),
      apiKey: get('apiKey'),
      sheetRange: get('sheetRange') || 'Sheet1!A1:Z',
      nic2: get('nic2') || '66',
      nic4: get('nic4') || '6619',
      nic5: get('nic5') || '66190',
      orgType: get('orgType') || 'Proprietorship',
      sector: get('sector') || 'Services',
      gstApplicable: get('gstApplicable') || 'No',
      defaultEmployees: parseInt(get('defaultEmployees')) || 1,
      actionDelay: parseInt(get('actionDelay')) || 800,
      otpTimeout: parseInt(get('otpTimeout')) || 180,
      dryRun: !!get('dryRun')
    };

    document.querySelectorAll('.fld').forEach(el => {
      if (el.value.trim()) config[el.dataset.key] = el.value.trim();
    });

    if (!config.sheetId || !config.apiKey) {
      showStatus('Sheet ID and API Key are required.', 'error');
      return;
    }

    await chrome.storage.local.set({ config, queue: [], currentIndex: 0, isProcessing: false });
    showStatus('✅ Config saved! Click "Test Connection" to verify sheet access.', 'success');
  } catch (err) {
    showStatus('Save error: ' + err.message, 'error');
  }
}

async function testConnection() {
  showStatus('Testing connection...', 'info');
  try {
    chrome.runtime.sendMessage({ action: 'fetchSheet' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Extension error: ' + chrome.runtime.lastError.message + '. Try refreshing extension on chrome://extensions/', 'error');
        return;
      }
      if (response && response.ok) {
        showStatus(`✅ Sheet connected! Found ${response.count} registrant(s).`, 'success');
      } else {
        const errMsg = response?.error || 'Unknown error';
        showStatus(`❌ ${errMsg}`, 'error');
      }
    });
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  }
}

function showStatus(msg, type) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg;
  el.className = type || '';
  el.style.display = 'block';
  el.style.padding = '12px 16px';
  el.style.marginTop = '12px';
  el.style.borderRadius = '6px';
  el.style.fontWeight = '500';
  if (type === 'success') {
    el.style.background = '#d4edda';
    el.style.color = '#155724';
    el.style.border = '1px solid #c3e6cb';
  } else if (type === 'error') {
    el.style.background = '#f8d7da';
    el.style.color = '#721c24';
    el.style.border = '1px solid #f5c6cb';
  } else {
    el.style.background = '#cce5ff';
    el.style.color = '#004085';
    el.style.border = '1px solid #b8daff';
  }
}
