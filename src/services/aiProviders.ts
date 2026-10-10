/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppStore } from '../store/appStore';
import { speechQueue, SpeechPriority } from './speechQueue';

export type AIProviderId = 'gemini' | 'groq' | 'grok' | 'deepseek' | 'openai' | 'claude' | 'custom';

export interface ProviderConfig {
  id: AIProviderId;
  name: string;
  tagline: string;
  defaultModel: string;
  fallbackModel?: string;
  storageKey: string;
  baseUrl: string;
  supportsVision: boolean;
  keyPrefixHint: string;
  docsUrl: string;
}

export const AI_PROVIDERS: Record<AIProviderId, ProviderConfig> = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    tagline: 'Multimodal vision & fast reasoning',
    defaultModel: 'gemini-3.7-flash',
    fallbackModel: 'gemini-3.5-flash-lite',
    storageKey: 'vision_ai_gemini_key',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    supportsVision: true,
    keyPrefixHint: 'AIzaSy...',
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
  groq: {
    id: 'groq',
    name: 'Groq (Ultra Fast)',
    tagline: 'Ultra-fast LPU inference (gsk_... keys)',
    defaultModel: 'openai/gpt-oss-120b',
    fallbackModel: 'qwen/qwen3.8-27b',
    storageKey: 'vision_ai_groq_key',
    baseUrl: 'https://api.groq.com/openai/v1',
    supportsVision: true,
    keyPrefixHint: 'gsk_...',
    docsUrl: 'https://console.groq.com/keys',
  },
  grok: {
    id: 'grok',
    name: 'xAI Grok',
    tagline: 'High-speed Grok reasoning & Grok vision (xai-... keys)',
    defaultModel: 'grok-2-latest',
    fallbackModel: 'grok-2-vision-latest',
    storageKey: 'vision_ai_grok_key',
    baseUrl: 'https://api.x.ai/v1',
    supportsVision: true,
    keyPrefixHint: 'xai-...',
    docsUrl: 'https://console.x.ai/',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    tagline: 'Advanced open-weights reasoning & language',
    defaultModel: 'deepseek-chat',
    fallbackModel: 'deepseek-reasoner',
    storageKey: 'vision_ai_deepseek_key',
    baseUrl: 'https://api.deepseek.com/v1',
    supportsVision: false, // DeepSeek chat is text-only OpenAI-compatible
    keyPrefixHint: 'sk-...',
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI (GPT-4o)',
    tagline: 'GPT-4o omni vision & reasoning',
    defaultModel: 'gpt-4o-mini',
    fallbackModel: 'gpt-4o',
    storageKey: 'vision_ai_openai_key',
    baseUrl: 'https://api.openai.com/v1',
    supportsVision: true,
    keyPrefixHint: 'sk-proj-...',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  claude: {
    id: 'claude',
    name: 'Anthropic Claude',
    tagline: 'Claude 3.5 Sonnet vision & comprehension',
    defaultModel: 'claude-3-5-sonnet-20241022',
    fallbackModel: 'claude-3-5-haiku-20241022',
    storageKey: 'vision_ai_claude_key',
    baseUrl: 'https://api.anthropic.com/v1',
    supportsVision: true,
    keyPrefixHint: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  custom: {
    id: 'custom',
    name: 'Custom OpenAI-Compatible',
    tagline: 'Ollama, OpenRouter, Together AI, vLLM, or self-hosted',
    defaultModel: 'default',
    storageKey: 'vision_ai_custom_key',
    baseUrl: 'https://openrouter.ai/api/v1',
    supportsVision: true,
    keyPrefixHint: 'sk-... or custom key',
    docsUrl: 'https://openrouter.ai/keys',
  },
};

export const ACTIVE_PROVIDER_STORAGE_KEY = 'vision_ai_active_provider';
export const CUSTOM_BASE_URL_KEY = 'vision_ai_custom_base_url';
export const CUSTOM_MODEL_KEY = 'vision_ai_custom_model';
export const GROQ_MODEL_KEY = 'vision_ai_groq_model';

/**
 * Gets configured Groq model name
 */
export function getGroqModel(): string {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(GROQ_MODEL_KEY);
      if (stored && stored.trim()) return stored.trim();
    } catch (_) {}
  }
  const envModel =
    (import.meta as any).env?.GROQ_MODEL ||
    (import.meta as any).env?.VITE_GROQ_MODEL ||
    (typeof process !== 'undefined' && (process.env?.GROQ_MODEL || process.env?.VITE_GROQ_MODEL));
  if (envModel && String(envModel).trim()) return String(envModel).trim();

  return AI_PROVIDERS.groq.defaultModel;
}

export function setGroqModel(model: string): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(GROQ_MODEL_KEY, model.trim());
    } catch (_) {}
  }
}

/**
 * Gets currently active AI provider ID
 */
export function getActiveProviderId(): AIProviderId {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(ACTIVE_PROVIDER_STORAGE_KEY);
      if (stored && AI_PROVIDERS[stored as AIProviderId]) {
        return stored as AIProviderId;
      }
    } catch (_) {}
  }
  return 'gemini';
}

/**
 * Sets active AI provider
 */
