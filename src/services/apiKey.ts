/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppStore } from '../store/appStore';
import { speechQueue, SpeechPriority } from './speechQueue';
import {
  AI_PROVIDERS,
  AIProviderId,
  getActiveProviderId,
  getActiveApiKey,
  getCustomBaseUrl,
  getCustomModel,
  notifyActiveApiKeyMissing,
} from './aiProviders';

// Re-export common keys for backwards compatibility
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
 * Universal getApiKey:
 * Returns the API key for the active AI provider (Gemini, Grok, DeepSeek, OpenAI, Claude, or Custom).
 * If no key is configured on the active provider, falls back to any configured provider.
 */
export function getApiKey(): string | null {
  const activeInfo = getActiveApiKey();
  return activeInfo ? activeInfo.key : null;
}

/**
 * Saves Gemini API key (for backwards compatibility)
 */
export function setApiKey(key: string): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (key && key.trim()) {
        window.localStorage.setItem(GEMINI_STORAGE_KEY, key.trim());
      } else {
        window.localStorage.removeItem(GEMINI_STORAGE_KEY);
      }
    } catch (_) {}
  }
}

/**
 * Removes Gemini API key (for backwards compatibility)
 */
export function removeApiKey(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(GEMINI_STORAGE_KEY);
    } catch (_) {}
  }
}

/**
 * Masks an API key showing only the last 4 characters.
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
 * Announces missing API key with audio alert
 */
export function notifyApiKeyMissing(): void {
  notifyActiveApiKeyMissing();
}

/**
 * Universal proxy caller for external AI APIs.
 * First tries the backend `/api/ai/proxy` endpoint (preventing browser CORS issues and malformed request formats),
 * and gracefully falls back to direct client fetch if offline or in static preview.
 */
async function callAiWithProxyFallback(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    timeoutMs?: number;
  }
): Promise<{ ok: boolean; status: number; data: any; text?: string }> {
  const timeoutMs = options.timeoutMs || 10000;

  // 1. Try server proxy endpoint first
  try {
    const proxyController = new AbortController();
    const proxyTimeout = setTimeout(() => proxyController.abort(), timeoutMs);

    const proxyRes = await fetch('/api/ai/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        method: options.method || 'POST',
        headers: options.headers || {},
        body: options.body,
      }),
      signal: proxyController.signal,
    });
    clearTimeout(proxyTimeout);

    let parsedData: any = null;
    const contentType = proxyRes.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        parsedData = await proxyRes.json();
      } catch (_) {}
    } else {
      const rawText = await proxyRes.text();
      try {
        parsedData = JSON.parse(rawText);
      } catch (_) {
        parsedData = { text: rawText };
      }
    }

    // If server responded with a definitive upstream status (200, 400, 401, 403, 404, 429), return it
    if (proxyRes.status !== 502 && proxyRes.status !== 504) {
      return {
        ok: proxyRes.ok,
        status: proxyRes.status,
        data: parsedData,
      };
    }
  } catch (proxyErr) {
    // Fall through to direct fetch
  }

  // 2. Direct browser fetch fallback
  const directController = new AbortController();
  const directTimeout = setTimeout(() => directController.abort(), timeoutMs);
  try {
    const directRes = await fetch(url, {
      method: options.method || 'POST',
      headers: options.headers || {},
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: directController.signal,
    });
    clearTimeout(directTimeout);

    let parsedData: any = null;
    try {
      parsedData = await directRes.json();
    } catch (_) {}

    return {
      ok: directRes.ok,
      status: directRes.status,
      data: parsedData,
    };
  } catch (directErr: any) {
    clearTimeout(directTimeout);
    throw directErr;
  }
}

/**
 * Universal testApiKey:
 * Tests the key against whichever provider is selected (Gemini, Grok, DeepSeek, OpenAI, Claude, Custom).
 * Extracts human-readable errors and tests both models and chat completions.
 */
