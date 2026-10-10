/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppStore } from '../store/appStore';
import { speechQueue, SpeechPriority } from './speechQueue';

export const GEMINI_STORAGE_KEY = 'vision_ai_gemini_key';
export const GEMINI_DEFAULT_MODEL =
  (import.meta as any).env?.VITE_GEMINI_MODEL ||
  (typeof process !== 'undefined' && process.env?.VITE_GEMINI_MODEL) ||
  'gemini-3.7-flash';
export const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite';

export function getGeminiModel(): string {
  return GEMINI_DEFAULT_MODEL;
}

/**
 * Retrieves the Gemini API key checking in strict precedence order:
 * a) the key saved in Settings (localStorage "vision_ai_gemini_key")
 * b) process.env.GEMINI_API_KEY (if defined)
 * c) import.meta.env.GEMINI_API_KEY
 * d) import.meta.env.VITE_GEMINI_API_KEY
 * e) process.env.VITE_GEMINI_API_KEY
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

  // 2. process.env.GEMINI_API_KEY
  try {
    if (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) {
      const procKey = process.env.GEMINI_API_KEY;
      if (procKey && procKey.trim() && !procKey.includes('MY_GEMINI_API_KEY')) {
        return procKey.trim();
      }
    }
  } catch (_) {}

  // 3. import.meta.env.GEMINI_API_KEY
  try {
    const metaKey = (import.meta as any).env?.GEMINI_API_KEY;
    if (metaKey && String(metaKey).trim() && !String(metaKey).includes('MY_GEMINI_API_KEY')) {
      return String(metaKey).trim();
    }
  } catch (_) {}

  // 4. import.meta.env.VITE_GEMINI_API_KEY
  try {
    const viteKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
    if (viteKey && String(viteKey).trim() && !String(viteKey).includes('MY_GEMINI_API_KEY')) {
      return String(viteKey).trim();
    }
  } catch (_) {}

  // 5. process.env.VITE_GEMINI_API_KEY
  try {
    if (typeof process !== 'undefined' && process.env?.VITE_GEMINI_API_KEY) {
      const procVite = process.env.VITE_GEMINI_API_KEY;
      if (procVite && procVite.trim() && !procVite.includes('MY_GEMINI_API_KEY')) {
        return procVite.trim();
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
 * Tests an API key against Gemini by sending a lightweight generateContent request.
 * If the primary model returns 404, automatically attempts the fallback model ("gemini-3.5-flash-lite").
 * Never logs the key to console.
 */
export async function testApiKey(keyToTest: string): Promise<{ ok: boolean; message: string }> {
  const key = keyToTest.trim();
  if (!key) {
    return { ok: false, message: 'Please provide an API key to test.' };
  }

  const primaryModel = GEMINI_DEFAULT_MODEL;
  const fallbackModel = GEMINI_FALLBACK_MODEL;

  const tryModel = async (model: string): Promise<Response> => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);

    try {
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
      return response;
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  };

  try {
    let response = await tryModel(primaryModel);

    // If 404, attempt fallback model
    if (response.status === 404) {
      try {
        const fallbackResponse = await tryModel(fallbackModel);
        if (fallbackResponse.ok) {
          return { ok: true, message: `Key works (using fallback model: ${fallbackModel})` };
        }
        response = fallbackResponse;
      } catch (_) {
        // Keep initial response if fallback throws
      }
    }

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
      return {
        ok: false,
        message: `Model not found (404). Neither ${primaryModel} nor fallback model ${fallbackModel} are available.`,
      };
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
