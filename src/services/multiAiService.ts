/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppStore } from '../store/appStore';
import {
  AI_PROVIDERS,
  AIProviderId,
  getActiveApiKey,
  getCustomBaseUrl,
  getCustomModel,
  notifyActiveApiKeyMissing,
} from './aiProviders';
import {
  GEMINI_DEFAULT_MODEL,
  GEMINI_FALLBACK_MODEL,
  callGeminiDirectWithFallback,
  fetchWithTimeout,
} from './gemini';

/**
 * Universal safe API caller: uses server-side proxy route `/api/ai/proxy` first,
 * with direct client fetch fallback.
 */
async function callAiWithProxyFallback(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    timeoutMs?: number;
  }
): Promise<{ ok: boolean; status: number; data: any }> {
  const timeoutMs = options.timeoutMs || 10000;

  // 1. Try server proxy route
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

    if (proxyRes.status !== 502 && proxyRes.status !== 504) {
      return {
        ok: proxyRes.ok,
        status: proxyRes.status,
        data: parsedData,
      };
    }
  } catch (_) {}

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
 * Universal multi-provider question answering.
 * Works with:
 * - Google Gemini
 * - xAI Grok (grok-2-latest / grok-2 / grok-2-vision-1212)
 * - DeepSeek (deepseek-chat / deepseek-reasoner)
 * - OpenAI (gpt-4o-mini / gpt-4o)
 * - Anthropic Claude (claude-3-5-sonnet / haiku)
 * - Custom (Ollama, OpenRouter, vLLM, local LLM)
 */
export async function askMultiProviderQuestion(
  questionText: string,
  context?: { deviceTime?: string }
): Promise<string> {
  const active = getActiveApiKey();
  if (!active || !active.key) {
    notifyActiveApiKeyMissing();
    throw new Error('401: No AI API key is configured. Please add an API key in Settings.');
  }

  const { key, provider } = active;
  const config = AI_PROVIDERS[provider];
  const deviceTime = context?.deviceTime || new Date().toISOString();
  const sysPrompt = `You are VISION_AI, an assistive voice assistant for blind users. Answer in at most 2 plain, short sentences in the language the user spoke. Current device time: ${deviceTime}`;

  // 1. Google Gemini
  if (provider === 'gemini') {
    const promptBody = {
      system_instruction: {
        parts: [{ text: sysPrompt }],
      },
      contents: [{ role: 'user', parts: [{ text: questionText }] }],
    };
    const json = await callGeminiDirectWithFallback(key, promptBody, 8000);
    return json.candidates?.[0]?.content?.parts?.[0]?.text || 'I am here to assist you.';
  }

  // 2. Anthropic Claude
  if (provider === 'claude') {
    const res = await callAiWithProxyFallback(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: {
        model: config.defaultModel,
        max_tokens: 150,
        system: sysPrompt,
        messages: [{ role: 'user', content: questionText }],
      },
      timeoutMs: 10000,
    });

    if (!res.ok) {
      const errDetail = res.data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Claude error: ${errDetail}`);
    }
    return res.data?.content?.[0]?.text || 'I am here to assist you.';
  }

  // 3. OpenAI-Compatible (Grok, DeepSeek, OpenAI, Custom)
  const baseUrl = provider === 'custom' ? getCustomBaseUrl() : config.baseUrl;
  const modelName = provider === 'custom' ? getCustomModel() : config.defaultModel;
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const res = await callAiWithProxyFallback(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: {
      model: modelName,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: questionText },
      ],
      max_tokens: 150,
    },
    timeoutMs: 10000,
  });

  if (!res.ok) {
    const errorDetail =
      res.data?.error?.message ||
      res.data?.error ||
      res.data?.message ||
      `HTTP ${res.status}`;
    throw new Error(`${config.name} error: ${errorDetail}`);
  }

  return res.data?.choices?.[0]?.message?.content || 'I am here to assist you.';
}

/**
 * Universal multi-provider vision descriptor.
 * Supports:
 * - Google Gemini (Native inlineData)
 * - xAI Grok (image_url base64 with grok-2-vision-1212)
 * - OpenAI (image_url base64)
 * - Anthropic Claude (image base64)
 */
export async function describeSurroundingsMultiProvider(imageBase64: string): Promise<string> {
  const active = getActiveApiKey();
  if (!active || !active.key) {
    notifyActiveApiKeyMissing();
    throw new Error('401: No AI API key is configured. Please add an API key in Settings.');
  }

  const { key, provider } = active;
  const prompt =
    'You are helping a blind person walk safely. In 2 short sentences, describe the obstacles and hazards in front of them with direction (left, ahead, right) and approximate distance. Mention stairs, poles, walls, doors, vehicles, people and ground hazards.';

  // 1. Gemini
  if (provider === 'gemini') {
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
            { text: prompt },
          ],
        },
      ],
    };
    const json = await callGeminiDirectWithFallback(key, body, 9000);
    return json.candidates?.[0]?.content?.parts?.[0]?.text || 'Path appears clear.';
  }

  // 2. Claude Vision
  if (provider === 'claude') {
    const config = AI_PROVIDERS.claude;
    const res = await callAiWithProxyFallback(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: {
        model: config.defaultModel,
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: imageBase64,
                },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      },
      timeoutMs: 12000,
    });

    if (!res.ok) {
      const errDetail = res.data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Claude Vision error: ${errDetail}`);
    }
    return res.data?.content?.[0]?.text || 'Path appears clear.';
  }

  // 3. Grok / OpenAI / Custom Vision
  const config = AI_PROVIDERS[provider];
  const baseUrl = provider === 'custom' ? getCustomBaseUrl() : config.baseUrl;
  const modelName =
    provider === 'grok'
      ? 'grok-2-vision-1212'
      : provider === 'custom'
      ? getCustomModel()
      : config.defaultModel;
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const res = await callAiWithProxyFallback(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: {
      model: modelName,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
            },
          ],
        },
      ],
      max_tokens: 150,
    },
    timeoutMs: 12000,
  });

  if (!res.ok) {
    const errorDetail =
      res.data?.error?.message ||
      res.data?.error ||
      res.data?.message ||
      `HTTP ${res.status}`;
    throw new Error(`${config.name} Vision error: ${errorDetail}`);
  }

  return res.data?.choices?.[0]?.message?.content || 'Path appears clear.';
}

