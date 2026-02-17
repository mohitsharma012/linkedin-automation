/**
 * Content script - runs on LinkedIn pages.
 * Handles login detection, post scraping, and engagement automation.
 */

(() => {
  'use strict';

  let isRunning = false;
  let shouldStop = false;
  let overlay = null;

  // ==========================================
  // UTILITY FUNCTIONS
  // ==========================================

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function randomDelay(baseMs) {
    // Add 20-80% random variance for human-like behavior
    const variance = baseMs * (0.2 + Math.random() * 0.6);
    return baseMs + variance;
  }

  // ==========================================
  // LOGIN DETECTION
  // ==========================================

  function isLoggedIn() {
    // Check for common logged-in indicators on LinkedIn
    const feedNav = document.querySelector('.global-nav');
    const profileNav = document.querySelector('.global-nav__me');
    const loginForm = document.querySelector('.login__form');
    const authWall = document.querySelector('.authwall-join-form');

    if (loginForm || authWall) return false;
    if (feedNav || profileNav) return true;

    // Fallback: check URL
    const path = window.location.pathname;
    if (path.includes('/login') || path.includes('/signup') || path === '/') {
      return false;
    }
    return true;
  }

  // ==========================================
  // POST SCRAPING
  // ==========================================

  function getAllFeedPosts() {
    // LinkedIn feed post containers
    const selectors = [
      '.feed-shared-update-v2',
      '[data-urn*="activity"]',
      '.occludable-update'
    ];

    for (const selector of selectors) {
      const posts = document.querySelectorAll(selector);
      if (posts.length > 0) return Array.from(posts);
    }
    return [];
  }

  function extractPostData(postElement) {
    const data = {
      element: postElement,
      authorName: '',
      authorHeadline: '',
      content: '',
      likeCount: 0,
      commentCount: 0,
      postAge: '',
      alreadyLiked: false
    };

    try {
      // Author name
      const authorEl = postElement.querySelector(
        '.update-components-actor__name .visually-hidden,' +
        '.update-components-actor__title .visually-hidden,' +
        '.feed-shared-actor__name .visually-hidden,' +
        '.update-components-actor__name span[aria-hidden="true"]'
      );
      if (authorEl) {
        data.authorName = authorEl.textContent.trim();
      }

      // Author headline
      const headlineEl = postElement.querySelector(
        '.update-components-actor__description .visually-hidden,' +
        '.feed-shared-actor__description .visually-hidden,' +
        '.update-components-actor__subtitle .visually-hidden'
      );
      if (headlineEl) {
        data.authorHeadline = headlineEl.textContent.trim();
      }

      // Post content
      const contentEl = postElement.querySelector(
        '.feed-shared-update-v2__description,' +
        '.update-components-text,' +
        '.feed-shared-text,' +
        '.break-words'
      );
      if (contentEl) {
        data.content = contentEl.textContent.trim().substring(0, 2000);
      }

      // Like count
      const likeCountEl = postElement.querySelector(
        '.social-details-social-counts__reactions-count,' +
        '[data-test-id="social-actions__reaction-count"],' +
        '.reactions-count'
      );
      if (likeCountEl) {
        data.likeCount = parseReactionCount(likeCountEl.textContent.trim());
      }

      // Comment count
      const commentCountEl = postElement.querySelector(
        '.social-details-social-counts__comments,' +
        'button[aria-label*="comment"]'
      );
      if (commentCountEl) {
        const text = commentCountEl.textContent.trim();
        data.commentCount = parseReactionCount(text);
      }

      // Post age
      const timeEl = postElement.querySelector(
        '.update-components-actor__sub-description .visually-hidden,' +
        '.feed-shared-actor__sub-description .visually-hidden,' +
        'time'
      );
      if (timeEl) {
        data.postAge = timeEl.textContent.trim();
      }

      // Already liked check
      const likeBtn = postElement.querySelector(
        'button[aria-label*="Like"],' +
        'button[aria-label*="like"],' +
        '.reactions-react-button'
      );
      if (likeBtn) {
        const pressed = likeBtn.getAttribute('aria-pressed');
        data.alreadyLiked = pressed === 'true';
      }

    } catch (err) {
      console.error('[LAE] Error extracting post data:', err);
    }

    return data;
  }

  function parseReactionCount(text) {
    if (!text) return 0;
    // Extract numbers, handle "1,234" and "1.2K" etc.
    const cleaned = text.replace(/[^0-9.,kKmM]/g, '').trim();
    if (!cleaned) return 0;

    if (/[kK]$/i.test(cleaned)) {
      return Math.round(parseFloat(cleaned) * 1000);
    }
    if (/[mM]$/i.test(cleaned)) {
      return Math.round(parseFloat(cleaned) * 1000000);
    }
    return parseInt(cleaned.replace(/,/g, '')) || 0;
  }

  // ==========================================
  // POST ENGAGEMENT (Like & Comment)
  // ==========================================

  async function likePost(postElement) {
    const likeBtn = postElement.querySelector(
      'button[aria-label*="Like"],' +
      'button[aria-label*="like"],' +
      '.reactions-react-button'
    );

    if (!likeBtn) {
      throw new Error('Like button not found');
    }

    // Check if already liked
    if (likeBtn.getAttribute('aria-pressed') === 'true') {
      return false; // Already liked
    }

    // Scroll to the button
    likeBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(500);

    // Click like
    likeBtn.click();
    await sleep(1000);

    // Verify
    return likeBtn.getAttribute('aria-pressed') === 'true';
  }

  async function commentOnPost(postElement, commentText) {
    // Find and click the comment button to open comment box
    const commentBtn = postElement.querySelector(
      'button[aria-label*="Comment"],' +
      'button[aria-label*="comment"]'
    );

    if (!commentBtn) {
      throw new Error('Comment button not found');
    }

    commentBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(500);
    commentBtn.click();
    await sleep(1500);

    // Find the comment text box
    const commentBox = postElement.querySelector(
      '.ql-editor[data-placeholder],' +
      '.comments-comment-box__form .ql-editor,' +
      '[role="textbox"][contenteditable="true"],' +
      '.editor-content [contenteditable="true"]'
    );

    if (!commentBox) {
      // Try finding it in the broader DOM (comment boxes sometimes render outside post element)
      const allEditors = document.querySelectorAll(
        '.ql-editor[data-placeholder="Add a comment…"],' +
        '.ql-editor[data-placeholder="Add a comment..."],' +
        '[role="textbox"][contenteditable="true"][aria-label*="comment" i]'
      );
      if (allEditors.length === 0) {
        throw new Error('Comment text box not found');
      }
      // Use the last one (most recently opened)
      const editor = allEditors[allEditors.length - 1];
      return await typeAndSubmitComment(editor, commentText);
    }

    return await typeAndSubmitComment(commentBox, commentText);
  }

  async function typeAndSubmitComment(editor, commentText) {
    // Focus the editor
    editor.focus();
    await sleep(300);

    // Clear any existing content
    editor.innerHTML = '';
    await sleep(100);

    // Type the comment character by character for human-like behavior
    // (we'll do it in chunks for speed while still looking natural)
    const words = commentText.split(' ');
    for (let i = 0; i < words.length; i++) {
      const word = (i > 0 ? ' ' : '') + words[i];
      editor.textContent += word;

      // Dispatch input event so LinkedIn recognizes the change
      editor.dispatchEvent(new Event('input', { bubbles: true }));

      // Small random delay between words
      await sleep(50 + Math.random() * 100);
    }

    await sleep(500);

    // Find and click submit button
    // LinkedIn's comment submit is usually a button near the editor
    const formContainer = editor.closest('.comments-comment-box') ||
                          editor.closest('.comments-comment-texteditor') ||
                          editor.closest('[class*="comment"]') ||
                          editor.parentElement.parentElement.parentElement;

    const submitBtn = formContainer
      ? formContainer.querySelector(
          'button.comments-comment-box__submit-button,' +
          'button[type="submit"],' +
          'button[aria-label*="Post"],' +
          'button[aria-label*="Submit"]'
        )
      : null;

    if (!submitBtn) {
      // Try keyboard shortcut: Ctrl+Enter or Cmd+Enter
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
        bubbles: true
      }));
      await sleep(1000);
      return true;
    }

    // Wait for button to be enabled
    await sleep(500);
    submitBtn.click();
    await sleep(1000);
    return true;
  }

  // ==========================================
  // SCROLLING
  // ==========================================

  async function scrollToLoadMore() {
    const previousHeight = document.documentElement.scrollHeight;
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'smooth'
    });
    await sleep(2000);

    // Check if new content loaded
    return document.documentElement.scrollHeight > previousHeight;
  }

  async function scrollToPost(postElement) {
    postElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(800);
  }

  // ==========================================
  // LLM CALLS VIA BACKGROUND
  // ==========================================

  async function callLLM(settings, messages) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'LLM_REQUEST',
        data: {
          provider: settings.llmProvider,
          apiKey: settings.apiKey,
          model: settings.model,
          messages
        }
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response ? response.error : 'No response from background'));
        }
      });
    });
  }

  async function analyzePostWithLLM(settings, postData) {
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
Post Content: ${postData.content.substring(0, 1500)}
Likes: ${postData.likeCount}
Comments: ${postData.commentCount}
Post Age: ${postData.postAge || 'Unknown'}

Evaluate:
1. Is this post relevant to the user's interests?
2. Is the engagement level sufficient?
3. Is the author a notable/big creator worth engaging with?
4. Is this post worth commenting on?

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

    const response = await callLLM(settings, messages);
    try {
      const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return { relevant: false, shouldEngage: false, score: 0, reason: 'Failed to parse LLM response' };
    }
  }

  async function generateCommentWithLLM(settings, postData) {
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
- Be genuine and add value
- Reference specific points from the post
- Do NOT use hashtags
- Do NOT be promotional
- Sound like a real person
- Do NOT start with "Great post!" or similar generic openers
- Match the language of the original post

Respond with ONLY the comment text, nothing else.`
      },
      {
        role: 'user',
        content: `Write a comment for this LinkedIn post:

Author: ${postData.authorName}
Content: ${postData.content.substring(0, 1500)}

User's interests for context: ${settings.preferences.join(', ')}`
      }
    ];

    return await callLLM(settings, messages);
  }

  // ==========================================
  // OVERLAY UI
  // ==========================================

  function createOverlay() {
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.className = 'lae-overlay';
    overlay.innerHTML = `
      <button class="lae-overlay-minimize" id="lae-minimize">_</button>
      <div class="lae-overlay-header">LinkedIn Auto Engage</div>
      <div class="lae-overlay-status" id="lae-status">Starting...</div>
      <div class="lae-overlay-progress">
        <div class="lae-overlay-progress-bar" id="lae-progress" style="width: 0%"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('lae-minimize').addEventListener('click', () => {
      const isMinimized = overlay.style.minWidth === '40px';
      if (isMinimized) {
        overlay.style.minWidth = '220px';
        overlay.querySelector('.lae-overlay-header').style.display = '';
        overlay.querySelector('.lae-overlay-status').style.display = '';
        overlay.querySelector('.lae-overlay-progress').style.display = '';
      } else {
        overlay.style.minWidth = '40px';
        overlay.querySelector('.lae-overlay-header').style.display = 'none';
        overlay.querySelector('.lae-overlay-status').style.display = 'none';
        overlay.querySelector('.lae-overlay-progress').style.display = 'none';
      }
    });
  }

  function updateOverlay(status, progress) {
    if (!overlay) return;
    const statusEl = document.getElementById('lae-status');
    const progressEl = document.getElementById('lae-progress');
    if (statusEl) statusEl.textContent = status;
    if (progressEl) progressEl.style.width = `${progress}%`;
  }

  function removeOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  // ==========================================
  // MAIN AUTOMATION LOOP
  // ==========================================

  async function runAutomation() {
    if (isRunning) return;
    isRunning = true;
    shouldStop = false;

    const settings = await getSettings();
    const state = await getState();

    // Check login
    if (!isLoggedIn()) {
      await addLog('Not logged in to LinkedIn. Please log in first.', 'error');
      await updateState({ isRunning: false });
      isRunning = false;
      return;
    }

    await addLog('Logged in. Starting post analysis...', 'success');
    createOverlay();

    // Ensure we're on the feed
    if (!window.location.pathname.startsWith('/feed')) {
      window.location.href = 'https://www.linkedin.com/feed/';
      return; // Page will reload, content script re-runs
    }

    // Wait for feed to load
    await sleep(2000);

    let postsProcessed = 0;
    let postsEngaged = 0;
    let postsSkipped = 0;
    let processedPostElements = new Set();
    const maxPosts = settings.maxPostsToEngage;

    while (postsEngaged < maxPosts && !shouldStop) {
      // Check daily limit
      const currentSettings = await getSettings();
      if ((currentSettings.todayEngagementCount || 0) >= currentSettings.dailyEngagementLimit) {
        await addLog(`Daily engagement limit (${currentSettings.dailyEngagementLimit}) reached. Stopping.`, 'warning');
        break;
      }

      // Get all visible posts
      const posts = getAllFeedPosts();
      let foundNewPost = false;

      for (const postEl of posts) {
        if (shouldStop) break;
        if (processedPostElements.has(postEl)) continue;
        processedPostElements.add(postEl);
        foundNewPost = true;

        postsProcessed++;
        const progress = Math.round((postsProcessed / (maxPosts * 2)) * 100);
        updateOverlay(`Analyzing post ${postsProcessed}...`, Math.min(progress, 95));

        // Extract post data
        const postData = extractPostData(postEl);

        if (!postData.content || postData.content.length < 20) {
          postsSkipped++;
          await addLog(`Post ${postsProcessed}: Skipped (no/short content)`, 'skip');
          await updateState({ postsProcessed, postsEngaged, postsSkipped });
          continue;
        }

        // Check if already liked
        if (postData.alreadyLiked) {
          postsSkipped++;
          await addLog(`Post ${postsProcessed}: Skipped (already engaged)`, 'skip');
          await updateState({ postsProcessed, postsEngaged, postsSkipped });
          continue;
        }

        await addLog(`Post ${postsProcessed}: Analyzing "${postData.authorName}" - ${postData.content.substring(0, 60)}...`, 'info');

        // Scroll to post
        await scrollToPost(postEl);

        // Highlight post being analyzed
        postEl.classList.add('lae-highlight-post');

        try {
          // Use LLM to analyze post
          const analysis = await analyzePostWithLLM(settings, postData);

          // Check if we should also engage based on saved creators
          const isSavedCreator = settings.savedCreators.some(
            creator => postData.authorName.toLowerCase().includes(creator.toLowerCase())
          );

          if (analysis.shouldEngage || isSavedCreator) {
            await addLog(
              `Post ${postsProcessed}: RELEVANT (score: ${analysis.score}) - ${analysis.reason}`,
              'success'
            );

            updateOverlay(`Engaging with post ${postsProcessed}...`, Math.min(progress, 95));

            // Like the post
            if (settings.enableLiking) {
              try {
                const liked = await likePost(postEl);
                if (liked) {
                  await addLog(`Post ${postsProcessed}: Liked!`, 'success');
                } else {
                  await addLog(`Post ${postsProcessed}: Already liked`, 'info');
                }
              } catch (err) {
                await addLog(`Post ${postsProcessed}: Like failed - ${err.message}`, 'warning');
              }
              await sleep(randomDelay(settings.delayBetweenActions * 500));
            }

            // Comment on the post
            if (settings.enableCommenting) {
              try {
                updateOverlay(`Generating comment for post ${postsProcessed}...`, Math.min(progress, 95));
                const comment = await generateCommentWithLLM(settings, postData);

                if (comment && comment.length > 10) {
                  await addLog(`Post ${postsProcessed}: Commenting: "${comment.substring(0, 80)}..."`, 'info');
                  await sleep(randomDelay(1000));
                  await commentOnPost(postEl, comment);
                  await addLog(`Post ${postsProcessed}: Comment posted!`, 'success');
                }
              } catch (err) {
                await addLog(`Post ${postsProcessed}: Comment failed - ${err.message}`, 'warning');
              }
            }

            postsEngaged++;
            await incrementEngagement();

          } else {
            postsSkipped++;
            await addLog(
              `Post ${postsProcessed}: Skipped - ${analysis.reason}`,
              'skip'
            );
          }

        } catch (err) {
          postsSkipped++;
          await addLog(`Post ${postsProcessed}: Error - ${err.message}`, 'error');
        }

        // Remove highlight
        postEl.classList.remove('lae-highlight-post');

        // Update state
        await updateState({ postsProcessed, postsEngaged, postsSkipped });

        // Delay between posts
        await sleep(randomDelay(settings.delayBetweenActions * 1000));

        if (postsEngaged >= maxPosts) break;
      }

      // If we didn't find any new posts, scroll to load more
      if (!foundNewPost || posts.length === 0) {
        updateOverlay('Loading more posts...', Math.min(90, Math.round((postsProcessed / (maxPosts * 2)) * 100)));
        const loaded = await scrollToLoadMore();
        if (!loaded) {
          await addLog('No more posts to load. Stopping.', 'warning');
          break;
        }
        await sleep(2000);
      }
    }

    // Done
    const finalMsg = shouldStop
      ? `Stopped. Processed: ${postsProcessed}, Engaged: ${postsEngaged}, Skipped: ${postsSkipped}`
      : `Complete! Processed: ${postsProcessed}, Engaged: ${postsEngaged}, Skipped: ${postsSkipped}`;

    await addLog(finalMsg, shouldStop ? 'warning' : 'success');
    updateOverlay(shouldStop ? 'Stopped' : 'Done!', 100);

    await updateState({ isRunning: false, postsProcessed, postsEngaged, postsSkipped });
    isRunning = false;

    // Remove overlay after a delay
    await sleep(5000);
    removeOverlay();
  }

  // ==========================================
  // STORAGE HELPERS (use chrome.storage directly)
  // ==========================================

  async function getSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get('settings', (result) => {
        resolve(result.settings || {});
      });
    });
  }

  async function getState() {
    return new Promise(resolve => {
      chrome.storage.local.get('state', (result) => {
        resolve(result.state || {});
      });
    });
  }

  async function updateState(updates) {
    const state = await getState();
    const newState = { ...state, ...updates };
    return new Promise(resolve => {
      chrome.storage.local.set({ state: newState }, resolve);
    });
  }

  async function addLog(message, type = 'info') {
    const state = await getState();
    if (!state.log) state.log = [];
    state.log.unshift({
      message,
      type,
      timestamp: new Date().toISOString()
    });
    state.log = state.log.slice(0, 100);
    return new Promise(resolve => {
      chrome.storage.local.set({ state }, resolve);
    });
  }

  async function incrementEngagement() {
    const settings = await getSettings();
    settings.todayEngagementCount = (settings.todayEngagementCount || 0) + 1;
    return new Promise(resolve => {
      chrome.storage.local.set({ settings }, resolve);
    });
  }

  // ==========================================
  // MESSAGE LISTENER
  // ==========================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'START_AUTOMATION') {
      runAutomation();
      sendResponse({ started: true });
    }

    if (message.action === 'STOP_AUTOMATION') {
      shouldStop = true;
      sendResponse({ stopped: true });
    }

    if (message.action === 'CHECK_LOGIN_STATUS') {
      sendResponse({ loggedIn: isLoggedIn() });
    }
  });

  // Log that content script loaded
  console.log('[LinkedIn Auto Engage] Content script loaded');
})();
