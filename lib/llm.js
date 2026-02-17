/**
 * LLM integration for post relevance analysis and comment generation.
 * Supports OpenAI and Anthropic APIs.
 */
const LLM = {
  async callOpenAI(apiKey, model, messages) {
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

    const data = await response.json();
    return data.choices[0].message.content.trim();
  },

  async callAnthropic(apiKey, model, messages) {
    const systemMsg = messages.find(m => m.role === 'system');
    const userMsgs = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
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

    const data = await response.json();
    return data.content[0].text.trim();
  },

  async call(settings, messages) {
    if (!settings.apiKey) {
      throw new Error('API key not configured. Please add your API key in Settings.');
    }

    if (settings.llmProvider === 'anthropic') {
      return this.callAnthropic(settings.apiKey, settings.model, messages);
    }
    return this.callOpenAI(settings.apiKey, settings.model, messages);
  },

  /**
   * Analyze a post for relevance and engagement worthiness.
   * Returns: { relevant: boolean, shouldEngage: boolean, reason: string, score: number }
   */
  async analyzePost(settings, postData) {
    const messages = [
      {
        role: 'system',
        content: `You are a LinkedIn engagement analyst. Evaluate posts for relevance and engagement potential.

User's interest topics: ${settings.preferences.join(', ')}
Saved/Priority creators: ${settings.savedCreators.join(', ') || 'None'}
Minimum likes threshold: ${settings.minLikes}
Minimum comments threshold: ${settings.minComments}
Engage with big creators (${settings.bigCreatorFollowerThreshold}+ followers): ${settings.engageWithBigCreators}

Respond ONLY with valid JSON, no markdown fences or extra text.`
      },
      {
        role: 'user',
        content: `Analyze this LinkedIn post:

Author: ${postData.authorName}
Author Headline: ${postData.authorHeadline || 'Unknown'}
Post Content: ${postData.content}
Likes: ${postData.likeCount}
Comments: ${postData.commentCount}
Post Age: ${postData.postAge || 'Unknown'}

Evaluate:
1. Is this post relevant to the user's interests? (topic match)
2. Is the engagement level sufficient? (likes/comments vs thresholds)
3. Is the author a notable/big creator worth engaging with?
4. Is this post worth commenting on? (has substance for meaningful conversation)

Return JSON:
{
  "relevant": true/false,
  "topicMatch": true/false,
  "engagementSufficient": true/false,
  "notableAuthor": true/false,
  "shouldEngage": true/false,
  "score": 0-100,
  "reason": "brief explanation"
}`
      }
    ];

    const response = await this.call(settings, messages);
    try {
      // Strip markdown fences if present
      const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return {
        relevant: false,
        shouldEngage: false,
        score: 0,
        reason: 'Failed to parse LLM response'
      };
    }
  },

  /**
   * Generate a thoughtful comment for a post.
   */
  async generateComment(settings, postData) {
    const toneDescriptions = {
      professional: 'professional and insightful',
      casual: 'friendly and conversational',
      enthusiastic: 'enthusiastic and supportive',
      thoughtful: 'thoughtful and analytical'
    };

    const tone = toneDescriptions[settings.commentTone] || 'professional and insightful';

    const messages = [
      {
        role: 'system',
        content: `You are a LinkedIn user writing comments on posts. Write ${tone} comments.

Rules:
- Keep comments under ${settings.commentMaxLength} characters
- Be genuine and add value to the conversation
- Reference specific points from the post
- Do NOT use hashtags
- Do NOT be overly promotional
- Sound like a real person, not a bot
- Do NOT start with "Great post!" or similar generic openers
- Match the language of the original post

Respond with ONLY the comment text, nothing else.`
      },
      {
        role: 'user',
        content: `Write a comment for this LinkedIn post:

Author: ${postData.authorName}
Content: ${postData.content}

User's interests for context: ${settings.preferences.join(', ')}`
      }
    ];

    return this.call(settings, messages);
  }
};

if (typeof module !== 'undefined') {
  module.exports = LLM;
}
