/**
 * Background service worker - manages extension lifecycle and messaging.
 */

// Listen for extension install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Initialize default settings on first install
    const result = await chrome.storage.local.get('settings');
    if (!result.settings) {
      await chrome.storage.local.set({
        settings: {
          llmProvider: 'openai',
          apiKey: '',
          model: 'gpt-4o-mini',
          preferences: ['Technology', 'Software Engineering', 'Artificial Intelligence', 'Startups'],
          minLikes: 5,
          minComments: 2,
          maxPostAgeDays: 3,
          engageWithBigCreators: true,
          bigCreatorFollowerThreshold: 10000,
          savedCreators: [],
          maxPostsToEngage: 10,
          delayBetweenActions: 5,
          enableLiking: true,
          enableCommenting: true,
          commentTone: 'professional',
          commentMaxLength: 200,
          dailyEngagementLimit: 30,
          todayEngagementCount: 0,
          lastResetDate: null
        },
        state: {
          isRunning: false,
          currentPostIndex: 0,
          postsProcessed: 0,
          postsEngaged: 0,
          postsSkipped: 0,
          log: []
        }
      });
    }

    // Open settings on first install so user can configure API key
    chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
  }

  // Create daily reset alarm (safe to call on every install/update)
  chrome.alarms.create('dailyReset', { periodInMinutes: 60 });
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'CHECK_LOGIN') {
    chrome.tabs.query({ url: 'https://www.linkedin.com/*' }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'CHECK_LOGIN_STATUS' }, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ loggedIn: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse(response || { loggedIn: false });
          }
        });
      } else {
        sendResponse({ loggedIn: false });
      }
    });
    return true;
  }

  if (message.action === 'OPEN_SETTINGS') {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
    sendResponse({ opened: true });
    return false;
  }

  if (message.action === 'LLM_REQUEST') {
    handleLLMRequest(message.data)
      .then(result => {
        try {
          sendResponse({ success: true, data: result });
        } catch {
          // sendResponse may have already been called or port closed
        }
      })
      .catch(err => {
        try {
          sendResponse({ success: false, error: err.message });
        } catch {
          // sendResponse may have already been called or port closed
        }
      });
    return true; // Keep message channel open for async response
  }
});

async function handleLLMRequest(data) {
  const { provider, apiKey, model, messages } = data;

  if (!apiKey) {
    throw new Error('API key is not configured. Please add your API key in Settings.');
  }

  if (provider === 'anthropic') {
    const systemMsg = messages.find(m => m.role === 'system');
    const userMsgs = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: systemMsg ? systemMsg.content : '',
        messages: userMsgs
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${err}`);
    }

    const result = await response.json();
    if (!result.content || !result.content[0]) {
      throw new Error('Unexpected Anthropic API response format');
    }
    return result.content[0].text.trim();
  }

  // Default: OpenAI
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages,
      temperature: 0.7,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${err}`);
  }

  const result = await response.json();
  if (!result.choices || !result.choices[0]) {
    throw new Error('Unexpected OpenAI API response format');
  }
  return result.choices[0].message.content.trim();
}

// Handle daily reset alarm
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'dailyReset') {
    try {
      const result = await chrome.storage.local.get('settings');
      if (result.settings) {
        const today = new Date().toDateString();
        if (result.settings.lastResetDate !== today) {
          result.settings.todayEngagementCount = 0;
          result.settings.lastResetDate = today;
          await chrome.storage.local.set({ settings: result.settings });
        }
      }
    } catch (err) {
      console.error('[LAE Background] Daily reset error:', err);
    }
  }
});

// Log that background worker started
console.log('[LinkedIn Auto Engage] Background service worker started');
