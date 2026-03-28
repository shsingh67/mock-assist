# Mock Assist

AI-powered mock interview assistant for LeetCode, system design, and behavioral prep. Runs as a Chrome side panel right next to the problem.

## Features

- **Coding interviews** -- Auto-extracts LeetCode problems and simulates a live coding interview
- **System design interviews** -- Paste a topic and get guided through requirements, architecture, and trade-offs
- **Behavioral interviews** -- Practice STAR-method responses with follow-up probing
- **4 AI providers** -- Ollama (free/local), Google Gemini (free tier), Claude, ChatGPT
- **Voice input/output** -- Speech-to-text for answers, text-to-speech for interviewer questions
- **Custom prompts** -- Edit system prompts per mode, add global rules
- **Encrypted key storage** -- API keys encrypted at rest with AES-256-GCM
- **No external dependencies** -- Zero npm packages, no build step, pure vanilla JS

## Quick Start

### 1. Install the extension

```bash
git clone https://github.com/shsingh67/mock-assist.git
```

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `mock-assist` folder

### 2. Choose a provider

| Provider | Cost | Setup |
|----------|------|-------|
| **Ollama** | Free | [Install Ollama](https://ollama.com), then `ollama pull llama3.1` |
| **Gemini** | Free tier | Get a key at [ai.google.dev](https://ai.google.dev) |
| **Claude** | Paid | Get a key at [console.anthropic.com](https://console.anthropic.com) |
| **ChatGPT** | Paid | Get a key at [platform.openai.com](https://platform.openai.com) |

### 3. Start an interview

1. Navigate to any LeetCode problem
2. Click the Mock Assist icon to open the side panel
3. Click **Start Interview**

For system design or behavioral mode, switch modes at the top and enter a topic or job description.

## Interview Modes

### Coding

The extension auto-detects the problem when you're on a LeetCode page. The AI interviewer will:
- Ask you to explain your approach before coding
- Probe edge cases and complexity
- Give hints if you're stuck (but never the answer)
- Score you on problem solving, code quality, and communication

### System Design

Enter a topic like "Design a URL shortener" and the interviewer guides you through:
- Requirements gathering
- High-level architecture
- Deep dives into specific components
- Trade-off discussions

### Behavioral

Paste a job description or leave blank for general prep. The interviewer:
- Asks one question at a time
- Probes for STAR-method specifics
- Covers leadership, conflict, failure, impact, and growth

## Customization

### Interview Style

Choose from three styles in Settings:
- **Strict** -- Rigorous, pushes back on vague answers
- **Balanced** -- Supportive but thorough (default)
- **Friendly** -- Encouraging, more hints

### Custom Prompts

Open **Settings > Edit Prompts** to:
- Add global rules (e.g., "Always ask about Big-O", "Speak in Spanish")
- Edit the full system prompt for each interview mode
- Use template variables: `{{title}}`, `{{difficulty}}`, `{{description}}`, `{{topic}}`, `{{jobDescription}}`

## Security

- API keys are encrypted at rest using AES-256-GCM via the Web Crypto API
- Encryption key is derived from a per-install salt using PBKDF2 (100,000 iterations)
- Decrypted keys exist only in session memory (cleared on browser close)
- All user input is HTML-escaped before rendering (XSS prevention)
- Strict Content Security Policy: `script-src 'self'`
- No external dependencies or CDN scripts
- See [PRIVACY.md](PRIVACY.md) for the full privacy policy

## Development

No build step required. Edit files and reload the extension:

1. Make changes to any file
2. Go to `chrome://extensions`
3. Click the refresh icon on Mock Assist

### Building for distribution

```bash
zip -r mock-assist.zip .
```

## License

[MIT](LICENSE)
