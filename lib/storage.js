/**
 * Storage utility for managing extension settings and state.
 */
const Storage = {
  DEFAULT_SETTINGS: {
    // LLM Configuration
    llmProvider: 'openai',
    apiKey: '',
    model: 'gpt-4o-mini',

    // User Preferences - topics the user is interested in
    preferences: [
      'Technology',
      'Software Engineering',
      'Artificial Intelligence',
      'Startups'
    ],

    // Engagement Criteria
    minLikes: 5,
    minComments: 2,
    maxPostAgeDays: 3,
    engageWithBigCreators: true,
    bigCreatorFollowerThreshold: 10000,

    // Saved creators to always engage with
    savedCreators: [],

    // Automation Settings
    maxPostsToEngage: 10,
    delayBetweenActions: 5, // seconds
    enableLiking: true,
    enableCommenting: true,

    // Comment style
    commentTone: 'professional',
    commentMaxLength: 200,

    // Safety
    dailyEngagementLimit: 30,
    todayEngagementCount: 0,
    lastResetDate: null
  },

  async get(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, resolve);
    });
  },

  async set(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, resolve);
    });
  },

  async getSettings() {
    const result = await this.get({ settings: this.DEFAULT_SETTINGS });
    return { ...this.DEFAULT_SETTINGS, ...result.settings };
  },

  async saveSettings(settings) {
    await this.set({ settings });
  },

  async getState() {
    const result = await this.get({
      state: {
        isRunning: false,
        currentPostIndex: 0,
        postsProcessed: 0,
        postsEngaged: 0,
        postsSkipped: 0,
        log: []
      }
    });
    return result.state;
  },

  async saveState(state) {
    await this.set({ state });
  },

  async addLogEntry(message, type = 'info') {
    const state = await this.getState();
    state.log.unshift({
      message,
      type,
      timestamp: new Date().toISOString()
    });
    // Keep only last 100 log entries
    state.log = state.log.slice(0, 100);
    await this.saveState(state);
  },

  async resetDailyCount() {
    const settings = await this.getSettings();
    const today = new Date().toDateString();
    if (settings.lastResetDate !== today) {
      settings.todayEngagementCount = 0;
      settings.lastResetDate = today;
      await this.saveSettings(settings);
    }
  },

  async incrementEngagement() {
    const settings = await this.getSettings();
    settings.todayEngagementCount = (settings.todayEngagementCount || 0) + 1;
    await this.saveSettings(settings);
    return settings.todayEngagementCount;
  }
};

if (typeof module !== 'undefined') {
  module.exports = Storage;
}
