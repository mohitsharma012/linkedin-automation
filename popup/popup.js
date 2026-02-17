/**
 * Popup script - handles UI interactions for the extension popup.
 */
document.addEventListener('DOMContentLoaded', async () => {
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const clearLogBtn = document.getElementById('clear-log-btn');
  const statusBanner = document.getElementById('status-banner');
  const statusIcon = document.getElementById('status-icon');
  const statusText = document.getElementById('status-text');
  const loginWarning = document.getElementById('login-warning');
  const apikeyWarning = document.getElementById('apikey-warning');
  const statsSection = document.getElementById('stats');
  const logSection = document.getElementById('log-section');
  const logContainer = document.getElementById('log-container');
  const settingsLinkWarn = document.getElementById('settings-link-warn');

  // Load current state
  await refreshUI();

  // Poll for updates while popup is open
  const pollInterval = setInterval(refreshUI, 1000);

  async function refreshUI() {
    const state = await Storage.getState();
    const settings = await Storage.getSettings();

    // Check API key
    if (!settings.apiKey) {
      apikeyWarning.classList.remove('hidden');
    } else {
      apikeyWarning.classList.add('hidden');
    }

    // Update buttons
    if (state.isRunning) {
      startBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
      setStatus('running', '🔄', `Processing posts... (${state.postsProcessed}/${settings.maxPostsToEngage})`);
    } else {
      startBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');
      if (state.postsProcessed > 0) {
        setStatus('done', '✅', `Done! Engaged with ${state.postsEngaged} posts`);
      } else {
        setStatus('idle', '⏸', 'Ready to start');
      }
    }

    // Update stats
    if (state.postsProcessed > 0 || state.isRunning) {
      statsSection.classList.remove('hidden');
      document.getElementById('stat-processed').textContent = state.postsProcessed;
      document.getElementById('stat-engaged').textContent = state.postsEngaged;
      document.getElementById('stat-skipped').textContent = state.postsSkipped;
      document.getElementById('stat-daily').textContent = settings.todayEngagementCount || 0;
    }

    // Update log
    if (state.log && state.log.length > 0) {
      logSection.classList.remove('hidden');
      logContainer.innerHTML = state.log.map(entry => {
        const time = new Date(entry.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });
        return `<div class="log-entry">
          <span class="log-time">${time}</span>
          <span class="log-msg log-${entry.type}">${entry.message}</span>
        </div>`;
      }).join('');
    }
  }

  function setStatus(type, icon, text) {
    statusBanner.className = `status-banner status-${type}`;
    statusIcon.textContent = icon;
    statusText.textContent = text;
  }

  // Start button
  startBtn.addEventListener('click', async () => {
    const settings = await Storage.getSettings();

    // Check API key
    if (!settings.apiKey) {
      apikeyWarning.classList.remove('hidden');
      return;
    }

    // Check daily limit
    await Storage.resetDailyCount();
    if (settings.todayEngagementCount >= settings.dailyEngagementLimit) {
      setStatus('error', '🚫', `Daily limit reached (${settings.dailyEngagementLimit})`);
      return;
    }

    // Find LinkedIn tab or open one
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });

    if (tabs.length === 0) {
      // Open LinkedIn
      const tab = await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/' });
      // Wait for the tab to load and then send start message
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          sendStartMessage(tab.id);
        }
      });
    } else {
      // Navigate to feed if not already there
      const tab = tabs[0];
      await chrome.tabs.update(tab.id, { active: true });
      const url = new URL(tab.url);
      if (url.pathname !== '/feed/' && url.pathname !== '/feed') {
        await chrome.tabs.update(tab.id, { url: 'https://www.linkedin.com/feed/' });
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === tab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            sendStartMessage(tab.id);
          }
        });
      } else {
        sendStartMessage(tab.id);
      }
    }
  });

  async function sendStartMessage(tabId) {
    // Reset state
    await Storage.saveState({
      isRunning: true,
      currentPostIndex: 0,
      postsProcessed: 0,
      postsEngaged: 0,
      postsSkipped: 0,
      log: []
    });
    await Storage.addLogEntry('Starting automation...', 'info');

    // Send message to content script
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'START_AUTOMATION' });
    } catch {
      // Content script might not be injected yet, inject it
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['lib/storage.js', 'lib/llm.js', 'content/content.js']
      });
      // Retry
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tabId, { action: 'START_AUTOMATION' });
        } catch (err) {
          await Storage.addLogEntry('Failed to start: ' + err.message, 'error');
          await Storage.saveState({
            ...(await Storage.getState()),
            isRunning: false
          });
        }
      }, 1000);
    }

    refreshUI();
  }

  // Stop button
  stopBtn.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'STOP_AUTOMATION' });
    }

    const state = await Storage.getState();
    state.isRunning = false;
    await Storage.saveState(state);
    await Storage.addLogEntry('Automation stopped by user', 'warning');
    refreshUI();
  });

  // Settings button
  settingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
  });

  settingsLinkWarn.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
  });

  // Clear log
  clearLogBtn.addEventListener('click', async () => {
    const state = await Storage.getState();
    state.log = [];
    state.postsProcessed = 0;
    state.postsEngaged = 0;
    state.postsSkipped = 0;
    await Storage.saveState(state);
    logSection.classList.add('hidden');
    statsSection.classList.add('hidden');
    refreshUI();
  });

  // Clean up on popup close
  window.addEventListener('unload', () => {
    clearInterval(pollInterval);
  });
});
