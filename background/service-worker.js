'use strict';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;

  const isLeetCode = tab.url && /https:\/\/leetcode\.com\/problems\/.+/.test(tab.url);

  chrome.sidePanel.setOptions({
    tabId,
    path: 'sidepanel/sidepanel.html',
    enabled: true,
  });

  if (isLeetCode) {
    chrome.storage.session.set({ [`tab_${tabId}_isLeetCode`]: true });
  } else {
    chrome.storage.session.remove(`tab_${tabId}_isLeetCode`);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'MIC_PERMISSION_RESULT') {
    return false;
  }

  if (message.type === 'PROBLEM_DATA') {
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.storage.session.set({
        currentProblem: message.payload,
        currentProblemTabId: tabId,
      });
    }
    return false;
  }

  if (message.type === 'REQUEST_PROBLEM_DATA') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) {
        sendResponse({ error: 'No active tab' });
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { type: 'EXTRACT_PROBLEM' }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: 'Not on a LeetCode problem page' });
        } else {
          sendResponse(response || { error: 'No response from content script' });
        }
      });
    });
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab_${tabId}_isLeetCode`);
});
