// Storage layer with encrypted API key management (AES-256-GCM + PBKDF2).
const Storage = {

  async get(key) {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? null;
  },

  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },

  async remove(key) {
    await chrome.storage.local.remove(key);
  },


  async setApiKey(plaintext) {
    const cryptoKey = await this._getDerivedKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encoded
    );

    const payload = {
      v: 1,
      iv: bufToBase64(iv),
      ct: bufToBase64(new Uint8Array(ciphertext)),
    };

    await this.set('apiKeyEncrypted', payload);
    await this.remove('apiKey');
    await chrome.storage.session?.set({ apiKeySession: plaintext });
  },

  async getApiKey() {
    try {
      const session = await chrome.storage.session?.get('apiKeySession');
      if (session?.apiKeySession) return session.apiKeySession;
    } catch {
      // ignore
    }

    const payload = await this.get('apiKeyEncrypted');
    if (!payload || payload.v !== 1) {
      const legacy = await this.get('apiKey');
      if (legacy) {
        await this.setApiKey(legacy);
        return legacy;
      }
      return null;
    }

    try {
      const cryptoKey = await this._getDerivedKey();
      const iv = base64ToBuf(payload.iv);
      const ct = base64ToBuf(payload.ct);

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        ct
      );

      const plaintext = new TextDecoder().decode(decrypted);

      try {
        await chrome.storage.session?.set({ apiKeySession: plaintext });
      } catch {
        // ignore
      }

      return plaintext;
    } catch {
      return null;
    }
  },

  async clearApiKey() {
    await this.remove('apiKeyEncrypted');
    await this.remove('apiKey');
    try {
      await chrome.storage.session?.remove('apiKeySession');
    } catch {
      // ignore
    }
  },

  async wipeAll() {
    await chrome.storage.local.clear();
    try {
      await chrome.storage.session?.clear();
    } catch {
      // ignore
    }
  },


  async _getDerivedKey() {
    let salt = await this.get('_keySalt');
    if (!salt) {
      const rawSalt = crypto.getRandomValues(new Uint8Array(32));
      salt = bufToBase64(rawSalt);
      await this.set('_keySalt', salt);
    }

    const extensionId = chrome.runtime?.id || 'mock-assist';
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(extensionId),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: base64ToBuf(salt),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },


  async getSettings() {
    const defaults = {
      provider: 'ollama',
      model: 'llama3.1',
      interviewStyle: 'balanced',
      showTimer: true,
    };
    const saved = await this.get('settings');
    return { ...defaults, ...saved };
  },

  async setSettings(settings) {
    return this.set('settings', settings);
  },


  async saveSession(session) {
    const key = `session_${session.slug || 'custom'}_${Date.now()}`;
    await this.set(key, session);
    return key;
  },

  async getSessionHistory() {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
      .filter(([key]) => key.startsWith('session_'))
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  },
};

// Base64 helpers

function bufToBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
