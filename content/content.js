/**
 * Content script - runs on LinkedIn pages.
 * Handles login detection, post scraping, and engagement automation.
 */

// Guard against double injection
if (window.__linkedinAutoEngageLoaded) {
  console.log('[LAE] Content script already loaded, skipping.');
} else {
  window.__linkedinAutoEngageLoaded = true;

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
      const profilePic = document.querySelector('.global-nav__me-photo');
      const navItems = document.querySelector('.global-nav__nav');
      const loginForm = document.querySelector('.login__form');
      const authWall = document.querySelector('.authwall-join-form');
      const joinNow = document.querySelector('[data-tracking-control-name="guest_homepage-basic_sign-in-button"]');

      if (loginForm || authWall || joinNow) return false;
      if (feedNav || profileNav || profilePic || navItems) return true;

      // Fallback: check URL
      const path = window.location.pathname;
      if (path.includes('/login') || path.includes('/signup') || path.includes('/authwall') || path === '/') {
        return false;
      }
      return true;
    }

    // ==========================================
    // POST SCRAPING
    // ==========================================

    function getAllFeedPosts() {
      // LinkedIn feed post containers - try multiple selectors
      // LinkedIn frequently updates their class names, so we try several
      const selectors = [
        '.feed-shared-update-v2',
        'div[data-id][class*="feed"]',
        '[data-urn*="activity"]',
        '.occludable-update',
        'div.relative.feed-shared-update-v2--e2e'
      ];

      for (const selector of selectors) {
        const posts = document.querySelectorAll(selector);
        if (posts.length > 0) return Array.from(posts);
      }

      // Last resort: look for the main feed container and find post-like divs
      const mainFeed = document.querySelector('.scaffold-finite-scroll__content') ||
                       document.querySelector('[role="main"]');
      if (mainFeed) {
        const candidates = mainFeed.querySelectorAll(':scope > div > div');
        if (candidates.length > 2) return Array.from(candidates);
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
        // Author name - try multiple selector patterns
        const authorSelectors = [
          '.update-components-actor__name .visually-hidden',
          '.update-components-actor__title .visually-hidden',
          '.feed-shared-actor__name .visually-hidden',
          '.update-components-actor__name span[aria-hidden="true"]',
          'a.update-components-actor__meta-link span.visually-hidden',
          '.update-components-actor__title span[dir="ltr"] span[aria-hidden="true"]'
        ];
        for (const sel of authorSelectors) {
          const el = postElement.querySelector(sel);
          if (el && el.textContent.trim()) {
            data.authorName = el.textContent.trim();
            break;
          }
        }

        // Author headline
        const headlineSelectors = [
          '.update-components-actor__description .visually-hidden',
          '.feed-shared-actor__description .visually-hidden',
          '.update-components-actor__subtitle .visually-hidden',
          '.update-components-actor__description span[aria-hidden="true"]'
        ];
        for (const sel of headlineSelectors) {
          const el = postElement.querySelector(sel);
          if (el && el.textContent.trim()) {
            data.authorHeadline = el.textContent.trim();
            break;
          }
        }

        // Post content - try multiple selector patterns
        const contentSelectors = [
          '.feed-shared-update-v2__description',
          '.update-components-text',
          '.feed-shared-text',
          '.break-words',
          '.feed-shared-inline-show-more-text',
          'div[class*="update-components-text"] span[dir="ltr"]'
        ];
        for (const sel of contentSelectors) {
          const el = postElement.querySelector(sel);
          if (el && el.textContent.trim().length > 10) {
            data.content = el.textContent.trim().substring(0, 2000);
            break;
          }
        }

        // Like count
        const likeSelectors = [
          '.social-details-social-counts__reactions-count',
          '[data-test-id="social-actions__reaction-count"]',
          '.reactions-count',
          'button[aria-label*="reaction"] span',
          'span.social-details-social-counts__reactions-count'
        ];
        for (const sel of likeSelectors) {
          const el = postElement.querySelector(sel);
          if (el && el.textContent.trim()) {
            data.likeCount = parseReactionCount(el.textContent.trim());
            if (data.likeCount > 0) break;
          }
        }

        // Comment count
        const commentSelectors = [
          '.social-details-social-counts__comments',
          'button[aria-label*="comment"]',
          'li.social-details-social-counts__item:nth-child(2) button'
        ];
        for (const sel of commentSelectors) {
          const el = postElement.querySelector(sel);
          if (el && el.textContent.trim()) {
            data.commentCount = parseReactionCount(el.textContent.trim());
            if (data.commentCount > 0) break;
          }
        }

        // Post age
        const timeSelectors = [
          '.update-components-actor__sub-description .visually-hidden',
          '.feed-shared-actor__sub-description .visually-hidden',
          'time',
          'span.update-components-actor__sub-description span[aria-hidden="true"]'
        ];
        for (const sel of timeSelectors) {
          const el = postElement.querySelector(sel);
          if (el && el.textContent.trim()) {
            data.postAge = el.textContent.trim();
            break;
          }
        }

        // Already liked check
        const likeBtnSelectors = [
          'button[aria-label*="Like"]',
          'button[aria-label*="like"]',
          '.reactions-react-button',
          'button.react-button__trigger[aria-pressed]'
        ];
        for (const sel of likeBtnSelectors) {
          const el = postElement.querySelector(sel);
          if (el) {
            const pressed = el.getAttribute('aria-pressed');
            data.alreadyLiked = pressed === 'true';
            break;
          }
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
      // Try multiple selectors for the like button
      const likeBtnSelectors = [
        'button[aria-label*="Like"]',
        'button[aria-label*="like"]',
        '.reactions-react-button',
        'button.react-button__trigger',
        'button[data-test-id*="like"]'
      ];

      let likeBtn = null;
      for (const sel of likeBtnSelectors) {
        likeBtn = postElement.querySelector(sel);
        if (likeBtn) break;
      }

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
      await sleep(1500);

      // Verify - check aria-pressed or class changes
      const isNowLiked = likeBtn.getAttribute('aria-pressed') === 'true' ||
                          likeBtn.classList.contains('react-button--active');
      return isNowLiked;
    }

    async function commentOnPost(postElement, commentText) {
      // Find and click the comment button to open comment box
      const commentBtnSelectors = [
        'button[aria-label*="Comment"]',
        'button[aria-label*="comment"]',
        'button[data-test-id*="comment"]',
        '.comment-button'
      ];

      let commentBtn = null;
      for (const sel of commentBtnSelectors) {
        commentBtn = postElement.querySelector(sel);
        if (commentBtn) break;
      }

      if (!commentBtn) {
        throw new Error('Comment button not found');
      }

      commentBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(500);
      commentBtn.click();
      await sleep(2000);

      // Find the comment text box - first within post, then globally
      const editorSelectors = [
        '.ql-editor[data-placeholder]',
        '.comments-comment-box__form .ql-editor',
        '[role="textbox"][contenteditable="true"]',
        '.editor-content [contenteditable="true"]'
      ];

      let editor = null;

      // Search within post element first
      for (const sel of editorSelectors) {
        editor = postElement.querySelector(sel);
        if (editor) break;
      }

      // Search globally if not found within post
      if (!editor) {
        const globalSelectors = [
          '.ql-editor[data-placeholder="Add a comment\u2026"]',
          '.ql-editor[data-placeholder="Add a comment..."]',
          '[role="textbox"][contenteditable="true"][aria-label*="comment" i]',
          '[role="textbox"][contenteditable="true"][aria-label*="Comment" i]',
          '.ql-editor[contenteditable="true"]'
        ];

        for (const sel of globalSelectors) {
          const allEditors = document.querySelectorAll(sel);
          if (allEditors.length > 0) {
            // Use the last one (most recently opened)
            editor = allEditors[allEditors.length - 1];
            break;
          }
        }
      }

      if (!editor) {
        throw new Error('Comment text box not found');
      }

      return await typeAndSubmitComment(editor, commentText);
    }

    async function typeAndSubmitComment(editor, commentText) {
      // Focus the editor
      editor.focus();
      await sleep(300);

      // Clear any existing content
      editor.innerHTML = '';
      await sleep(100);

      // Type the comment word by word for human-like behavior
      const words = commentText.split(' ');
      for (let i = 0; i < words.length; i++) {
        const word = (i > 0 ? ' ' : '') + words[i];

        // Append text using a paragraph element (LinkedIn uses Quill editor)
        const textNode = document.createTextNode(word);
        const p = editor.querySelector('p') || editor;
        p.appendChild(textNode);

        // Dispatch input event so LinkedIn recognizes the change
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));

        // Small random delay between words
        await sleep(50 + Math.random() * 100);
      }

      await sleep(800);

      // Find and click submit button
      const formContainer = editor.closest('.comments-comment-box') ||
                            editor.closest('.comments-comment-texteditor') ||
                            editor.closest('[class*="comments-comment"]') ||
                            editor.closest('form') ||
                            editor.parentElement.parentElement.parentElement;

      let submitBtn = null;
      if (formContainer) {
        const submitSelectors = [
          'button.comments-comment-box__submit-button',
          'button[type="submit"]',
          'button[aria-label*="Post"]',
          'button[aria-label*="Submit"]',
          'button.artdeco-button--primary'
        ];
        for (const sel of submitSelectors) {
          submitBtn = formContainer.querySelector(sel);
          if (submitBtn && !submitBtn.disabled) break;
          submitBtn = null;
        }
      }

      if (!submitBtn) {
        // Try keyboard shortcut: Ctrl+Enter
        editor.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          ctrlKey: true,
          bubbles: true
        }));
        await sleep(1500);
        return true;
      }

      // Wait for button to be enabled
      await sleep(500);

      if (submitBtn.disabled) {
        // Button might enable after a short delay
        await sleep(1000);
      }

      submitBtn.click();
      await sleep(1500);
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
      await sleep(3000);

      // Check if new content loaded
      return document.documentElement.scrollHeight > previousHeight;
    }

    async function scrollToPost(postElement) {
      postElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(1000);
    }

    // ==========================================
    // LLM CALLS VIA BACKGROUND
    // ==========================================

    async function callLLM(settings, messages) {
      return new Promise((resolve, reject) => {
        try {
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
              reject(new Error(response ? response.error : 'No response from background worker'));
            }
          });
        } catch (err) {
          reject(new Error('Failed to send message to background: ' + err.message));
        }
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