export async function testApiKey(
  keyToTest: string,
  providerId?: AIProviderId
): Promise<{ ok: boolean; message: string }> {
  const key = keyToTest.trim();
  if (!key) {
    return { ok: false, message: 'Please provide an API key to test.' };
  }

  const pid = providerId || getActiveProviderId();
  const config = AI_PROVIDERS[pid];

  if (!config) {
    return { ok: false, message: `Unknown provider: ${pid}` };
  }

  // 1. Google Gemini Native API
  if (pid === 'gemini') {
    const primaryModel = config.defaultModel;
    const fallbackModel = config.fallbackModel || 'gemini-3.5-flash-lite';

    const tryGemini = async (model: string): Promise<Response> => {
      const url = `${config.baseUrl}/models/${model}:generateContent?key=${key}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 9000);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Respond with OK.' }] }],
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
      let response = await tryGemini(primaryModel);
      if (response.status === 404) {
        try {
          const fallbackRes = await tryGemini(fallbackModel);
          if (fallbackRes.ok) {
            return { ok: true, message: `Key works (using fallback model: ${fallbackModel})` };
          }
          response = fallbackRes;
        } catch (_) {}
      }

      if (response.ok) {
        return { ok: true, message: 'Gemini API key is verified and operational!' };
      }

      let detail = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errJson = await response.json();
        if (errJson.error?.message) detail = errJson.error.message;
      } catch (_) {}

      return { ok: false, message: `Gemini Error: ${detail}` };
    } catch (err: any) {
      if (err.name === 'AbortError') return { ok: false, message: 'Connection timed out after 9 seconds.' };
      return { ok: false, message: String(err?.message || err) };
    }
  }

  // 2. Anthropic Claude API
  if (pid === 'claude') {
    try {
      const proxyResult = await callAiWithProxyFallback(`${config.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: {
          model: config.defaultModel,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say OK' }],
        },
        timeoutMs: 10000,
      });

      if (proxyResult.ok) {
        return { ok: true, message: 'Anthropic Claude API key verified!' };
      }

      const detail =
        proxyResult.data?.error?.message ||
        proxyResult.data?.error ||
        `HTTP ${proxyResult.status}`;
      return { ok: false, message: `Claude Error: ${detail}` };
    } catch (err: any) {
      return { ok: false, message: String(err?.message || err) };
    }
  }

  // 3. xAI Grok: specialized verification to handle model names and quota/credit feedback
  if (pid === 'grok') {
    // Helpful guide if user entered a Groq key (starts with "gsk_") into xAI Grok (needs "xai-...")
    if (key.startsWith('gsk_')) {
      // Test it against Groq automatically!
      try {
        const groqTest = await testApiKey(key, 'groq');
        if (groqTest.ok) {
          // Auto-save under Groq and inform the user
          const { setProviderApiKey, setActiveProviderId } = await import('./aiProviders');
          setProviderApiKey('groq', key);
          setActiveProviderId('groq');
          useAppStore.getState().setActiveAiProvider('groq');
          return {
            ok: true,
            message: 'Detected Groq API key (gsk_...)! Automatically connected and verified on Groq (Llama-3.3-70B LPU).',
          };
        }
      } catch (_) {}

      return {
        ok: false,
        message: 'This key begins with "gsk_", which is a Groq API key (console.groq.com), not an xAI Grok key (console.x.ai). Please select the "Groq (Ultra Fast)" tab to use it.',
      };
    }

    // 3a. First check xAI key validity using GET /v1/api-key or GET /v1/models (standard lightweight auth check)
    try {
      const authCheck = await callAiWithProxyFallback(`https://api.x.ai/v1/api-key`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
        },
        timeoutMs: 8000,
      });

      if (authCheck.ok) {
        return { ok: true, message: 'xAI Grok API key is verified and active!' };
      }
    } catch (_) {}

    // 3b. Try chat completion with multiple known Grok model names (grok-2-latest, grok-2, grok-2-vision-1212)
    const modelsToTry = ['grok-2-latest', 'grok-2', 'grok-2-vision-1212', 'grok-beta'];
    let lastError = '';

    for (const modelCandidate of modelsToTry) {
      try {
        const chatRes = await callAiWithProxyFallback(`https://api.x.ai/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: {
            model: modelCandidate,
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 10,
          },
          timeoutMs: 8000,
        });

        if (chatRes.ok) {
          return { ok: true, message: `xAI Grok API key verified using model ${modelCandidate}!` };
        }

        const errMsg =
          chatRes.data?.error?.message ||
          chatRes.data?.error ||
          chatRes.data?.message ||
          `HTTP ${chatRes.status}`;

        lastError = errMsg;

        // If it's a 401 Unauthorized or 403 Forbidden, stop retrying models (the key is invalid)
        if (chatRes.status === 401 || chatRes.status === 403) {
          return { ok: false, message: `xAI Grok Authentication Failed: ${errMsg}` };
        }

        // If it's a quota error (429 or credit exhausted), report clearly
        if (chatRes.status === 429 || String(errMsg).toLowerCase().includes('credit') || String(errMsg).toLowerCase().includes('quota')) {
          return { ok: false, message: `xAI Grok Quota / Credit limit reached: ${errMsg}` };
        }
      } catch (e: any) {
        lastError = e?.message || String(e);
      }
    }

    return { ok: false, message: `xAI Grok Error: ${lastError}` };
  }

  // 4. OpenAI, DeepSeek, Custom (OpenAI-Compatible APIs)
  const baseUrl = pid === 'custom' ? getCustomBaseUrl() : config.baseUrl;
  const modelName = pid === 'custom' ? getCustomModel() : config.defaultModel;
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  try {
    const proxyResult = await callAiWithProxyFallback(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: {
        model: modelName,
        messages: [{ role: 'user', content: 'Say OK' }],
        max_tokens: 10,
      },
      timeoutMs: 10000,
    });

    if (proxyResult.ok) {
      return { ok: true, message: `${config.name} API key verified and operational!` };
    }

    const detail =
      proxyResult.data?.error?.message ||
      proxyResult.data?.error ||
      proxyResult.data?.message ||
      `HTTP ${proxyResult.status}`;

    return { ok: false, message: `${config.name} Error: ${detail}` };
  } catch (err: any) {
    if (err.name === 'AbortError') return { ok: false, message: 'Request timed out after 10 seconds.' };
    return { ok: false, message: String(err?.message || err) };
  }
}
