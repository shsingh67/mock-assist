/**
 * LeetCode problem extractor with cascading fallback selectors.
 * LeetCode uses hashed class names that change across deploys,
 * so we try multiple strategies to find the problem description.
 */

const MockAssistExtractor = (() => {
  'use strict';

  const DESCRIPTION_SELECTORS = [
    '[data-track-load="description_content"]',
    '.elting-content',
    '#qd-content .question-content',
    'div[class*="description__"]',
    'div[class*="question-content"]',
    'div[class*="content__"] div[class*="elting"]',
  ];

  function extractDescription() {
    for (const selector of DESCRIPTION_SELECTORS) {
      try {
        const el = document.querySelector(selector);
        if (el && el.innerText && el.innerText.trim().length > 50) {
          return el.innerText.trim();
        }
      } catch {
        // Invalid selector, skip
      }
    }
    return heuristicExtract();
  }

  function heuristicExtract() {
    const candidates = [];
    const divs = document.querySelectorAll('div');

    for (const el of divs) {
      const text = el.innerText;
      if (!text) continue;
      const trimmed = text.trim();
      if (
        trimmed.length > 200 &&
        trimmed.length < 10000 &&
        (trimmed.includes('Example') || trimmed.includes('Input') || trimmed.includes('Constraint'))
      ) {
        candidates.push({ el, length: trimmed.length });
      }
    }

    // Sort by length ascending (prefer smallest/most specific match)
    candidates.sort((a, b) => a.length - b.length);

    for (const { el } of candidates) {
      const text = el.innerText;
      if (text) return text.trim();
    }

    return null;
  }

  function extractTitle() {
    const pageTitle = document.title;
    if (pageTitle && pageTitle.includes(' - LeetCode')) {
      return pageTitle.replace(' - LeetCode', '').trim();
    }

    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    if (match) {
      return match[1]
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }

    return 'Unknown Problem';
  }

  function extractDifficulty() {
    const difficultySelectors = [
      'div[class*="difficulty"]',
      'span[class*="difficulty"]',
      'div[diff]',
    ];

    for (const selector of difficultySelectors) {
      try {
        const el = document.querySelector(selector);
        if (el && el.innerText) {
          const text = el.innerText.trim().toLowerCase();
          if (['easy', 'medium', 'hard'].includes(text)) {
            return text.charAt(0).toUpperCase() + text.slice(1);
          }
        }
      } catch {
        // Skip
      }
    }

    const allElements = document.querySelectorAll('span, div');
    for (const el of allElements) {
      const text = el.innerText;
      if (!text) continue;
      const trimmed = text.trim();
      if (trimmed === 'Easy' || trimmed === 'Medium' || trimmed === 'Hard') {
        const parent = el.parentElement;
        if (parent && parent.innerText && parent.innerText.trim().length < 50) {
          return trimmed;
        }
      }
    }

    return 'Unknown';
  }

  function extractSlug() {
    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    return match ? match[1] : null;
  }

  function extractAll() {
    return {
      title: extractTitle(),
      slug: extractSlug(),
      difficulty: extractDifficulty(),
      description: extractDescription(),
    };
  }

  return { extractAll, extractDescription, extractTitle, extractDifficulty, extractSlug };
})();
