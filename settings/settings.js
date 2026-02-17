/**
 * Settings page script - manages extension configuration.
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Load current settings
  const settings = await Storage.getSettings();

  // --- LLM Configuration ---
  const llmProvider = document.getElementById('llm-provider');
  const apiKey = document.getElementById('api-key');
  const model = document.getElementById('model');
  const modelHint = document.getElementById('model-hint');
  const toggleKey = document.getElementById('toggle-key');

  llmProvider.value = settings.llmProvider;
  apiKey.value = settings.apiKey;
  model.value = settings.model;
  updateModelHint();

  llmProvider.addEventListener('change', () => {
    updateModelHint();
    if (llmProvider.value === 'openai' && (!model.value || model.value.startsWith('claude'))) {
      model.value = 'gpt-4o-mini';
    } else if (llmProvider.value === 'anthropic' && (!model.value || model.value.startsWith('gpt'))) {
      model.value = 'claude-sonnet-4-20250514';
    }
  });

  function updateModelHint() {
    if (llmProvider.value === 'openai') {
      modelHint.textContent = 'Recommended: gpt-4o-mini (fast and affordable)';
    } else {
      modelHint.textContent = 'Recommended: claude-sonnet-4-20250514';
    }
  }

  toggleKey.addEventListener('click', () => {
    apiKey.type = apiKey.type === 'password' ? 'text' : 'password';
  });

  // --- Preferences Tags ---
  let preferences = [...settings.preferences];
  const preferencesContainer = document.getElementById('preferences-tags');
  const newPreferenceInput = document.getElementById('new-preference');
  const addPreferenceBtn = document.getElementById('add-preference');

  function renderPreferences() {
    preferencesContainer.innerHTML = preferences.map((pref, i) =>
      `<span class="tag">${pref}<span class="tag-remove" data-index="${i}">&times;</span></span>`
    ).join('');

    // Update preset buttons
    document.querySelectorAll('.btn-preset').forEach(btn => {
      btn.classList.toggle('active', preferences.includes(btn.dataset.topic));
    });
  }

  renderPreferences();

  preferencesContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('tag-remove')) {
      const idx = parseInt(e.target.dataset.index);
      preferences.splice(idx, 1);
      renderPreferences();
    }
  });

  addPreferenceBtn.addEventListener('click', () => {
    const val = newPreferenceInput.value.trim();
    if (val && !preferences.includes(val)) {
      preferences.push(val);
      renderPreferences();
      newPreferenceInput.value = '';
    }
  });

  newPreferenceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPreferenceBtn.click();
  });

  // Preset topic buttons
  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const topic = btn.dataset.topic;
      if (preferences.includes(topic)) {
        preferences = preferences.filter(p => p !== topic);
      } else {
        preferences.push(topic);
      }
      renderPreferences();
    });
  });

  // --- Engagement Criteria ---
  document.getElementById('min-likes').value = settings.minLikes;
  document.getElementById('min-comments').value = settings.minComments;
  document.getElementById('max-post-age').value = settings.maxPostAgeDays;
  document.getElementById('engage-big-creators').checked = settings.engageWithBigCreators;
  document.getElementById('big-creator-threshold').value = settings.bigCreatorFollowerThreshold;

  // --- Saved Creators ---
  let savedCreators = [...settings.savedCreators];
  const creatorsContainer = document.getElementById('creators-tags');
  const newCreatorInput = document.getElementById('new-creator');
  const addCreatorBtn = document.getElementById('add-creator');

  function renderCreators() {
    creatorsContainer.innerHTML = savedCreators.map((name, i) =>
      `<span class="tag">${name}<span class="tag-remove" data-index="${i}">&times;</span></span>`
    ).join('');
  }

  renderCreators();

  creatorsContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('tag-remove')) {
      const idx = parseInt(e.target.dataset.index);
      savedCreators.splice(idx, 1);
      renderCreators();
    }
  });

  addCreatorBtn.addEventListener('click', () => {
    const val = newCreatorInput.value.trim();
    if (val && !savedCreators.includes(val)) {
      savedCreators.push(val);
      renderCreators();
      newCreatorInput.value = '';
    }
  });

  newCreatorInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addCreatorBtn.click();
  });

  // --- Automation Settings ---
  document.getElementById('max-posts').value = settings.maxPostsToEngage;
  document.getElementById('delay-between').value = settings.delayBetweenActions;
  document.getElementById('daily-limit').value = settings.dailyEngagementLimit;
  document.getElementById('enable-liking').checked = settings.enableLiking;
  document.getElementById('enable-commenting').checked = settings.enableCommenting;

  // --- Comment Settings ---
  document.getElementById('comment-tone').value = settings.commentTone;
  document.getElementById('comment-max-length').value = settings.commentMaxLength;

  // --- Save ---
  document.getElementById('save-btn').addEventListener('click', async () => {
    const updatedSettings = {
      ...settings,
      llmProvider: llmProvider.value,
      apiKey: apiKey.value,
      model: model.value,
      preferences,
      minLikes: parseInt(document.getElementById('min-likes').value) || 0,
      minComments: parseInt(document.getElementById('min-comments').value) || 0,
      maxPostAgeDays: parseInt(document.getElementById('max-post-age').value) || 3,
      engageWithBigCreators: document.getElementById('engage-big-creators').checked,
      bigCreatorFollowerThreshold: parseInt(document.getElementById('big-creator-threshold').value) || 10000,
      savedCreators,
      maxPostsToEngage: parseInt(document.getElementById('max-posts').value) || 10,
      delayBetweenActions: Math.max(2, parseInt(document.getElementById('delay-between').value) || 5),
      dailyEngagementLimit: parseInt(document.getElementById('daily-limit').value) || 30,
      enableLiking: document.getElementById('enable-liking').checked,
      enableCommenting: document.getElementById('enable-commenting').checked,
      commentTone: document.getElementById('comment-tone').value,
      commentMaxLength: parseInt(document.getElementById('comment-max-length').value) || 200
    };

    await Storage.saveSettings(updatedSettings);
    showToast();
  });

  // --- Reset ---
  document.getElementById('reset-btn').addEventListener('click', async () => {
    if (confirm('Reset all settings to defaults? This cannot be undone.')) {
      await Storage.saveSettings(Storage.DEFAULT_SETTINGS);
      location.reload();
    }
  });

  function showToast() {
    const toast = document.getElementById('save-toast');
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 2000);
  }
});
