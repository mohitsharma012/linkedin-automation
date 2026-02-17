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

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function refreshUI() {
    try {
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
          const safeType = escapeHtml(entry.type || 'info');
          const safeMsg = escapeHtml(entry.message || '');
          return `<div class="log-entry">
            <span class="log-time">${escapeHtml(time)}</span>
            <span class="log-msg log-${safeType}">${safeMsg}</span>
          </div>`;
        }).join('');
      }
    } catch (err) {
      console.error('[LAE Popup] refreshUI error:', err);
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
    const refreshedSettings = await Storage.getSettings();
    if (refreshedSettings.todayEngagementCount >= refreshedSettings.dailyEngagementLimit) {
      setStatus('error', '🚫', `Daily limit reached (${refreshedSettings.dailyEngagementLimit})`);
      return;
    }

    // Disable start button to prevent double-clicks
    startBtn.disabled = true;
    setStatus('running', '🔄', 'Opening LinkedIn...');

    try {
      // Find LinkedIn tab or open one
      const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });

      if (tabs.length === 0) {
        // Open LinkedIn
        const tab = await chrome.tabs.create({ url: 'https://www.linkedin.com/feed/' });
        waitForTabAndStart(tab.id);
      } else {
        // Use existing LinkedIn tab
        const tab = tabs[0];
        await chrome.tabs.update(tab.id, { active: true });

        // Check if we need to navigate to feed
        // Use try/catch since tab.url might not be accessible without tabs permission on the specific tab
        try {
          const tabInfo = await chrome.tabs.get(tab.id);
          const url = new URL(tabInfo.url);
          if (url.pathname !== '/feed/' && url.pathname !== '/feed') {
            await chrome.tabs.update(tab.id, { url: 'https://www.linkedin.com/feed/' });
            waitForTabAndStart(tab.id);
          } else {
            // Already on feed, inject and start
            await injectAndStart(tab.id);
          }
        } catch {
          // If we can't read URL, just try to start
          await injectAndStart(tab.id);
        }
      }
    } catch (err) {
      setStatus('error', '❌', 'Failed to open LinkedIn');
      await Storage.addLogEntry('Failed: ' + err.message, 'error');
      startBtn.disabled = false;
    }
  });

  function waitForTabAndStart(tabId) {
    chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // Give extra time for LinkedIn's JS to initialize
        setTimeout(() => injectAndStart(tabId), 2000);
      }
    });
  }

  async function injectAndStart(tabId) {
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

    // Always try to inject the content script first (it's idempotent due to IIFE check)
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content.js']
      });
    } catch (err) {
      console.log('[LAE] Script injection note:', err.message);
      // Content script may already be loaded via manifest, that's OK
    }

    // Give content script time to initialize
    await new Promise(resolve => setTimeout(resolve, 500));

    // Send start message with retries
    let started = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'START_AUTOMATION' });
        if (response && response.started) {
          started = true;
          break;
        }
      } catch {
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!started) {
      await Storage.addLogEntry('Failed to communicate with LinkedIn page. Try refreshing the page.', 'error');
      await Storage.saveState({
        ...(await Storage.getState()),
        isRunning: false
      });
      setStatus('error', '❌', 'Failed to start. Refresh LinkedIn page.');
    }

    startBtn.disabled = false;
    refreshUI();
  }

  // Stop button
  stopBtn.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'STOP_AUTOMATION' });
      } catch {
        // Tab might not have content script
      }
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
