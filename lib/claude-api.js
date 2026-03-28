/**
 * Multi-provider AI API client.
 * Supports Claude, OpenAI/ChatGPT, Google Gemini, and Ollama (free/local).
 * All use raw fetch with SSE streaming. No SDKs needed.
 */

const PROVIDERS = {
  ollama: {
    name: 'Ollama (Free, Local)',
    models: [
      { id: 'llama3.1', label: 'Llama 3.1 8B (fast)' },
      { id: 'llama3.1:70b', label: 'Llama 3.1 70B (thorough)' },
      { id: 'mistral', label: 'Mistral 7B' },
      { id: 'gemma2', label: 'Gemma 2 9B' },
      { id: 'deepseek-r1:8b', label: 'DeepSeek R1 8B' },
      { id: 'qwen2.5', label: 'Qwen 2.5 7B' },
    ],
    keyPlaceholder: 'No key needed — just install Ollama',
    keyPrefix: null,
    requiresKey: false,
    url: 'http://localhost:11434/api/chat',
  },
  gemini: {
    name: 'Google Gemini (Free Tier)',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (fast)' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (thorough)' },
    ],
    keyPlaceholder: 'AIza... (free at ai.google.dev)',
    keyPrefix: 'AIza',
    requiresKey: true,
    url: 'https://generativelanguage.googleapis.com/v1beta/models/',
  },
  claude: {
    name: 'Claude (Anthropic)',
    models: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (fast)' },
      { id: 'claude-opus-4-20250514', label: 'Claude Opus 4 (thorough)' },
    ],
    keyPlaceholder: 'sk-ant-...',
    keyPrefix: 'sk-ant-',
    requiresKey: true,
    url: 'https://api.anthropic.com/v1/messages',
  },
  openai: {
    name: 'ChatGPT (OpenAI)',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o (fast)' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini (cheap)' },
      { id: 'o3-mini', label: 'o3-mini (reasoning)' },
    ],
    keyPlaceholder: 'sk-...',
    keyPrefix: 'sk-',
    requiresKey: true,
    url: 'https://api.openai.com/v1/chat/completions',
  },
};

/**
 * Detect provider from API key format.
 */
function detectProvider(apiKey) {
  if (!apiKey) return null;
  if (apiKey.startsWith('sk-ant-')) return 'claude';
  if (apiKey.startsWith('AIza')) return 'gemini';
  if (apiKey.startsWith('sk-')) return 'openai';
  return null;
}

const AIClient = {
  PROVIDERS,
  detectProvider,

  /**
   * Validate an API key by making a minimal request to the provider.
   * Returns { valid: true } or { valid: false, error: string }.
   */
  async validateKey(provider, apiKey) {
    try {
      if (provider === 'ollama') {
        // Just check if Ollama is running
        const res = await fetch('http://localhost:11434/api/tags', {
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return { valid: false, error: 'Ollama not responding' };
        return { valid: true };
      }

      if (provider === 'claude') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
        });
        if (res.status === 401) return { valid: false, error: 'Invalid API key' };
        if (res.status === 403) return { valid: false, error: 'API key lacks permissions' };
        return { valid: true };
      }

      if (provider === 'openai') {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        if (res.status === 401) return { valid: false, error: 'Invalid API key' };
        return { valid: true };
      }

      if (provider === 'gemini') {
        const res = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models',
          { headers: { 'x-goog-api-key': apiKey } }
        );
        if (res.status === 400 || res.status === 403) {
          return { valid: false, error: 'Invalid API key' };
        }
        return { valid: true };
      }

      return { valid: false, error: 'Unknown provider' };
    } catch (err) {
      if (provider === 'ollama') {
        return {
          valid: false,
          error: 'Cannot reach Ollama. Is it running? Start it with: ollama serve',
        };
      }
      return { valid: false, error: `Connection failed: ${err.message}` };
    }
  },

  /**
   * Stream a response from any supported provider.
   */
  stream(provider, apiKey, messages, systemPrompt, model, onChunk, onDone, onError) {
    const streamFn = {
      claude: streamClaude,
      openai: streamOpenAI,
      gemini: streamGemini,
      ollama: streamOllama,
    }[provider];

    if (!streamFn) {
      onError(new Error(`Unknown provider: ${provider}`));
      return new AbortController();
    }

    return streamFn(apiKey, messages, systemPrompt, model, onChunk, onDone, onError);
  },
};

// ── Claude ──

function streamClaude(apiKey, messages, systemPrompt, model, onChunk, onDone, onError) {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: model || 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: systemPrompt,
          messages,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw await buildError(response);

      await readSSE(response, (data) => {
        if (data.type === 'content_block_delta' && data.delta?.text) {
          onChunk(data.delta.text);
        }
      });

      onDone();
    } catch (err) {
      if (err.name !== 'AbortError') onError(err);
    }
  })();

  return controller;
}

// ── OpenAI / ChatGPT ──

function streamOpenAI(apiKey, messages, systemPrompt, model, onChunk, onDone, onError) {
  const controller = new AbortController();

  (async () => {
    try {
      const fullMessages = [
        { role: 'system', content: systemPrompt },
        ...messages,
      ];

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || 'gpt-4o',
          messages: fullMessages,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw await buildError(response);

      await readSSE(response, (data) => {
        const text = data.choices?.[0]?.delta?.content;
        if (text) onChunk(text);
      });

      onDone();
    } catch (err) {
      if (err.name !== 'AbortError') onError(err);
    }
  })();

  return controller;
}

// ── Google Gemini ──

function streamGemini(apiKey, messages, systemPrompt, model, onChunk, onDone, onError) {
  const controller = new AbortController();

  (async () => {
    try {
      const modelId = model || 'gemini-2.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`;

      const contents = messages.map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { maxOutputTokens: 1024 },
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw await buildError(response);

      await readSSE(response, (data) => {
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) onChunk(text);
      });

      onDone();
    } catch (err) {
      if (err.name !== 'AbortError') onError(err);
    }
  })();

  return controller;
}

// ── Ollama (Local, Free) ──

function streamOllama(_apiKey, messages, systemPrompt, model, onChunk, onDone, onError) {
  const controller = new AbortController();

  (async () => {
    try {
      const fullMessages = [
        { role: 'system', content: systemPrompt },
        ...messages,
      ];

      const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'llama3.1',
          messages: fullMessages,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw await buildError(response);

      // Ollama streams newline-delimited JSON (not SSE)
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              onChunk(data.message.content);
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      onDone();
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
        onError(new Error('Cannot reach Ollama. Is it running? Start with: ollama serve'));
      } else {
        onError(err);
      }
    }
  })();

  return controller;
}

// ── Shared Helpers ──

async function readSSE(response, onData) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === '[DONE]' || !jsonStr) continue;

      try {
        onData(JSON.parse(jsonStr));
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

async function buildError(response) {
  const body = await response.text();
  let msg = `API error ${response.status}`;
  try {
    const parsed = JSON.parse(body);
    msg = parsed.error?.message || parsed.error?.status || parsed.error || msg;
  } catch {
    // Use default
  }

  if (response.status === 401) {
    msg = 'Invalid API key. Check your key in settings.';
  } else if (response.status === 429) {
    msg = 'Rate limited. Wait a moment and try again.';
  } else if (response.status === 404) {
    msg = 'Model not found. Make sure you\'ve pulled it (e.g., ollama pull llama3.1)';
  }

  return new Error(msg);
}
