# LinkedIn Auto Engage - Chrome Extension

AI-powered Chrome extension that automatically analyzes and engages with relevant LinkedIn posts based on your preferences.

## Features

- **Smart Post Analysis**: Uses LLM (OpenAI/Anthropic) to evaluate post relevance based on your interest topics
- **Auto Like & Comment**: Automatically likes and generates thoughtful, context-aware comments
- **Customizable Preferences**: Select topics you care about (Technology, AI, Marketing, etc.)
- **Engagement Criteria**: Set minimum likes/comments thresholds, post age limits
- **Priority Creators**: Save specific creators to always engage with their content
- **Safety Controls**: Daily engagement limits, configurable delays between actions, session limits
- **Comment Tone Settings**: Choose between professional, casual, enthusiastic, or thoughtful tones
- **Activity Log**: Real-time logging of all actions with status overlay on LinkedIn

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked** and select the project folder
5. The extension icon will appear in your Chrome toolbar

## Setup

1. Click the extension icon in your toolbar
2. Click **Settings** to configure:
   - Add your OpenAI or Anthropic API key
   - Select your interest topics
   - Configure engagement thresholds
   - Add priority creators
   - Set daily limits and delays
3. Navigate to LinkedIn and make sure you're logged in
4. Click **Start** in the extension popup

## Configuration Options

| Setting | Description | Default |
|---------|-------------|---------|
| LLM Provider | OpenAI or Anthropic | OpenAI |
| Model | LLM model to use | gpt-4o-mini |
| Interest Topics | Topics to match posts against | Technology, Software Engineering, AI, Startups |
| Min Likes | Minimum likes for a post to qualify | 5 |
| Min Comments | Minimum comments for a post to qualify | 2 |
| Max Post Age | Maximum post age in days | 3 |
| Posts Per Session | Max posts to engage with per run | 10 |
| Delay Between Actions | Seconds between each interaction | 5 |
| Daily Limit | Maximum engagements per day | 30 |
| Comment Tone | Style of generated comments | Professional |
| Comment Max Length | Maximum comment character count | 200 |

## Project Structure

```
linkedin-automation/
├── manifest.json              # Chrome extension manifest (v3)
├── popup/
│   ├── popup.html             # Extension popup UI
│   ├── popup.css              # Popup styles
│   └── popup.js               # Popup logic
├── settings/
│   ├── settings.html          # Full settings page
│   ├── settings.css           # Settings styles
│   └── settings.js            # Settings logic
├── background/
│   └── background.js          # Service worker (LLM proxy, lifecycle)
├── content/
│   ├── content.js             # LinkedIn page interaction & automation
│   └── content.css            # Overlay styles injected into LinkedIn
├── lib/
│   ├── storage.js             # Storage utility for settings/state
│   └── llm.js                 # LLM API integration
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## How It Works

1. **Login Detection**: Checks if you're logged into LinkedIn
2. **Feed Navigation**: Navigates to your LinkedIn feed
3. **Post Scanning**: Scrolls through the feed, extracting post content
4. **LLM Analysis**: Sends each post to the configured LLM to evaluate:
   - Topic relevance to your interests
   - Engagement metrics vs your thresholds
   - Author notability
   - Whether the post warrants a meaningful comment
5. **Engagement**: If a post passes all criteria:
   - Likes the post (if enabled)
   - Generates and posts a contextual comment (if enabled)
6. **Rate Limiting**: Waits between actions with randomized delays

## Important Notes

- You need a valid OpenAI or Anthropic API key for the LLM features
- The extension uses randomized delays to mimic human behavior
- Daily engagement limits help keep your account safe
- Always review and adjust settings to match your preferences
- LinkedIn may update their DOM structure; selectors may need updating