/**
 * Universal OCR Text Reader across configured AI providers
 */
export async function readTextMultiProvider(imageBase64: string): Promise<string> {
  const active = getActiveApiKey();
  if (!active || !active.key) {
    notifyActiveApiKeyMissing();
    throw new Error('401: No AI API key is configured. Please add an API key in Settings.');
  }

  const { key, provider } = active;
  const prompt =
    'Read all visible text in this image clearly and concisely for a blind person. If no text is readable, say "No readable text found". Do not describe anything other than the text itself.';

  // 1. Gemini
  if (provider === 'gemini') {
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
            { text: prompt },
          ],
        },
      ],
    };
    const json = await callGeminiDirectWithFallback(key, body, 9000);
    return json.candidates?.[0]?.content?.parts?.[0]?.text || 'No readable text found.';
  }

  // 2. Claude Vision
  if (provider === 'claude') {
    const config = AI_PROVIDERS.claude;
    const res = await callAiWithProxyFallback(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: {
        model: config.defaultModel,
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: imageBase64,
                },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      },
      timeoutMs: 12000,
    });

    if (!res.ok) {
      const errDetail = res.data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Claude OCR error: ${errDetail}`);
    }
    return res.data?.content?.[0]?.text || 'No readable text found.';
  }

  // 3. Grok / OpenAI / Custom Vision
  const config = AI_PROVIDERS[provider];
  const baseUrl = provider === 'custom' ? getCustomBaseUrl() : config.baseUrl;
  const modelName =
    provider === 'grok'
      ? 'grok-2-vision-1212'
      : provider === 'custom'
      ? getCustomModel()
      : config.defaultModel;
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const res = await callAiWithProxyFallback(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: {
      model: modelName,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
            },
          ],
        },
      ],
      max_tokens: 150,
    },
    timeoutMs: 12000,
  });

  if (!res.ok) {
    const errorDetail =
      res.data?.error?.message ||
      res.data?.error ||
      res.data?.message ||
      `HTTP ${res.status}`;
    throw new Error(`${config.name} OCR error: ${errorDetail}`);
  }

  return res.data?.choices?.[0]?.message?.content || 'No readable text found.';
}
