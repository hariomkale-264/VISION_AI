/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppStore } from '../store/appStore';
import { speechQueue, SpeechPriority } from './speechQueue';

export const GEMINI_STORAGE_KEY = 'vision_ai_gemini_key';
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

/**
 * Retrieves the Gemini API key checking in strict precedence order:
 * a) the key saved in Settings (localStorage "vision_ai_gemini_key")
 * b) import.meta.env.VITE_GEMINI_API_KEY
 * c) process.env.GEMINI_API_KEY (if defined)
 * 
 * NEVER writes the key to console logs.
 */
export function getApiKey(): string | null {
  // 1. Key saved in Settings (localStorage)
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = window.localStorage.getItem(GEMINI_STORAGE_KEY);
      if (saved && saved.trim() && saved.trim() !== 'MY_GEMINI_API_KEY') {
        return saved.trim();
      }
    } catch (_) {}
  }

  // 2. import.meta.env.VITE_GEMINI_API_KEY
  try {
    const viteKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
    if (viteKey && String(viteKey).trim() && !String(viteKey).includes('MY_GEMINI_API_KEY')) {
      return String(viteKey).trim();
    }
  } catch (_) {}

  // 3. process.env.GEMINI_API_KEY (if defined)
  try {
    if (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) {
      const procKey = process.env.GEMINI_API_KEY;
      if (procKey && procKey.trim() && !procKey.includes('MY_GEMINI_API_KEY')) {
        return procKey.trim();
      }
    }
  } catch (_) {}

  return null;
}

/**
 * Returns a masked representation of the key showing only the last 4 characters.
 * Example: "••••••••AB12"
 */
export function maskApiKey(key: string | null | undefined): string {
  if (!key || key.trim().length === 0) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 4) {
    return '••••' + trimmed;
  }
  const last4 = trimmed.slice(-4);
  return '••••••••' + last4;
}

/**
 * Announces and displays the missing API key error with a jump-to-settings action.
 */
export function notifyApiKeyMissing(): void {
  const message = 'Gemini API key is missing. Please add it in Settings.';
  useAppStore.getState().setLastErrorDebug(message);
  useAppStore.getState().setKeyMissingAlert(true);
  speechQueue.speak(message, SpeechPriority.ASSISTANT_REPLY);
}

/**
 * Tests an API key against Gemini by sending one tiny request to gemini-2.5-flash.
 * Never logs the key to console.
 */
export async function testApiKey(keyToTest: string): Promise<{ ok: boolean; message: string }> {
  const key = keyToTest.trim();
  if (!key) {
    return { ok: false, message: 'Please provide an API key to test.' };
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent?key=${key}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Respond with OK.' }],
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return { ok: true, message: 'Key works' };
    }

    let detail = `HTTP ${response.status} ${response.statusText}`;
    try {
      const errorJson = await response.json();
      if (errorJson.error?.message) {
        detail = `HTTP ${response.status}: ${errorJson.error.message}`;
      }
    } catch (_) {}

    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: `API key problem: ${detail}` };
    }
    if (response.status === 404) {
      return { ok: false, message: `Model not found: ${detail}` };
    }
    if (response.status === 429) {
      return { ok: false, message: `Too many requests (429): ${detail}` };
    }

    return { ok: false, message: detail };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { ok: false, message: 'Request timed out after 9 seconds.' };
    }
    return { ok: false, message: String(err?.message || err) };
  }
}
