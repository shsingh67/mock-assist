(() => {
  'use strict';

  let lastSlug = null;
  let observer = null;
  let navInterval = null;

  function sendProblemData() {
    const data = MockAssistExtractor.extractAll();
    if (data.description && data.slug !== lastSlug) {
      chrome.runtime.sendMessage({ type: 'PROBLEM_DATA', payload: data });
      lastSlug = data.slug;
      return true;
    }
    return false;
  }

  function waitForContent() {
    // Try immediately
    if (sendProblemData()) return;

    // Watch for DOM changes (LeetCode SPA renders async)
    if (observer) observer.disconnect();

    observer = new MutationObserver(() => {
      if (sendProblemData()) {
        cleanupObserver();
      }
    });

    // Prefer a scoped target to avoid watching the entire DOM tree
    const target = document.querySelector('#qd-content') ||
                   document.querySelector('[data-track-load="description_content"]')?.parentElement ||
                   document.getElementById('app') ||
                   document.body;

    observer.observe(target, {
      childList: true,
      subtree: true,
    });

    setTimeout(cleanupObserver, 15000);
  }

  function cleanupObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // Handle SPA navigation
  function watchForNavigation() {
    let currentPath = window.location.pathname;

    navInterval = setInterval(() => {
      if (window.location.pathname !== currentPath) {
        currentPath = window.location.pathname;
        if (currentPath.match(/\/problems\/[^/]+/)) {
          setTimeout(() => waitForContent(), 1000);
        }
      }
    }, 1000);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'EXTRACT_PROBLEM') {
      const data = MockAssistExtractor.extractAll();
      sendResponse(data);
    }
  });

  window.addEventListener('beforeunload', () => {
    cleanupObserver();
    if (navInterval) {
      clearInterval(navInterval);
      navInterval = null;
    }
  });

  // Boot
  waitForContent();
  watchForNavigation();
})();
