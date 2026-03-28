/**
 * Mock Assist — Side Panel Application
 */
(() => {
  'use strict';

  // ── Constants ──
  const MAX_CONTEXT_LENGTH = 50000; // Max chars for context input

  // ── State ──
  const state = {
    mode: 'coding',
    provider: 'ollama',
    apiKey: null,
    model: 'llama3.1',
    style: 'balanced',
    sessionActive: false,
    messages: [],
    problemData: null,
    startTime: null,
    timerInterval: null,
    streamController: null,
    // Voice
    ttsEnabled: true,
    recognition: null,
    isRecording: false,
    micPausedForTTS: false,
  };

  // ── DOM refs ──
  const $ = (id) => document.getElementById(id);
  const setupPanel = $('setup-panel');
  const sessionInfo = $('session-info');
  const problemTitle = $('problem-title');
  const timerEl = $('timer');
  const chatContainer = $('chat-container');
  const messagesEl = $('messages');
  const inputArea = $('input-area');
  const userInput = $('user-input');
  const sendBtn = $('send-btn');
  const controls = $('controls');
  const startBtn = $('start-btn');
  const endBtn = $('end-btn');
  const summaryPanel = $('summary-panel');
  const summaryContent = $('summary-content');
  const contextInput = $('context-input');
  const contextText = $('context-text');
  const settingsOverlay = $('settings-overlay');

  // ── Safe DOM helpers ──

  /** Safely set text content (no XSS risk) */
  function setText(el, text) {
    if (el) el.textContent = text || '';
  }

  /** Escape HTML to prevent XSS */
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Render markdown safely — all input is escaped first */
  function renderMarkdown(text) {
    if (!text) return '';

    let html = escapeHtml(text);

    // Code blocks
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  /** Build model dropdown options safely using DOM APIs */
  function populateModelDropdown(provider) {
    const select = $('settings-model');
    const models = AIClient.PROVIDERS[provider]?.models || [];
    select.textContent = ''; // Clear
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      select.appendChild(opt);
    }
  }

  // ── Init ──
  async function init() {
    state.apiKey = await Storage.getApiKey();
    const settings = await Storage.getSettings();
    state.provider = settings.provider || 'ollama';
    state.model = settings.model;
    state.style = settings.interviewStyle;

    if (state.apiKey) {
      setupPanel.hidden = true;
      controls.hidden = false;
      showModeUI();
    }

    bindEvents();
    requestProblemData();
  }

  // ── Events ──
  function bindEvents() {
    // Setup: provider selector
    document.querySelectorAll('.provider-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.provider-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.provider = btn.dataset.provider;
        const info = AIClient.PROVIDERS[state.provider];
        if (info && info.models.length) {
          state.model = info.models[0].id;
        }
        updateSetupUI();
      });
    });
    updateSetupUI();

    // Save API key
    $('save-key-btn').addEventListener('click', saveApiKey);
    $('api-key-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveApiKey();
    });

    // Ollama connect
    $('ollama-connect-btn').addEventListener('click', connectOllama);

    // Mode switching
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchMode(btn.dataset.mode));
    });

    // Interview controls
    startBtn.addEventListener('click', startInterview);
    endBtn.addEventListener('click', endInterview);
    $('new-session-btn').addEventListener('click', resetSession);

    // Chat input
    sendBtn.addEventListener('click', sendMessage);
    userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-resize textarea
    userInput.addEventListener('input', () => {
      userInput.style.height = 'auto';
      userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
    });

    // Voice
    $('mic-btn').addEventListener('click', toggleMic);
    $('tts-toggle').addEventListener('click', toggleTTS);

    // Settings
    $('settings-btn').addEventListener('click', openSettings);
    $('settings-save').addEventListener('click', saveSettings);
    $('settings-cancel').addEventListener('click', () => { settingsOverlay.hidden = true; });
    $('settings-wipe').addEventListener('click', wipeAllData);

    // Prompt editor
    $('edit-prompts-btn').addEventListener('click', openPromptEditor);
    $('prompt-editor-close').addEventListener('click', closePromptEditor);
    $('prompt-save').addEventListener('click', savePrompts);

    // Prompt tab switching
    document.querySelectorAll('.prompt-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.prompt-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.prompt-tab-content').forEach((c) => { c.hidden = true; });
        const target = document.querySelector(`.prompt-tab-content[data-for="${tab.dataset.tab}"]`);
        if (target) target.hidden = false;
      });
    });

    // Prompt reset buttons
    document.querySelectorAll('.prompt-reset-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const mode = btn.dataset.mode;
        const textarea = $('prompt-' + mode);
        if (textarea && Prompts.DEFAULT_PROMPTS[mode]) {
          textarea.value = Prompts.DEFAULT_PROMPTS[mode];
        }
      });
    });

    $('settings-provider').addEventListener('change', () => {
      const provider = $('settings-provider').value;
      populateModelDropdown(provider);
      const info = AIClient.PROVIDERS[provider];
      if (info) {
        $('settings-api-key').placeholder = info.keyPlaceholder;
      }
    });

    // Listen for problem data from content script
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'PROBLEM_DATA' && msg.payload) {
        state.problemData = msg.payload;
        setText(problemTitle, msg.payload.title || 'Problem loaded');
      }
    });

    // Check session storage for problem data
    try {
      chrome.storage.session?.get('currentProblem', (result) => {
        if (chrome.runtime.lastError) return;
        if (result?.currentProblem && !state.problemData) {
          state.problemData = result.currentProblem;
          setText(problemTitle, result.currentProblem.title || 'Problem loaded');
        }
      });
    } catch {
      // session storage not available
    }

    // Cleanup on unload
    window.addEventListener('beforeunload', cleanup);
  }

  /** Clean up all resources */
  function cleanup() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    if (state.streamController) state.streamController.abort();
    if (state.recognition) state.recognition.abort();
    window.speechSynthesis?.cancel();
  }

  function updateSetupUI() {
    const info = AIClient.PROVIDERS[state.provider];
    const isOllama = state.provider === 'ollama';

    $('key-input-section').hidden = isOllama;
    $('ollama-info').hidden = !isOllama;
    $('key-hint').hidden = isOllama;

    if (!isOllama && info) {
      $('api-key-input').placeholder = info.keyPlaceholder;
    }
  }

  async function connectOllama() {
    const keyStatus = $('key-status');
    const connectBtn = $('ollama-connect-btn');

    connectBtn.disabled = true;
    setText(connectBtn, 'Connecting...');
    keyStatus.hidden = false;
    keyStatus.className = 'key-status validating';
    setText(keyStatus, 'Checking Ollama at localhost:11434...');

    const result = await AIClient.validateKey('ollama', '');

    if (!result.valid) {
      keyStatus.className = 'key-status error';
      setText(keyStatus, result.error);
      connectBtn.disabled = false;
      setText(connectBtn, 'Connect to Ollama');
      return;
    }

    keyStatus.className = 'key-status success';
    setText(keyStatus, 'Connected to Ollama!');

    state.provider = 'ollama';
    state.apiKey = 'ollama-local';
    state.model = AIClient.PROVIDERS.ollama.models[0].id;

    await Storage.setApiKey('ollama-local');
    await Storage.setSettings({
      provider: 'ollama',
      model: state.model,
      interviewStyle: state.style,
    });

    setTimeout(() => {
      setupPanel.hidden = true;
      controls.hidden = false;
      keyStatus.hidden = true;
      connectBtn.disabled = false;
      setText(connectBtn, 'Connect to Ollama');
      showModeUI();
    }, 600);
  }

  async function saveApiKey() {
    const key = $('api-key-input').value.trim();
    if (!key) return;

    const keyStatus = $('key-status');
    const saveBtn = $('save-key-btn');

    // Auto-detect provider from key format
    const detected = AIClient.detectProvider(key);
    if (detected) {
      state.provider = detected;
      document.querySelectorAll('.provider-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.provider === detected);
      });
      const info = AIClient.PROVIDERS[detected];
      if (info && info.models.length) {
        state.model = info.models[0].id;
      }
    }

    // Validate
    saveBtn.disabled = true;
    setText(saveBtn, '...');
    keyStatus.hidden = false;
    keyStatus.className = 'key-status validating';
    setText(keyStatus, 'Validating key...');

    const result = await AIClient.validateKey(state.provider, key);

    if (!result.valid) {
      keyStatus.className = 'key-status error';
      setText(keyStatus, result.error);
      saveBtn.disabled = false;
      setText(saveBtn, 'Save');
      return;
    }

    keyStatus.className = 'key-status success';
    setText(keyStatus, 'Key verified!');

    await Storage.setApiKey(key);
    await Storage.setSettings({
      provider: state.provider,
      model: state.model,
      interviewStyle: state.style,
    });
    state.apiKey = key;

    setTimeout(() => {
      setupPanel.hidden = true;
      controls.hidden = false;
      keyStatus.hidden = true;
      saveBtn.disabled = false;
      setText(saveBtn, 'Save');
      showModeUI();
    }, 600);
  }

  function switchMode(mode) {
    if (state.sessionActive) return;
    state.mode = mode;
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    showModeUI();
  }

  function showModeUI() {
    if (state.mode === 'coding') {
      contextInput.hidden = true;
      sessionInfo.hidden = false;
      setText(
        problemTitle,
        state.problemData ? state.problemData.title : 'Navigate to a LeetCode problem...'
      );
    } else {
      contextInput.hidden = false;
      sessionInfo.hidden = false;
      contextText.placeholder =
        state.mode === 'system-design'
          ? 'Enter a system design topic (e.g., "Design a URL shortener")...'
          : 'Paste a job description or role details...';
      setText(
        problemTitle,
        state.mode === 'system-design' ? 'System Design' : 'Behavioral Interview'
      );
    }
  }

  function requestProblemData() {
    chrome.runtime.sendMessage({ type: 'REQUEST_PROBLEM_DATA' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response && !response.error && response.description) {
        state.problemData = response;
        setText(problemTitle, response.title || 'Problem loaded');
      }
    });
  }

  // ── Interview Flow ──
  async function startInterview() {
    if (state.mode === 'coding' && !state.problemData?.description) {
      showError('Navigate to a LeetCode problem first, or switch to another mode.');
      return;
    }
    if (state.mode !== 'coding') {
      const ctx = contextText.value.trim();
      if (!ctx) {
        showError('Please enter a topic or job description.');
        return;
      }
      if (ctx.length > MAX_CONTEXT_LENGTH) {
        showError(`Context too long. Please keep it under ${MAX_CONTEXT_LENGTH} characters.`);
        return;
      }
    }

    state.sessionActive = true;
    state.messages = [];
    state.startTime = Date.now();

    startBtn.hidden = true;
    endBtn.hidden = false;
    chatContainer.hidden = false;
    inputArea.hidden = false;
    $('voice-bar').hidden = false;
    contextInput.hidden = true;
    messagesEl.textContent = '';

    document.querySelectorAll('.mode-btn').forEach((btn) => { btn.disabled = true; });

    updateTimer();
    state.timerInterval = setInterval(updateTimer, 1000);

    const systemPrompt = await buildSystemPrompt();
    const openingMessage = {
      role: 'user',
      content: "Hi, I'm ready to start the interview.",
    };
    state.messages.push(openingMessage);
    addMessageToUI('user', openingMessage.content);
    streamAssistantResponse(systemPrompt);
  }

  async function endInterview() {
    if (!state.sessionActive) return;

    const scoreMsg = { role: 'user', content: Prompts.scoreRequest() };
    state.messages.push(scoreMsg);
    addMessageToUI('user', 'Please give me my interview score and feedback.');

    const systemPrompt = await buildSystemPrompt();
    streamAssistantResponse(systemPrompt, () => {
      state.sessionActive = false;
      if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
      }

      const lastAssistant = state.messages.filter((m) => m.role === 'assistant').pop();
      summaryContent.innerHTML = renderMarkdown(lastAssistant?.content || 'No summary available.');

      chatContainer.hidden = true;
      inputArea.hidden = true;
      controls.hidden = true;
      summaryPanel.hidden = false;

      Storage.saveSession({
        mode: state.mode,
        provider: state.provider,
        slug: state.problemData?.slug || 'custom',
        title: state.problemData?.title || problemTitle.textContent,
        messages: state.messages,
        duration: Date.now() - state.startTime,
        timestamp: Date.now(),
      });
    });
  }

  function resetSession() {
    state.sessionActive = false;
    state.messages = [];
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    if (state.streamController) {
      state.streamController.abort();
      state.streamController = null;
    }
    setText(timerEl, '00:00');

    messagesEl.textContent = '';
    summaryPanel.hidden = true;
    chatContainer.hidden = true;
    inputArea.hidden = true;
    $('voice-bar').hidden = true;
    controls.hidden = false;
    startBtn.hidden = false;
    endBtn.hidden = true;

    stopRecording();
    window.speechSynthesis?.cancel();

    document.querySelectorAll('.mode-btn').forEach((btn) => { btn.disabled = false; });
    showModeUI();
  }

  // ── Chat ──
  async function sendMessage() {
    const text = userInput.value.trim();
    if (!text || !state.sessionActive) return;

    // Stop mic when sending so AI response / TTS doesn't get recorded
    if (state.isRecording) {
      state._micWasActive = true;
      stopRecording();
    }

    state.messages.push({ role: 'user', content: text });
    addMessageToUI('user', text);
    userInput.value = '';
    userInput.style.height = 'auto';

    streamAssistantResponse(await buildSystemPrompt());
  }

  function streamAssistantResponse(systemPrompt, onComplete) {
    sendBtn.disabled = true;
    const msgEl = addMessageToUI('assistant', '');
    msgEl.classList.add('typing-indicator');

    let fullText = '';
    let speechBuffer = '';

    state.streamController = AIClient.stream(
      state.provider,
      state.apiKey,
      state.messages,
      systemPrompt,
      state.model,
      // onChunk
      (chunk) => {
        fullText += chunk;
        msgEl.innerHTML = renderMarkdown(fullText);
        msgEl.classList.add('typing-indicator');
        scrollToBottom();

        // Stream speech: speak complete sentences as they arrive
        if (state.ttsEnabled) {
          speechBuffer += chunk;
          const sentenceEnd = speechBuffer.search(/[.!?]\s/);
          if (sentenceEnd !== -1) {
            const toSpeak = speechBuffer.substring(0, sentenceEnd + 1);
            speechBuffer = speechBuffer.substring(sentenceEnd + 2);
            speakText(toSpeak, false);
          }
        }
      },
      // onDone
      () => {
        msgEl.classList.remove('typing-indicator');
        state.messages.push({ role: 'assistant', content: fullText });
        sendBtn.disabled = false;
        userInput.focus();
        state.streamController = null;

        if (state.ttsEnabled && speechBuffer.trim()) {
          speakText(speechBuffer.trim(), false);
        }

        // Restart mic after all TTS finishes (or immediately if TTS is off)
        if (state._micWasActive) {
          waitForTTSDone(() => {
            $('voice-indicator').className = '';
            setText($('voice-label'), 'Ready');
            state._micWasActive = false;
            toggleMic();
          });
        }

        if (onComplete) onComplete();
      },
      // onError
      (err) => {
        msgEl.classList.remove('typing-indicator');
        const errEl = document.createElement('em');
        errEl.style.color = 'var(--accent)';
        errEl.textContent = 'Error: ' + (err.message || 'Unknown error');
        msgEl.textContent = '';
        msgEl.appendChild(errEl);
        sendBtn.disabled = false;
        state.streamController = null;
      }
    );
  }

  // ── UI Helpers ──
  function addMessageToUI(role, content) {
    const div = document.createElement('div');
    div.className = `message message-${escapeHtml(role)}`;
    if (content) {
      div.innerHTML = renderMarkdown(content);
    }
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
  }

  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  function updateTimer() {
    if (!state.startTime) return;
    const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    setText(timerEl, `${mins}:${secs}`);
  }

  function showError(msg) {
    const toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  async function buildSystemPrompt() {
    if (state.mode === 'coding') {
      return Prompts.coding(state.problemData, state.style);
    } else if (state.mode === 'system-design') {
      return Prompts.systemDesign(contextText.value.trim(), state.style);
    } else {
      return Prompts.behavioral(contextText.value.trim(), state.style);
    }
  }

  // ── Voice: Speech-to-Text ──

  async function toggleMic() {
    if (state.isRecording) {
      stopRecording();
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showError('Speech recognition is not supported in this browser.');
      return;
    }

    // Skip getUserMedia check — side panels can't reliably call it.
    // Just start recognition directly. If permission is needed,
    // the onerror handler will catch 'not-allowed' and open the permission tab.
    startRecognition(SpeechRecognition);
  }

  function requestMicPermission() {
    return new Promise((resolve) => {
      const listener = (msg) => {
        if (msg.type !== 'MIC_PERMISSION_RESULT') return;
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timer);
        resolve(msg.granted === true);
      };
      chrome.runtime.onMessage.addListener(listener);

      const timer = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(false);
      }, 30000);

      chrome.tabs.create({
        url: chrome.runtime.getURL('mic/mic-prompt.html'),
        active: true,
      });
    });
  }

  function startRecognition(SpeechRecognition) {
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;

    let processedCount = 0;

    recognition.onstart = () => {
      state.isRecording = true;
      state.recognition = recognition;
      processedCount = 0;
      $('mic-btn').classList.remove('active');
      $('mic-btn').classList.add('recording');
      $('voice-indicator').className = 'listening';
      setText($('voice-label'), 'Listening...');
    };

    recognition.onresult = (event) => {
      let newFinal = '';
      let interim = '';

      for (let i = processedCount; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          newFinal += transcript;
          processedCount = i + 1;
        } else {
          interim += transcript;
        }
      }

      // Strip any interim preview before appending final text
      const base = state._preInterimText != null ? state._preInterimText : userInput.value;

      if (newFinal) {
        const spacer = base && !base.endsWith(' ') ? ' ' : '';
        userInput.value = base + spacer + newFinal;
        state._preInterimText = null;
      }

      if (interim) {
        // Save real text (after any final append) before showing preview
        if (state._preInterimText == null) {
          state._preInterimText = userInput.value;
        }
        const current = state._preInterimText;
        const spacer = current && !current.endsWith(' ') ? ' ' : '';
        userInput.value = current + spacer + interim;
      }

      userInput.style.height = 'auto';
      userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
    };

    recognition.onerror = async (event) => {
      if (event.error === 'not-allowed') {
        stopRecording();
        const micBtn = $('mic-btn');
        const voiceLabel = $('voice-label');
        micBtn.classList.add('active');
        setText(voiceLabel, 'Requesting mic access...');

        try {
          const granted = await requestMicPermission();
          micBtn.classList.remove('active');
          setText(voiceLabel, 'Ready');
          if (granted) {
            startRecognition(SpeechRecognition);
          } else {
            showError('Microphone access denied. Please allow it and try again.');
          }
        } catch {
          micBtn.classList.remove('active');
          setText(voiceLabel, 'Ready');
          showError('Could not request microphone permission.');
        }
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        showError('Speech error: ' + event.error);
      }
    };

    recognition.onend = () => {
      state._preInterimText = null;
      // Restart if still recording (Chrome stops continuous after ~60s of silence)
      if (state.isRecording) {
        try {
          startRecognition(SpeechRecognition);
        } catch {
          stopRecording();
        }
      }
    };

    recognition.start();
  }

  function stopRecording() {
    if (state.recognition) {
      try { state.recognition.abort(); } catch { /* ignore */ }
      state.recognition = null;
    }
    state.isRecording = false;
    state.micPausedForTTS = false;
    $('mic-btn').classList.remove('recording');
    $('voice-indicator').className = '';
    setText($('voice-label'), 'Ready');
  }


  /** Wait until speechSynthesis is done speaking, then call the callback. */
  function waitForTTSDone(callback) {
    if (!window.speechSynthesis || !window.speechSynthesis.speaking) {
      callback();
      return;
    }
    const check = setInterval(() => {
      if (!window.speechSynthesis.speaking) {
        clearInterval(check);
        callback();
      }
    }, 200);
  }

  // ── Voice: Text-to-Speech ──

  function toggleTTS() {
    state.ttsEnabled = !state.ttsEnabled;
    $('tts-toggle').classList.toggle('active', state.ttsEnabled);

    if (!state.ttsEnabled) {
      window.speechSynthesis?.cancel();
      $('voice-indicator').className = '';
      setText($('voice-label'), 'Ready');
    }
  }

  let cachedVoice = null;
  function getBestVoice() {
    if (cachedVoice) return cachedVoice;

    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    const preferred = [
      'Evan', 'Ava (Premium)', 'Zoe (Premium)', 'Tom (Premium)',
      'Samantha (Enhanced)', 'Daniel (Enhanced)',
      'Samantha', 'Daniel', 'Karen', 'Moira',
      'Microsoft Jenny', 'Microsoft Guy', 'Microsoft Aria',
      'Google US English', 'Google UK English Male', 'Google UK English Female',
    ];

    for (const name of preferred) {
      const match = voices.find((v) => v.lang.startsWith('en') && v.name.includes(name));
      if (match) {
        cachedVoice = match;
        return match;
      }
    }

    cachedVoice = voices.find((v) => v.lang.startsWith('en')) || null;
    return cachedVoice;
  }

  window.speechSynthesis?.addEventListener('voiceschanged', () => { cachedVoice = null; });

  function speakText(text, cancelPrevious = true) {
    if (!state.ttsEnabled || !window.speechSynthesis) return;

    if (cancelPrevious) window.speechSynthesis.cancel();

    // Strip markdown and special characters for clean speech
    const clean = text
      .replace(/```[\s\S]*?```/g, ' code block ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/^\s*[-*]\s+/gm, ' ')
      .replace(/^\s*\d+\.\s+/gm, ' ')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      // Remove special chars but keep apostrophes for contractions (don't, it's, etc.)
      .replace(/[,;:!\u201c\u201d\u201e`~@#$%^&*()_+=\[\]{}|\\/<>\-\u2013\u2014]/g, ' ')
      .replace(/\.{2,}/g, '.')
      .replace(/\s*\.\s*/g, '. ')
      .replace(/\s*\?\s*/g, '? ')
      .replace(/\s+/g, ' ')
      .trim();

    const chunks = splitIntoClauses(clean);
    if (!chunks.length) return;

    const voice = getBestVoice();
    const queue = [];

    chunks.forEach((chunk, i) => {
      const trimmed = chunk.trim();
      if (!trimmed || trimmed === '|') return;

      const isQuestion = trimmed.endsWith('?');
      const isExclamation = trimmed.endsWith('!');
      const wordCount = trimmed.split(/\s+/).length;
      const isShort = wordCount <= 4;
      const isLong = wordCount > 15;
      const isOpening = i === 0;
      const isClosing = i === chunks.length - 1;
      const hasEmphasis = /\b(important|key|critical|note|however|but|actually|interesting|great|think about|consider|what if)\b/i.test(trimmed);

      const utterance = new SpeechSynthesisUtterance(trimmed);
      if (voice) utterance.voice = voice;

      // Pitch
      let pitch = 1.0;
      if (isQuestion) pitch = 1.18;
      else if (isExclamation) pitch = 1.12;
      else if (isOpening) pitch = 1.06;
      else if (isClosing) pitch = 0.92;
      else pitch = 1.0 + (Math.random() - 0.45) * 0.14;

      // Rate
      let rate = 0.97;
      if (isShort) rate = 1.04;
      else if (isLong) rate = 0.90;
      else if (hasEmphasis) rate = 0.88;
      else if (isQuestion) rate = 0.94;
      rate += (Math.random() - 0.5) * 0.06;

      // Volume
      let volume = 1.0;
      if (isClosing) volume = 0.9;
      else if (!hasEmphasis) volume = 0.93 + Math.random() * 0.07;

      utterance.pitch = Math.max(0.8, Math.min(1.25, pitch));
      utterance.rate = Math.max(0.8, Math.min(1.12, rate));
      utterance.volume = Math.max(0.8, Math.min(1.0, volume));

      queue.push(utterance);
    });

    if (!queue.length) return;

    queue[0].onstart = () => {
      $('voice-indicator').className = 'speaking';
      setText($('voice-label'), 'Speaking...');
    };

    queue.forEach((u) => window.speechSynthesis.speak(u));
  }

  function splitIntoClauses(text) {
    const chunks = [];
    const sentences = text.split(/(?<=[.!?])\s*/);

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;

      if (trimmed.split(/\s+/).length > 8) {
        const clauses = trimmed.split(/(?<=[,;:])\s+|(?<=\s)[-\u2013\u2014]\s+/);
        for (const clause of clauses) {
          if (clause.trim()) chunks.push(clause.trim());
        }
      } else {
        chunks.push(trimmed);
      }
    }

    return chunks;
  }

  // ── Settings ──

  // ── Prompt Editor ──

  async function openPromptEditor() {
    settingsOverlay.hidden = true; // Close settings first

    // Load current prompts into textareas
    $('prompt-custom').value = await Prompts.getCustomRules();
    $('prompt-coding').value = await Prompts.getTemplate('coding');
    $('prompt-system-design').value = await Prompts.getTemplate('system-design');
    $('prompt-behavioral').value = await Prompts.getTemplate('behavioral');

    // Reset to first tab
    document.querySelectorAll('.prompt-tab').forEach((t) => t.classList.remove('active'));
    document.querySelector('.prompt-tab[data-tab="custom"]').classList.add('active');
    document.querySelectorAll('.prompt-tab-content').forEach((c) => { c.hidden = true; });
    document.querySelector('.prompt-tab-content[data-for="custom"]').hidden = false;

    $('prompt-editor').hidden = false;
  }

  function closePromptEditor() {
    $('prompt-editor').hidden = true;
  }

  async function savePrompts() {
    await Prompts.saveCustomRules($('prompt-custom').value);
    await Prompts.saveTemplate('coding', $('prompt-coding').value);
    await Prompts.saveTemplate('system-design', $('prompt-system-design').value);
    await Prompts.saveTemplate('behavioral', $('prompt-behavioral').value);

    $('prompt-editor').hidden = true;
    showError('Prompts saved!'); // Reusing error toast for success notification
  }

  function openSettings() {
    $('settings-provider').value = state.provider;
    $('settings-api-key').value = state.apiKey || '';
    const info = AIClient.PROVIDERS[state.provider];
    if (info) {
      $('settings-api-key').placeholder = info.keyPlaceholder;
    }
    populateModelDropdown(state.provider);
    $('settings-model').value = state.model;
    $('settings-style').value = state.style;
    settingsOverlay.hidden = false;
  }

  async function saveSettings() {
    try {
      const newProvider = $('settings-provider').value;
      const newKey = $('settings-api-key').value.trim();
      const newModel = $('settings-model').value;
      const newStyle = $('settings-style').value;

      if (newKey && newKey !== state.apiKey) {
        await Storage.setApiKey(newKey);
        state.apiKey = newKey;
      }

      state.provider = newProvider;
      state.model = newModel;
      state.style = newStyle;
      await Storage.setSettings({
        provider: newProvider,
        model: newModel,
        interviewStyle: newStyle,
      });

      if (state.apiKey && !setupPanel.hidden) {
        setupPanel.hidden = true;
        controls.hidden = false;
        showModeUI();
      }
    } catch (err) {
      showError('Failed to save settings: ' + err.message);
    } finally {
      settingsOverlay.hidden = true;
    }
  }

  async function wipeAllData() {
    const confirmed = confirm(
      'This will permanently delete your API key, all settings, and session history. Continue?'
    );
    if (!confirmed) return;

    await Storage.wipeAll();

    // Reset all state
    state.apiKey = null;
    state.provider = 'ollama';
    state.model = 'llama3.1';
    state.style = 'balanced';
    state.sessionActive = false;
    state.messages = [];
    state.problemData = null;
    state.startTime = null;
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    if (state.streamController) {
      state.streamController.abort();
      state.streamController = null;
    }

    // Stop voice
    stopRecording();
    window.speechSynthesis?.cancel();

    // Reset all UI
    settingsOverlay.hidden = true;
    controls.hidden = true;
    chatContainer.hidden = true;
    inputArea.hidden = true;
    $('voice-bar').hidden = true;
    summaryPanel.hidden = true;
    setupPanel.hidden = false;
    startBtn.hidden = false;
    endBtn.hidden = true;
    messagesEl.textContent = '';
    setText(timerEl, '00:00');
    $('api-key-input').value = '';
    document.querySelectorAll('.mode-btn').forEach((btn) => { btn.disabled = false; });
    updateSetupUI();
    requestProblemData();
    showError('All data wiped.');
  }

  // ── Boot ──
  init();
})();