export function setActiveProviderId(providerId: AIProviderId): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(ACTIVE_PROVIDER_STORAGE_KEY, providerId);
      useAppStore.getState().setActiveAiProvider(providerId);
    } catch (_) {}
  }
}

/**
 * Gets custom endpoint Base URL
 */
export function getCustomBaseUrl(): string {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(CUSTOM_BASE_URL_KEY);
      if (stored && stored.trim()) return stored.trim();
    } catch (_) {}
  }
  return AI_PROVIDERS.custom.baseUrl;
}

export function setCustomBaseUrl(url: string): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(CUSTOM_BASE_URL_KEY, url.trim());
    } catch (_) {}
  }
}

/**
 * Gets custom model name
 */
export function getCustomModel(): string {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(CUSTOM_MODEL_KEY);
      if (stored && stored.trim()) return stored.trim();
    } catch (_) {}
  }
  return AI_PROVIDERS.custom.defaultModel;
}

export function setCustomModel(model: string): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(CUSTOM_MODEL_KEY, model.trim());
    } catch (_) {}
  }
}

/**
 * Gets API key for a specific provider
 */
export function getProviderApiKey(providerId: AIProviderId): string | null {
  const config = AI_PROVIDERS[providerId];
  if (!config) return null;

  // 1. Check localStorage for this provider
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = window.localStorage.getItem(config.storageKey);
      if (saved && saved.trim() && saved.trim() !== 'MY_GEMINI_API_KEY') {
        return saved.trim();
      }
    } catch (_) {}
  }

  // 2. Fallbacks from env for standard providers
  try {
    if (providerId === 'gemini') {
      const metaKey = (import.meta as any).env?.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY;
      if (metaKey && String(metaKey).trim()) return String(metaKey).trim();
      if (typeof process !== 'undefined') {
        const procKey = process.env?.GEMINI_API_KEY || process.env?.VITE_GEMINI_API_KEY;
        if (procKey && procKey.trim()) return procKey.trim();
      }
    } else if (providerId === 'groq') {
      const groqKey = (import.meta as any).env?.GROQ_API_KEY || (import.meta as any).env?.VITE_GROQ_API_KEY;
      if (groqKey && String(groqKey).trim()) return String(groqKey).trim();
    } else if (providerId === 'grok') {
      const grokKey = (import.meta as any).env?.GROK_API_KEY || (import.meta as any).env?.VITE_GROK_API_KEY;
      if (grokKey && String(grokKey).trim()) return String(grokKey).trim();
    } else if (providerId === 'deepseek') {
      const dsKey = (import.meta as any).env?.DEEPSEEK_API_KEY || (import.meta as any).env?.VITE_DEEPSEEK_API_KEY;
      if (dsKey && String(dsKey).trim()) return String(dsKey).trim();
    } else if (providerId === 'openai') {
      const oaKey = (import.meta as any).env?.OPENAI_API_KEY || (import.meta as any).env?.VITE_OPENAI_API_KEY;
      if (oaKey && String(oaKey).trim()) return String(oaKey).trim();
    } else if (providerId === 'claude') {
      const clKey = (import.meta as any).env?.ANTHROPIC_API_KEY || (import.meta as any).env?.VITE_ANTHROPIC_API_KEY;
      if (clKey && String(clKey).trim()) return String(clKey).trim();
    }
  } catch (_) {}

  return null;
}

/**
 * Saves API key for a specific provider
 */
export function setProviderApiKey(providerId: AIProviderId, key: string): void {
  const config = AI_PROVIDERS[providerId];
  if (!config) return;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (key && key.trim()) {
        window.localStorage.setItem(config.storageKey, key.trim());
      } else {
        window.localStorage.removeItem(config.storageKey);
      }
    } catch (_) {}
  }
}

/**
 * Removes API key for a specific provider
 */
export function removeProviderApiKey(providerId: AIProviderId): void {
  const config = AI_PROVIDERS[providerId];
  if (!config) return;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(config.storageKey);
    } catch (_) {}
  }
}

/**
 * Gets API key for currently active provider, with fallback to any provider that has a configured key
 */
export function getActiveApiKey(): { key: string; provider: AIProviderId } | null {
  const activeId = getActiveProviderId();
  const activeKey = getProviderApiKey(activeId);
  if (activeKey) {
    return { key: activeKey, provider: activeId };
  }

  // Fallback: check other providers if active has no key configured
  const providerList: AIProviderId[] = ['gemini', 'groq', 'grok', 'deepseek', 'openai', 'claude', 'custom'];
  for (const pid of providerList) {
    const k = getProviderApiKey(pid);
    if (k) {
      return { key: k, provider: pid };
    }
  }

  return null;
}

/**
 * Masks any API key safely (shows last 4 chars)
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
 * Notifies user if the active provider has no API key configured
 */
export function notifyActiveApiKeyMissing(): void {
  const activeId = getActiveProviderId();
  const providerName = AI_PROVIDERS[activeId]?.name || 'AI';
  const message = `${providerName} API key is missing. Please add it in Settings.`;
  useAppStore.getState().setLastErrorDebug(message);
  useAppStore.getState().setKeyMissingAlert(true);
  speechQueue.speak(message, SpeechPriority.ASSISTANT_REPLY);
}
