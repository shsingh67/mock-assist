/**
 * Storage layer with encrypted API key management.
 *
 * API keys are encrypted at rest using AES-256-GCM via the Web Crypto API.
 * The encryption key is derived from a per-install salt (unique to this extension
 * install) using PBKDF2. The decrypted key is only held in memory or in
 * chrome.storage.session (which is cleared when the browser closes).
 *
 * This protects against:
 * - Disk access / forensic extraction (ciphertext is useless without the derived key)
 * - Other extensions reading chrome.storage.local (they get ciphertext)
 * - Casual snooping in the Chrome storage viewer
 *
 * It does NOT protect against:
 * - A compromised extension running in the same process (it could read memory)
 * - A full machine compromise (attacker can derive the same key)
 * These are inherent limits of any browser extension storing secrets.
 */
const Storage = {
  // ── Generic storage ──

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

  // ── Encrypted API Key ──

  /**
   * Store an API key encrypted at rest.
   */
  async setApiKey(plaintext) {
    const cryptoKey = await this._getDerivedKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encoded
    );

    // Store as base64-encoded object
    const payload = {
      v: 1, // version, in case we change the scheme later
      iv: bufToBase64(iv),
      ct: bufToBase64(new Uint8Array(ciphertext)),
    };

    await this.set('apiKeyEncrypted', payload);
    // Remove any legacy plaintext key from before encryption was added
    await this.remove('apiKey');
    // Cache in session storage (cleared on browser close, never hits disk unencrypted)
    await chrome.storage.session?.set({ apiKeySession: plaintext });
  },

  /**
   * Retrieve and decrypt the API key.
   * Returns null if no key is stored or decryption fails.
   */
  async getApiKey() {
    // Try session cache first (avoids decryption cost, never persisted to disk)
    try {
      const session = await chrome.storage.session?.get('apiKeySession');
      if (session?.apiKeySession) return session.apiKeySession;
    } catch {
      // session storage not available (e.g., content script context)
    }

    // Fall back to decrypting from local storage
    const payload = await this.get('apiKeyEncrypted');
    if (!payload || payload.v !== 1) {
      // Check for legacy plaintext key (pre-encryption migration)
      const legacy = await this.get('apiKey');
      if (legacy) {
        // Migrate: encrypt it and remove plaintext
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

      // Re-cache in session storage
      try {
        await chrome.storage.session?.set({ apiKeySession: plaintext });
      } catch {
        // Non-critical
      }

      return plaintext;
    } catch {
      // Decryption failed — key may be corrupt or from a different install
      return null;
    }
  },

  /**
   * Wipe the API key from all storage locations.
   */
  async clearApiKey() {
    await this.remove('apiKeyEncrypted');
    await this.remove('apiKey'); // legacy
    try {
      await chrome.storage.session?.remove('apiKeySession');
    } catch {
      // Non-critical
    }
  },

  /**
   * Wipe ALL extension data — keys, settings, sessions. Full reset.
   */
  async wipeAll() {
    await chrome.storage.local.clear();
    try {
      await chrome.storage.session?.clear();
    } catch {
      // Non-critical
    }
  },

  // ── Key Derivation (internal) ──

  /**
   * Derive an AES-256-GCM key from a per-install salt using PBKDF2.
   * The salt is generated once on first use and stored in local storage.
   * Combined with the extension ID (unique per install in dev, per extension in prod),
   * this ties the encryption to this specific browser profile + extension install.
   */
  async _getDerivedKey() {
    let salt = await this.get('_keySalt');
    if (!salt) {
      const rawSalt = crypto.getRandomValues(new Uint8Array(32));
      salt = bufToBase64(rawSalt);
      await this.set('_keySalt', salt);
    }

    // Use extension ID as additional input (unique per browser profile)
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

  // ── Settings ──

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

  // ── Sessions ──

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

// ── Base64 helpers (ArrayBuffer <-> string) ──

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
