# Privacy Policy

**Last updated:** March 2025

Mock Assist is a browser extension that helps you practice technical interviews. This policy explains what data the extension handles and how.

## Data Collection

Mock Assist does **not** collect, transmit, or store any personal data on external servers. The extension runs entirely in your browser.

## What Data Stays on Your Device

- **API keys**: Encrypted at rest using AES-256-GCM and stored in Chrome's local storage. Decrypted keys are held only in session memory and cleared when the browser closes.
- **Interview sessions**: Chat history and scores are stored locally in Chrome storage. They never leave your device.
- **Settings and preferences**: Stored locally in Chrome storage.

## External Services

When you start an interview, your messages are sent to the AI provider **you choose**:

| Provider | Data sent to | Privacy policy |
|----------|-------------|----------------|
| Ollama | `localhost` (your machine) | No external transmission |
| Google Gemini | `generativelanguage.googleapis.com` | [Google AI Privacy](https://ai.google.dev/terms) |
| Anthropic Claude | `api.anthropic.com` | [Anthropic Privacy](https://www.anthropic.com/privacy) |
| OpenAI | `api.openai.com` | [OpenAI Privacy](https://openai.com/privacy) |

Mock Assist sends only the conversation messages and system prompt to your chosen provider. No other data (browsing history, personal information, etc.) is transmitted.

## LeetCode Page Access

The extension reads problem content (title, description, difficulty) from LeetCode pages you visit. This data is used locally to provide interview context and is never sent anywhere except to your chosen AI provider as part of the interview prompt.

## Data Deletion

You can delete all stored data at any time via **Settings > Wipe All Data**. This removes your API key, settings, and all session history.

## Changes

If this policy changes, the update will be reflected in this file with a new date.

## Contact

For questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/shsingh67/mock-assist).