Author: ${postData.authorName || 'Unknown'}
Author Headline: ${postData.authorHeadline || 'Unknown'}
Post Content: ${(postData.content || '').substring(0, 1500)}
Likes: ${postData.likeCount || 0}
Comments: ${postData.commentCount || 0}
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
        console.warn('[LAE] Failed to parse LLM analysis response:', response);
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

Author: ${postData.authorName || 'Unknown'}
Content: ${(postData.content || '').substring(0, 1500)}

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
        await addLog('Navigating to feed...', 'info');
        window.location.href = 'https://www.linkedin.com/feed/';
        return; // Page will reload, user needs to click Start again
      }

      // Wait for feed to load
      await sleep(3000);

      let postsProcessed = 0;
      let postsEngaged = 0;
      let postsSkipped = 0;
      const processedPostElements = new Set();
      const maxPosts = settings.maxPostsToEngage || 10;
      let noNewPostRetries = 0;
      const maxRetries = 5;

      while (postsEngaged < maxPosts && !shouldStop) {
        // Check daily limit
        const currentSettings = await getSettings();
        if ((currentSettings.todayEngagementCount || 0) >= (currentSettings.dailyEngagementLimit || 30)) {
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
          noNewPostRetries = 0;

          postsProcessed++;
          const progress = Math.round((postsEngaged / maxPosts) * 100);
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

          const contentPreview = postData.content.substring(0, 60).replace(/\n/g, ' ');
          await addLog(`Post ${postsProcessed}: Analyzing "${postData.authorName || 'Unknown'}" - ${contentPreview}...`, 'info');

          // Scroll to post
          await scrollToPost(postEl);

          // Highlight post being analyzed
          postEl.classList.add('lae-highlight-post');

          try {
            // Use LLM to analyze post
            const analysis = await analyzePostWithLLM(settings, postData);

            // Check if we should also engage based on saved creators
            const isSavedCreator = (settings.savedCreators || []).some(
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
                await sleep(randomDelay((settings.delayBetweenActions || 5) * 500));
              }

              // Comment on the post
              if (settings.enableCommenting) {
                try {
                  updateOverlay(`Generating comment for post ${postsProcessed}...`, Math.min(progress, 95));
                  const comment = await generateCommentWithLLM(settings, postData);

                  if (comment && comment.length > 10) {
                    const commentPreview = comment.substring(0, 80).replace(/\n/g, ' ');
                    await addLog(`Post ${postsProcessed}: Commenting: "${commentPreview}..."`, 'info');
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
          await sleep(randomDelay((settings.delayBetweenActions || 5) * 1000));

          if (postsEngaged >= maxPosts) break;
        }

        // If we didn't find any new posts, scroll to load more
        if (!foundNewPost) {
          noNewPostRetries++;
          if (noNewPostRetries >= maxRetries) {
            await addLog('No more new posts found after scrolling. Stopping.', 'warning');
            break;
          }
          updateOverlay('Loading more posts...', Math.min(90, Math.round((postsEngaged / maxPosts) * 100)));
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
      return new Promise((resolve) => {
        chrome.storage.local.get('settings', (result) => {
          if (chrome.runtime.lastError) {
            console.error('[LAE] Storage error:', chrome.runtime.lastError);
            resolve({});
          } else {
            resolve(result.settings || {});
          }
        });
      });
    }

    async function getState() {
      return new Promise((resolve) => {
        chrome.storage.local.get('state', (result) => {
          if (chrome.runtime.lastError) {
            console.error('[LAE] Storage error:', chrome.runtime.lastError);
            resolve({});
          } else {
            resolve(result.state || {});
          }
        });
      });
    }

    async function updateState(updates) {
      const state = await getState();
      const newState = { ...state, ...updates };
      return new Promise((resolve) => {
        chrome.storage.local.set({ state: newState }, () => {
          if (chrome.runtime.lastError) {
            console.error('[LAE] Storage error:', chrome.runtime.lastError);
          }
          resolve();
        });
      });
    }

    async function addLog(message, type = 'info') {
      console.log(`[LAE] [${type}] ${message}`);
      const state = await getState();
      if (!state.log) state.log = [];
      state.log.unshift({
        message,
        type,
        timestamp: new Date().toISOString()
      });
      state.log = state.log.slice(0, 100);
      return new Promise((resolve) => {
        chrome.storage.local.set({ state }, () => {
          if (chrome.runtime.lastError) {
            console.error('[LAE] Storage error:', chrome.runtime.lastError);
          }
          resolve();
        });
      });
    }

    async function incrementEngagement() {
      const settings = await getSettings();
      settings.todayEngagementCount = (settings.todayEngagementCount || 0) + 1;
      return new Promise((resolve) => {
        chrome.storage.local.set({ settings }, () => {
          if (chrome.runtime.lastError) {
            console.error('[LAE] Storage error:', chrome.runtime.lastError);
          }
          resolve();
        });
      });
    }

    // ==========================================
    // MESSAGE LISTENER
    // ==========================================

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'START_AUTOMATION') {
        if (isRunning) {
          sendResponse({ started: false, reason: 'Already running' });
        } else {
          runAutomation();
          sendResponse({ started: true });
        }
        return false;
      }

      if (message.action === 'STOP_AUTOMATION') {
        shouldStop = true;
        sendResponse({ stopped: true });
        return false;
      }

      if (message.action === 'CHECK_LOGIN_STATUS') {
        sendResponse({ loggedIn: isLoggedIn() });
        return false;
      }
    });

    // Log that content script loaded
    console.log('[LinkedIn Auto Engage] Content script loaded on', window.location.href);
  })();
}
