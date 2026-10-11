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
export interface ApiKeyTestResult {
  ok: boolean;
  message: string;
  discoveredModels?: string[];
  activeModel?: string;
  activeVisionModel?: string;
}

export async function testApiKey(
  keyToTest: string,
  providerId?: AIProviderId
): Promise<ApiKeyTestResult> {
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

  // 3. xAI Grok: authentic verification against official api.x.ai endpoints with dynamic model discovery
  if (pid === 'grok') {
    let formatWarning = '';
    if (key.startsWith('gsk_')) {
      formatWarning = ' (Note: Key starts with "gsk_", which is typically a Groq key rather than an xAI Grok key)';
    }

    // Step 3a: Discover available models on this xAI account via official GET /v1/models
    let discoveredModels: string[] = [];
    let discoveredVisionModel = '';
    try {
      const modelsRes = await callAiWithProxyFallback('https://api.x.ai/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        timeoutMs: 9000,
      });

      if (modelsRes.status === 401 || modelsRes.status === 403) {
        return {
          ok: false,
          message: `xAI Grok Authentication Failed (HTTP ${modelsRes.status}): Invalid API key. Please generate a valid key at console.x.ai.${formatWarning}`,
        };
      }

      if (modelsRes.status === 429) {
        return {
          ok: false,
          message: 'xAI Grok Quota Exceeded (HTTP 429): Your account has run out of credits or reached its rate limit. Please check billing at console.x.ai.',
        };
      }

      if (modelsRes.ok && modelsRes.data?.data && Array.isArray(modelsRes.data.data)) {
        discoveredModels = modelsRes.data.data
          .map((m: any) => (typeof m === 'string' ? m : m.id))
          .filter((id: any) => typeof id === 'string' && id.trim().length > 0);

        const visionMatch = discoveredModels.find(
          (m) => m.toLowerCase().includes('vision') || m.toLowerCase().includes('vl')
        );
        if (visionMatch) {
          discoveredVisionModel = visionMatch;
        }
      }
    } catch (_) {
      // Continue to chat completion fallback
    }

    // Step 3b: Determine model candidate for chat completion
    const { getGrokModel, setGrokModel, setGrokVisionModel } = await import('./aiProviders');
    const configuredModel = getGrokModel();

    let candidateModels: string[] = [];
    if (discoveredModels.length > 0) {
      if (discoveredModels.includes(configuredModel)) {
        candidateModels.push(configuredModel);
      }
      // Prioritize standard Grok text models
      const preferred = ['grok-2-1212', 'grok-2', 'grok-2-latest', 'grok-beta'];
      for (const p of preferred) {
        if (discoveredModels.includes(p) && !candidateModels.includes(p)) {
          candidateModels.push(p);
        }
      }
      // Any remaining non-vision models
      for (const m of discoveredModels) {
        if (!m.includes('vision') && !candidateModels.includes(m)) {
          candidateModels.push(m);
        }
      }
      if (candidateModels.length === 0) candidateModels = discoveredModels;
    } else {
      candidateModels = [configuredModel, 'grok-2-1212', 'grok-2', 'grok-2-latest', 'grok-beta'];
    }

    let lastError = '';
    let lastStatusCode = 0;

    for (const modelCandidate of candidateModels) {
      try {
        const chatRes = await callAiWithProxyFallback('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: {
            model: modelCandidate,
            messages: [{ role: 'user', content: 'Respond with OK.' }],
            max_tokens: 10,
          },
          timeoutMs: 9000,
        });

        if (chatRes.ok) {
          // Update confirmed operational model
          setGrokModel(modelCandidate);
          if (discoveredVisionModel) {
            setGrokVisionModel(discoveredVisionModel);
          }
          const visionNote = discoveredVisionModel
            ? ` | Vision: ${discoveredVisionModel}`
            : ' | Vision: grok-2-vision-1212';
          return {
            ok: true,
            message: `xAI Grok API key verified successfully! Active model: ${modelCandidate}${visionNote}`,
          };
        }

        lastStatusCode = chatRes.status;
        const errMsg =
          chatRes.data?.error?.message ||
          chatRes.data?.error ||
          chatRes.data?.message ||
          `HTTP ${chatRes.status}`;
        lastError = errMsg;

        if (chatRes.status === 401 || chatRes.status === 403) {
          return {
            ok: false,
            message: `xAI Grok Authentication Failed (HTTP ${chatRes.status}): Invalid API key. Please check your key at console.x.ai.${formatWarning}`,
          };
        }

        if (chatRes.status === 429) {
          return {
            ok: false,
            message: `xAI Grok Quota Exceeded (HTTP 429): Quota exhausted or rate limit reached on console.x.ai.`,
          };
        }
      } catch (err: any) {
        lastError = err?.message || String(err);
      }
    }

    if (lastStatusCode === 404) {
      return {
        ok: false,
        message: `xAI Grok Model Not Found (HTTP 404): The requested model was not found on your xAI account. Available models: ${
          discoveredModels.length > 0 ? discoveredModels.slice(0, 4).join(', ') : 'None discovered'
        }`,
      };
    }

    return {
      ok: false,
      message: `xAI Grok Error: ${lastError || 'Could not connect to api.x.ai'}${formatWarning}`,
    };
  }

  // 4. Groq (Ultra Fast LPU): authentic verification against api.groq.com/openai/v1
  if (pid === 'groq') {
    const { getGroqModel, setGroqModel, setGroqVisionModel } = await import('./aiProviders');
    const configuredModel = getGroqModel();

    // Discover available models on Groq via GET /v1/models
    let discoveredModels: string[] = [];
    let discoveredVisionModel = '';
    try {
      const modelsRes = await callAiWithProxyFallback('https://api.groq.com/openai/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        timeoutMs: 9000,
      });

      if (modelsRes.status === 401 || modelsRes.status === 403) {
        return {
          ok: false,
          message: `Groq Authentication Failed (HTTP ${modelsRes.status}): Invalid API key. Please check your key at console.groq.com.`,
        };
      }

      if (modelsRes.status === 429) {
        return {
          ok: false,
          message: 'Groq Rate Limit Exceeded (HTTP 429): Rate limit hit on console.groq.com.',
        };
      }

      if (modelsRes.ok && modelsRes.data?.data && Array.isArray(modelsRes.data.data)) {
        discoveredModels = modelsRes.data.data
          .map((m: any) => (typeof m === 'string' ? m : m.id))
          .filter((id: any) => typeof id === 'string' && id.trim().length > 0)
          .filter((id: string) => !id.includes('llama-3.2-11b-vision-preview') && !id.includes('llama-3.2-90b-vision-preview'));

        const visionMatch = discoveredModels.find(
          (m) =>
            m.includes('qwen') ||
            m.includes('llama-4-scout') ||
            m.includes('llama-4-maverick') ||
            m.includes('vision')
        );
        if (visionMatch) {
          discoveredVisionModel = visionMatch;
        }
      }
    } catch (_) {}

    // Exclude audio/speech/moderation models that cannot do chat completions
    const isChatModel = (id: string) => {
      const lower = id.toLowerCase();
      return (
        !lower.startsWith('whisper') &&
        !lower.includes('orpheus') &&
        !lower.includes('prompt-guard') &&
        !lower.includes('safeguard') &&
        !lower.includes('embed')
      );
    };
    const chatDiscovered = discoveredModels.filter(isChatModel);

    const candidateModels: string[] = [];
    if (configuredModel && chatDiscovered.includes(configuredModel)) {
      candidateModels.push(configuredModel);
    }

    const preferredOrder = [
      'openai/gpt-oss-120b',
      'qwen/qwen3.8-27b',
      'openai/gpt-oss-20b',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'mixtral-8x7b-32768',
      'allam-2-7b',
    ];

    for (const p of preferredOrder) {
      if (chatDiscovered.includes(p) && !candidateModels.includes(p)) {
        candidateModels.push(p);
      }
    }

    for (const m of chatDiscovered) {
      if (!candidateModels.includes(m)) {
        candidateModels.push(m);
      }
    }

    if (candidateModels.length === 0) {
      if (configuredModel) candidateModels.push(configuredModel);
      candidateModels.push(
        'openai/gpt-oss-120b',
        'qwen/qwen3.8-27b',
        'openai/gpt-oss-20b',
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant'
      );
    }

    let lastError = '';
    let lastStatus = 0;

    for (const modelCandidate of candidateModels) {
      try {
        const chatRes = await callAiWithProxyFallback('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: {
            model: modelCandidate,
            messages: [{ role: 'user', content: 'Say OK' }],
            max_tokens: 10,
          },
          timeoutMs: 9000,
        });

        if (chatRes.ok) {
          setGroqModel(modelCandidate);
          const activeVision = discoveredVisionModel || 'qwen/qwen3.8-27b';
          setGroqVisionModel(activeVision);
          return {
            ok: true,
            message: `Groq (Ultra Fast) API key verified successfully! Active model: ${modelCandidate} | Vision: ${activeVision}`,
            discoveredModels: chatDiscovered,
            activeModel: modelCandidate,
            activeVisionModel: activeVision,
          };
        }

        lastStatus = chatRes.status;
        const errMsg =
          chatRes.data?.error?.message ||
          chatRes.data?.error ||
          chatRes.data?.message ||
          `HTTP ${chatRes.status}`;
        lastError = errMsg;

        if (chatRes.status === 401 || chatRes.status === 403) {
          return {
            ok: false,
            message: `Groq Authentication Failed (HTTP ${chatRes.status}): Invalid API key. Please check your key at console.groq.com.`,
          };
        }

        if (chatRes.status === 429) {
          return {
            ok: false,
            message: `Groq Rate Limit Exceeded (HTTP 429): Quota exhausted or rate limit hit on console.groq.com.`,
          };
        }
      } catch (err: any) {
        lastError = err?.message || String(err);
      }
    }

    if (lastStatus === 404) {
      const avail = chatDiscovered.length > 0 ? chatDiscovered.slice(0, 4).join(', ') : 'None discovered';
      return {
        ok: false,
        message: `Groq Model Not Found (HTTP 404): No available chat model found on your Groq account. Available models: ${avail}`,
      };
    }

    return {
      ok: false,
      message: `Groq Error: ${lastError || 'Could not connect to api.groq.com'}`,
    };
  }

  // 5. OpenAI, DeepSeek, Custom (OpenAI-Compatible APIs)
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

    const status = proxyResult.status;
    const detail =
      proxyResult.data?.error?.message ||
      proxyResult.data?.error ||
      proxyResult.data?.message ||
      `HTTP ${status}`;

    if (status === 401 || status === 403) {
      return { ok: false, message: `${config.name} Authentication Failed: Invalid API key.` };
    }
    if (status === 404) {
      return { ok: false, message: `${config.name} Model Not Found (404): Model '${modelName}' was not found.` };
    }
    if (status === 429) {
      return { ok: false, message: `${config.name} Rate Limit / Quota Exceeded (429).` };
    }

    return { ok: false, message: `${config.name} Error: ${detail}` };
  } catch (err: any) {
    if (err.name === 'AbortError') return { ok: false, message: 'Request timed out after 10 seconds.' };
    return { ok: false, message: String(err?.message || err) };
  }
}
