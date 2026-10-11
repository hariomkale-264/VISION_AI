/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Volume2,
  Gauge,
  Languages,
  RotateCcw,
  ShieldAlert,
  Bug,
  SunMoon,
  Type,
  Key,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Trash2,
  Sparkles,
  Navigation,
  Cpu,
  Server,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useStatsStore } from '../store/statsStore';
import { speechQueue, SpeechPriority } from '../services/speechQueue';
import {
  AI_PROVIDERS,
  AIProviderId,
  getActiveProviderId,
  setActiveProviderId,
  getProviderApiKey,
  setProviderApiKey,
  removeProviderApiKey,
  getCustomBaseUrl,
  setCustomBaseUrl,
  getCustomModel,
  setCustomModel,
  getGrokModel,
  setGrokModel,
  getGrokVisionModel,
  setGrokVisionModel,
  getGroqModel,
  setGroqModel,
  getGroqVisionModel,
  setGroqVisionModel,
  fetchProviderModels,
  maskApiKey,
} from '../services/aiProviders';
import { testApiKey } from '../services/apiKey';
import { CameraTestSection } from '../components/CameraTestSection';

export const SettingsPage: React.FC = () => {
  const highContrast = useAppStore((s) => s.highContrast);
  const setHighContrast = useAppStore((s) => s.setHighContrast);
  const largeText = useAppStore((s) => s.largeText);
  const setLargeText = useAppStore((s) => s.setLargeText);
  const autoStartTurnByTurn = useAppStore((s) => s.autoStartTurnByTurn);
  const setAutoStartTurnByTurn = useAppStore((s) => s.setAutoStartTurnByTurn);
  const speechRate = useAppStore((s) => s.speechRate);
  const setSpeechRate = useAppStore((s) => s.setSpeechRate);
  const speechVolume = useAppStore((s) => s.speechVolume);
  const setSpeechVolume = useAppStore((s) => s.setSpeechVolume);
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const voiceDebugPanel = useAppStore((s) => s.voiceDebugPanel);
  const setVoiceDebugPanel = useAppStore((s) => s.setVoiceDebugPanel);
  const voiceDebugLogs = useAppStore((s) => s.voiceDebugLogs);
  const setLastErrorDebug = useAppStore((s) => s.setLastErrorDebug);
  const setKeyMissingAlert = useAppStore((s) => s.setKeyMissingAlert);
  const activeAiProvider = useAppStore((s) => s.activeAiProvider);
  const setActiveAiProviderStore = useAppStore((s) => s.setActiveAiProvider);

  const resetTodayStats = useStatsStore((s) => s.resetTodayStats);
  const strideLength = useStatsStore((s) => s.strideLength);
  const setStrideLength = useStatsStore((s) => s.setStrideLength);

  // Selected Provider State
  const [selectedProvider, setSelectedProvider] = useState<AIProviderId>(() => getActiveProviderId());
  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savedKeyMasked, setSavedKeyMasked] = useState<string>('');
  const [customBaseUrlInput, setCustomBaseUrlInput] = useState(() => getCustomBaseUrl());
  const [customModelInput, setCustomModelInput] = useState(() => getCustomModel());

  // Distinct Model Configurations for Grok and Groq
  const [grokModelInput, setGrokModelInput] = useState(() => getGrokModel());
  const [grokVisionModelInput, setGrokVisionModelInput] = useState(() => getGrokVisionModel());
  const [groqModelInput, setGroqModelInput] = useState(() => getGroqModel());
  const [groqVisionModelInput, setGroqVisionModelInput] = useState(() => getGroqVisionModel());

  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);

  const [testStatus, setTestStatus] = useState<{
    tested: boolean;
    ok: boolean;
    message: string;
  } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Sync provider on mount and refresh key info
  useEffect(() => {
    refreshKeyStatus(selectedProvider);
    setDiscoveredModels([]);
  }, [selectedProvider]);

  const refreshKeyStatus = (providerId: AIProviderId) => {
    const key = getProviderApiKey(providerId);
    setSavedKeyMasked(key ? maskApiKey(key) : '');
  };

  const handleSelectProvider = (pid: AIProviderId) => {
    setSelectedProvider(pid);
    setActiveProviderId(pid);
    setActiveAiProviderStore(pid);
    setInputKey('');
    setShowKey(false);
    setTestStatus(null);
    setDiscoveredModels([]);
    refreshKeyStatus(pid);
    speechQueue.speak(`AI provider set to ${AI_PROVIDERS[pid].name}`, SpeechPriority.STATUS);
  };

  const handleDiscoverModels = async () => {
    const keyToUse = inputKey.trim() || getProviderApiKey(selectedProvider);
    if (!keyToUse) {
      speechQueue.speak('Please enter or save an API key first.', SpeechPriority.STATUS);
      return;
    }

    setIsDiscovering(true);
    speechQueue.speak(`Checking available models for ${AI_PROVIDERS[selectedProvider].name}...`, SpeechPriority.STATUS);

    try {
      const res = await fetchProviderModels(selectedProvider, keyToUse);
      if (res.ok && res.models.length > 0) {
        setDiscoveredModels(res.models);
        const countMsg = `Found ${res.models.length} models for ${AI_PROVIDERS[selectedProvider].name}.`;
        speechQueue.speak(countMsg, SpeechPriority.STATUS);
      } else {
        const errMsg = res.error || 'No models returned from endpoint.';
        speechQueue.speak(`Model discovery failed: ${errMsg}`, SpeechPriority.STATUS);
        setTestStatus({
          tested: true,
          ok: false,
          message: `Model discovery: ${errMsg}`,
        });
      }
    } catch (e: any) {
      speechQueue.speak('Unable to fetch models.', SpeechPriority.STATUS);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleSaveKey = () => {
    const keyToSave = inputKey.trim();
    if (!keyToSave) {
      speechQueue.speak('Please enter a key before saving.', SpeechPriority.STATUS);
      return;
    }

    try {
      // Save key strictly to the user-selected provider (no silent auto-redirection)
      setProviderApiKey(selectedProvider, keyToSave);

      // Save respective provider model configurations
      if (selectedProvider === 'grok') {
        setGrokModel(grokModelInput);
        setGrokVisionModel(grokVisionModelInput);
      } else if (selectedProvider === 'groq') {
        setGroqModel(groqModelInput);
        setGroqVisionModel(groqVisionModelInput);
      } else if (selectedProvider === 'custom') {
        setCustomBaseUrl(customBaseUrlInput);
        setCustomModel(customModelInput);
      }

      // Ensure active provider matches the user's choice
      setActiveProviderId(selectedProvider);
      setActiveAiProviderStore(selectedProvider);

      setInputKey('');
      setShowKey(false);
      refreshKeyStatus(selectedProvider);
      setTestStatus(null);
      setKeyMissingAlert(false);
      setLastErrorDebug(null);

      const successNotice = `${AI_PROVIDERS[selectedProvider].name} API key saved and set as active engine.`;
      speechQueue.speak(successNotice, SpeechPriority.STATUS);
    } catch (err: any) {
      speechQueue.speak('Failed to save API key to local storage.', SpeechPriority.STATUS);
    }
  };

  const handleRemoveKey = () => {
    try {
      removeProviderApiKey(selectedProvider);
      setInputKey('');
      setShowKey(false);
      setTestStatus(null);
      setDiscoveredModels([]);
      refreshKeyStatus(selectedProvider);

      const notice = `${AI_PROVIDERS[selectedProvider].name} key removed.`;
      speechQueue.speak(notice, SpeechPriority.STATUS);
    } catch (_) {}
  };

  const handleTestKey = async () => {
    const keyToTest = inputKey.trim() || getProviderApiKey(selectedProvider);
    const providerName = AI_PROVIDERS[selectedProvider].name;

    if (!keyToTest) {
      setTestStatus({
        tested: true,
        ok: false,
        message: `No key to test. Please enter or save an API key for ${providerName} first.`,
      });
      speechQueue.speak(`No key to test. Please enter a key.`, SpeechPriority.STATUS);
      return;
    }

    setIsTesting(true);
    setTestStatus(null);
    speechQueue.speak(`Testing API key with ${providerName}...`, SpeechPriority.STATUS);

    try {
      // Always test against the user's explicitly selected provider
      const res = await testApiKey(keyToTest, selectedProvider);
      setTestStatus({
        tested: true,
        ok: res.ok,
        message: res.message,
      });

      if (res.ok) {
        if ((res as any).discoveredModels && (res as any).discoveredModels.length > 0) {
          setDiscoveredModels((res as any).discoveredModels);
        }
        // Sync model states after successful test verification
        if (selectedProvider === 'grok') {
          setGrokModelInput(getGrokModel());
          setGrokVisionModelInput(getGrokVisionModel());
        } else if (selectedProvider === 'groq') {
          setGroqModelInput((res as any).activeModel || getGroqModel());
          setGroqVisionModelInput((res as any).activeVisionModel || getGroqVisionModel());
        }
        speechQueue.speak('API key verified and operational.', SpeechPriority.STATUS);
        setKeyMissingAlert(false);
        setLastErrorDebug(null);
      } else {
        speechQueue.speak(res.message, SpeechPriority.STATUS);
        setLastErrorDebug(res.message);
      }
    } catch (err: any) {
      const msg = String(err?.message || err);
      setTestStatus({
        tested: true,
        ok: false,
        message: msg,
      });
      speechQueue.speak('API key test failed.', SpeechPriority.STATUS);
      setLastErrorDebug(msg);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSpeechRateChange = (newRate: number) => {
    setSpeechRate(newRate);
    speechQueue.speak(`Speech rate set to ${newRate.toFixed(2)}x`, SpeechPriority.STATUS);
  };

  const handleSpeechVolumeChange = (newVol: number) => {
    setSpeechVolume(newVol);
    speechQueue.speak(`Speech volume set to ${Math.round(newVol * 100)} percent`, SpeechPriority.STATUS);
  };

  const handleResetStats = () => {
    resetTodayStats();
    speechQueue.speak("Today's statistics have been reset.", SpeechPriority.STATUS);
  };

  const activeProviderConfig = AI_PROVIDERS[selectedProvider];

  return (
    <div className="space-y-6 max-w-4xl pb-12">
      <div>
        <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">
          Accessibility & System Settings
        </h2>
        <p className="text-xs sm:text-sm font-semibold opacity-70">
          Configure multi-provider AI credentials (Gemini, Grok, DeepSeek, OpenAI, Claude), speech synthesis, display contrast, and diagnostics.
        </p>
      </div>

      {/* Mandatory Disclaimer */}
      <div
        className={`p-4 rounded-2xl border text-xs leading-relaxed flex items-start gap-3 ${
          highContrast
            ? 'bg-zinc-900 border-yellow-400 text-yellow-300'
            : 'bg-amber-50 border-amber-200 text-amber-900'
        }`}
      >
        <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <strong className="block mb-0.5 font-bold">Assistive Device Disclaimer</strong>
          <p>VISION_AI is an assistive tool and does not replace a white cane or guide dog.</p>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* FEATURE: MULTI-AI PROVIDER & API KEY CONFIGURATION */}
      {/* ========================================================================= */}
      <div
        className={`rounded-[28px] p-6 transition-all shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] border ${
          highContrast
            ? 'bg-black border-2 border-yellow-400 text-yellow-400'
            : 'bg-white border-gray-200/80 text-gray-900'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
                highContrast
                  ? 'bg-yellow-400 text-black font-extrabold'
                  : 'bg-indigo-600 text-white shadow-md'
              }`}
            >
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base tracking-tight">AI Provider & API Key</h3>
              <p className="text-xs opacity-70">
                Choose between Google Gemini, xAI Grok, DeepSeek, OpenAI, Claude, or custom endpoints.
              </p>
            </div>
          </div>

          {/* Current Saved Key Masked Badge */}
          {savedKeyMasked ? (
            <div
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-mono font-bold ${
                highContrast
                  ? 'bg-zinc-900 text-yellow-300 border border-yellow-400'
                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                {activeProviderConfig.name}: {savedKeyMasked}
              </span>
            </div>
          ) : (
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
                highContrast
                  ? 'bg-zinc-900 text-amber-300 border border-amber-400'
                  : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}
            >
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>No key saved for {activeProviderConfig.name}</span>
            </div>
          )}
        </div>

        {/* Provider Selection Tabs */}
        <div className="mb-5">
          <label className="block text-xs font-bold tracking-wide uppercase opacity-80 mb-2">
            Select Active AI Engine
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {(Object.keys(AI_PROVIDERS) as AIProviderId[]).map((pid) => {
              const prov = AI_PROVIDERS[pid];
              const isSelected = selectedProvider === pid;
              const hasKey = !!getProviderApiKey(pid);

              return (
                <button
                  key={pid}
                  type="button"
                  onClick={() => handleSelectProvider(pid)}
                  aria-pressed={isSelected}
                  className={`p-3 rounded-2xl text-left border transition-all cursor-pointer flex flex-col justify-between min-h-[76px] ${
                    isSelected
                      ? highContrast
                        ? 'bg-yellow-400 text-black border-yellow-400 font-extrabold shadow-md'
                        : 'bg-indigo-600 text-white border-indigo-600 shadow-md ring-2 ring-indigo-400/40'
                      : highContrast
                      ? 'bg-zinc-950 border-zinc-800 text-yellow-300/80 hover:border-yellow-400/50'
                      : 'bg-gray-50 border-gray-200 text-gray-800 hover:border-indigo-300 hover:bg-gray-100/70'
                  }`}
                >
                  <div className="font-bold text-xs leading-tight flex items-center justify-between w-full">
                    <span>{prov.name}</span>
                    {hasKey && (
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isSelected ? 'bg-white' : 'bg-emerald-500'
                        }`}
                        title="Key configured"
                      />
                    )}
                  </div>
                  <div
                    className={`text-[10px] mt-1 font-mono truncate ${
                      isSelected ? 'opacity-90' : 'opacity-60'
                    }`}
                  >
                    {prov.defaultModel}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* xAI Grok Model Configuration */}
        {selectedProvider === 'grok' && (
          <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 mb-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-xs">
                <Cpu className="w-4 h-4 text-indigo-600 dark:text-yellow-400" />
                <span>xAI Grok Model & Vision Configuration (api.x.ai)</span>
              </div>
              <button
                type="button"
                onClick={handleDiscoverModels}
                disabled={isDiscovering}
                className="text-[11px] font-bold px-3 py-1 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-800 dark:bg-zinc-800 dark:text-yellow-400 dark:hover:bg-zinc-700 transition flex items-center gap-1 cursor-pointer"
              >
                {isDiscovering ? (
                  <span className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <RotateCcw className="w-3 h-3" />
                )}
                <span>Discover Account Models</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1 opacity-80">Reasoning / Chat Model</label>
                <div className="space-y-1.5">
                  <select
                    value={grokModelInput}
                    onChange={(e) => setGrokModelInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono text-xs focus:outline-none"
                  >
                    <option value="grok-2-1212">grok-2-1212 (Official Fast & Accurate)</option>
                    <option value="grok-2">grok-2 (Standard Alias)</option>
                    <option value="grok-2-latest">grok-2-latest (Latest Alias)</option>
                    <option value="grok-beta">grok-beta (Beta Model)</option>
                    {discoveredModels
                      .filter(
                        (m) =>
                          !['grok-2-1212', 'grok-2', 'grok-2-latest', 'grok-beta'].includes(m) &&
                          !m.includes('vision')
                      )
                      .map((m) => (
                        <option key={m} value={m}>
                          {m} (Discovered on Account)
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1 opacity-80">Image Understanding (Vision) Model</label>
                <select
                  value={grokVisionModelInput}
                  onChange={(e) => setGrokVisionModelInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono text-xs focus:outline-none"
                >
                  <option value="grok-2-vision-1212">grok-2-vision-1212 (Multimodal Vision)</option>
                  <option value="grok-2-vision-latest">grok-2-vision-latest (Latest Vision)</option>
                  <option value="grok-vision-beta">grok-vision-beta (Vision Beta)</option>
                  {discoveredModels
                    .filter(
                      (m) =>
                        m.includes('vision') &&
                        !['grok-2-vision-1212', 'grok-2-vision-latest', 'grok-vision-beta'].includes(m)
                    )
                    .map((m) => (
                      <option key={m} value={m}>
                        {m} (Discovered on Account)
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {inputKey.startsWith('gsk_') && (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  Notice: Your key begins with <strong>gsk_</strong>, which is a Groq key (console.groq.com). If you wish to use Groq, select the &ldquo;Groq (Ultra Fast)&rdquo; tab above.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Groq Model Configuration */}
        {selectedProvider === 'groq' && (
          <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 mb-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-xs">
                <Cpu className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Groq LPU Inference Settings (api.groq.com)</span>
              </div>
              <button
                type="button"
                onClick={handleDiscoverModels}
                disabled={isDiscovering}
                className="text-[11px] font-bold px-3 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-zinc-800 dark:text-emerald-400 dark:hover:bg-zinc-700 transition flex items-center gap-1 cursor-pointer"
              >
                {isDiscovering ? (
                  <span className="w-3 h-3 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <RotateCcw className="w-3 h-3" />
                )}
                <span>Discover Account Models</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1 opacity-80">Text Reasoning Model</label>
                <select
                  value={groqModelInput}
                  onChange={(e) => setGroqModelInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono text-xs focus:outline-none"
                >
                  <option value="openai/gpt-oss-120b">openai/gpt-oss-120b (Recommended High-Speed 120B)</option>
                  <option value="qwen/qwen3.8-27b">qwen/qwen3.8-27b (Qwen Multimodal & Reasoning)</option>
                  <option value="openai/gpt-oss-20b">openai/gpt-oss-20b (Ultra-Fast 20B)</option>
                  <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (Llama 3.3 70B)</option>
                  <option value="llama-3.1-8b-instant">llama-3.1-8b-instant (Fastest 8B)</option>
                  <option value="mixtral-8x7b-32768">mixtral-8x7b-32768 (MoE)</option>
                  {discoveredModels
                    .filter(
                      (m) =>
                        ![
                          'openai/gpt-oss-120b',
                          'qwen/qwen3.8-27b',
                          'openai/gpt-oss-20b',
                          'llama-3.3-70b-versatile',
                          'llama-3.1-8b-instant',
                          'mixtral-8x7b-32768',
                        ].includes(m) &&
                        !m.includes('whisper') &&
                        !m.includes('orpheus') &&
                        !m.includes('guard')
                    )
                    .map((m) => (
                      <option key={m} value={m}>
                        {m} (Discovered on Account)
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 opacity-80">Vision / Multimodal Model</label>
                <select
                  value={groqVisionModelInput}
                  onChange={(e) => setGroqVisionModelInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono text-xs focus:outline-none"
                >
                  <option value="qwen/qwen3.8-27b">
                    qwen/qwen3.8-27b (Recommended Qwen Multimodal)
                  </option>
                  <option value="meta-llama/llama-4-scout-17b-16e-instruct">
                    meta-llama/llama-4-scout-17b-16e-instruct (Llama 4 Scout Vision)
                  </option>
                  <option value="meta-llama/llama-4-maverick-17b-128e-instruct">
                    meta-llama/llama-4-maverick-17b-128e-instruct (High-Capacity Vision)
                  </option>
                  {discoveredModels
                    .filter(
                      (m) =>
                        (m.includes('scout') || m.includes('maverick') || m.includes('qwen') || m.includes('vision')) &&
                        ![
                          'qwen/qwen3.8-27b',
                          'meta-llama/llama-4-scout-17b-16e-instruct',
                          'meta-llama/llama-4-maverick-17b-128e-instruct',
                        ].includes(m)
                    )
                    .map((m) => (
                      <option key={m} value={m}>
                        {m} (Discovered on Account)
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Custom Provider URL and Model inputs */}
        {selectedProvider === 'custom' && (
          <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 mb-5 space-y-3">
            <div className="flex items-center gap-2 font-bold text-xs">
              <Server className="w-4 h-4 text-indigo-600" />
              <span>Custom Endpoint Settings (OpenAI-compatible)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1 opacity-80">Base URL</label>
                <input
                  type="text"
                  value={customBaseUrlInput}
                  onChange={(e) => setCustomBaseUrlInput(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1 or http://localhost:11434/v1"
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono text-xs focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1 opacity-80">Model Identifier</label>
                <input
                  type="text"
                  value={customModelInput}
                  onChange={(e) => setCustomModelInput(e.target.value)}
                  placeholder="e.g. meta-llama/llama-3.1-70b-instruct"
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono text-xs focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Input & Show/Hide Field */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="ai-api-key-input"
                className="block text-xs font-bold tracking-wide uppercase opacity-80"
              >
                {activeProviderConfig.name} API Key
              </label>
              <a
                href={activeProviderConfig.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-bold text-indigo-600 dark:text-yellow-400 hover:underline flex items-center gap-1"
              >
                <span>Get {activeProviderConfig.name} Key</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div
              className={`flex items-center rounded-2xl border transition-all ${
                highContrast
                  ? 'bg-zinc-950 border-yellow-400 focus-within:ring-2 focus-within:ring-yellow-400'
                  : 'bg-gray-50 border-gray-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent'
              }`}
            >
              <input
                id="ai-api-key-input"
                type={showKey ? 'text' : 'password'}
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder={
                  savedKeyMasked
                    ? `Active: ${savedKeyMasked} (enter new key to update)`
                    : `Paste your ${activeProviderConfig.name} API key (${activeProviderConfig.keyPrefixHint})`
                }
                autoComplete="off"
                spellCheck="false"
                className="flex-1 px-4 py-3 bg-transparent text-xs sm:text-sm font-mono focus:outline-none placeholder:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                className="p-3 text-gray-500 hover:text-gray-800 dark:text-yellow-400 transition"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Action Buttons: Save Key, Test Key, Remove Key */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleSaveKey}
              aria-label="Save API key"
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition shadow-sm min-h-[46px] cursor-pointer ${
                highContrast
                  ? 'bg-yellow-400 text-black hover:bg-yellow-300 font-extrabold'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>Save Key</span>
            </button>

            <button
              type="button"
              onClick={handleTestKey}
              disabled={isTesting}
              aria-label={`Test API key with ${activeProviderConfig.name}`}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition border min-h-[46px] cursor-pointer ${
                highContrast
                  ? 'bg-zinc-900 border-yellow-400 text-yellow-400 hover:bg-zinc-800'
                  : 'bg-white border-gray-300 text-gray-800 hover:bg-gray-50 shadow-sm'
              }`}
            >
              {isTesting ? (
                <span className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              )}
              <span>{isTesting ? 'Verifying...' : `Test Key`}</span>
            </button>

            {savedKeyMasked && (
              <button
                type="button"
                onClick={handleRemoveKey}
                aria-label="Remove saved API key"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 min-h-[46px] cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>Remove Key</span>
              </button>
            )}
          </div>

          {/* Test Key Result Banner */}
          {testStatus && (
            <div
              role="status"
              className={`p-3.5 rounded-2xl text-xs font-semibold flex items-center gap-2.5 border transition-all ${
                testStatus.ok
                  ? highContrast
                    ? 'bg-zinc-900 text-emerald-300 border-emerald-500'
                    : 'bg-emerald-50 text-emerald-900 border-emerald-300'
                  : highContrast
                  ? 'bg-zinc-900 text-red-300 border-red-500'
                  : 'bg-red-50 text-red-900 border-red-300'
              }`}
            >
              {testStatus.ok ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
              )}
              <span className="font-mono">{testStatus.message}</span>
            </div>
          )}

          {/* Active Model & Engine Info */}
          <div
            className={`p-3 rounded-2xl text-xs flex flex-wrap items-center justify-between gap-2 border transition-all ${
              highContrast
                ? 'bg-zinc-950 border-yellow-400/60 text-yellow-300'
                : 'bg-indigo-50/60 border-indigo-100 text-indigo-950'
            }`}
          >
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600 dark:text-yellow-400 shrink-0" />
              <span className="font-semibold">Active AI Engine:</span>
              <span className="font-bold text-indigo-700 dark:text-yellow-400">
                {activeProviderConfig.name}
              </span>
              <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-white/80 dark:bg-black/50 border border-indigo-200 dark:border-yellow-400/40">
                {selectedProvider === 'custom'
                  ? customModelInput
                  : selectedProvider === 'grok'
                  ? grokModelInput
                  : selectedProvider === 'groq'
                  ? groqModelInput
                  : activeProviderConfig.defaultModel}
              </span>
            </div>
            <div className="text-[11px] opacity-75">
              {activeProviderConfig.supportsVision ? 'Multimodal Vision Ready' : 'Text Reasoning Engine'}
            </div>
          </div>
        </div>
      </div>

      {/* Camera Test Feature for Webcams / Laptops */}
      <CameraTestSection />

      {/* Grid: Display & Contrast + Voice & Audio */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Visual Accessibility Options */}
        <div
          className={`rounded-[28px] p-6 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] transition-all border ${
            highContrast
              ? 'bg-black border-2 border-yellow-400 text-yellow-400'
              : 'bg-white border-gray-100 text-gray-900'
          }`}
        >
          <h3 className="font-extrabold text-base tracking-tight mb-4 flex items-center gap-2">
            <SunMoon className="w-5 h-5" />
            <span>Display & Contrast</span>
          </h3>

          <div className="space-y-4 text-xs">
            {/* High Contrast Mode */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-gray-50/80 dark:bg-zinc-900">
              <div>
                <strong className="block font-bold">High-Contrast Mode</strong>
                <span className="opacity-70">WCAG AAA yellow-on-black theme</span>
              </div>
              <input
                type="checkbox"
                checked={highContrast}
                onChange={(e) => setHighContrast(e.target.checked)}
                aria-label="High contrast mode toggle"
                className="w-5 h-5 accent-indigo-600 cursor-pointer"
              />
            </div>

            {/* Large Text Mode */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-gray-50/80 dark:bg-zinc-900">
              <div>
                <strong className="block font-bold flex items-center gap-1">
                  <Type className="w-4 h-4" />
                  <span>Large Text Mode (125% - 150%)</span>
                </strong>
                <span className="opacity-70">Enhances typographic legibility for low vision</span>
              </div>
              <input
                type="checkbox"
                checked={largeText}
                onChange={(e) => setLargeText(e.target.checked)}
                aria-label="Large text mode toggle"
                className="w-5 h-5 accent-indigo-600 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Speech Synthesis Voice Settings */}
        <div
          className={`rounded-[28px] p-6 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] transition-all border ${
            highContrast
              ? 'bg-black border-2 border-yellow-400 text-yellow-400'
              : 'bg-white border-gray-100 text-gray-900'
          }`}
        >
          <h3 className="font-extrabold text-base tracking-tight mb-4 flex items-center gap-2">
            <Volume2 className="w-5 h-5" />
            <span>Voice & Audio Output</span>
          </h3>

          <div className="space-y-4 text-xs">
            {/* Speech Rate Slider */}
            <div className="p-3.5 rounded-xl bg-gray-50/80 dark:bg-zinc-900 space-y-2">
              <div className="flex justify-between font-bold">
                <span className="flex items-center gap-1.5">
                  <Gauge className="w-4 h-4" />
                  <span>Speech Rate</span>
                </span>
                <span className="font-mono">{speechRate.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.75"
                max="1.5"
                step="0.05"
                value={speechRate}
                onChange={(e) => handleSpeechRateChange(parseFloat(e.target.value))}
                aria-label="Speech rate slider"
                className="w-full accent-indigo-600 cursor-pointer"
              />
            </div>

            {/* Speech Volume Slider */}
            <div className="p-3.5 rounded-xl bg-gray-50/80 dark:bg-zinc-900 space-y-2">
              <div className="flex justify-between font-bold">
                <span className="flex items-center gap-1.5">
                  <Volume2 className="w-4 h-4" />
                  <span>Speech Volume</span>
                </span>
                <span className="font-mono">{Math.round(speechVolume * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="1.0"
                step="0.05"
                value={speechVolume}
                onChange={(e) => handleSpeechVolumeChange(parseFloat(e.target.value))}
                aria-label="Speech volume slider"
                className="w-full accent-indigo-600 cursor-pointer"
              />
            </div>

            {/* Language Selector */}
            <div className="p-3.5 rounded-xl bg-gray-50/80 dark:bg-zinc-900 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Languages className="w-4 h-4" />
                <div>
                  <strong className="block font-bold">Assistant Language</strong>
                  <span className="opacity-70">English, Hindi, or Marathi</span>
                </div>
              </div>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                aria-label="Select assistant language"
                className="px-3 py-1.5 rounded-lg border border-gray-300 font-bold bg-white text-gray-900 dark:bg-zinc-800 dark:text-yellow-300"
              >
                <option value="en-US">English (US)</option>
                <option value="hi-IN">Hindi (India) - हिंदी</option>
                <option value="mr-IN">Marathi (India) - मराठी</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Google Maps Navigation Settings */}
      <div
        className={`rounded-[28px] p-6 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] transition-all border ${
          highContrast
            ? 'bg-black border-2 border-yellow-400 text-yellow-400'
            : 'bg-white border-gray-100 text-gray-900'
        }`}
      >
        <h3 className="font-extrabold text-base tracking-tight mb-4 flex items-center gap-2">
          <Navigation className="w-5 h-5 text-indigo-600 dark:text-yellow-400" />
          <span>Google Maps Navigation</span>
        </h3>

        <div className="space-y-4 text-xs">
          {/* Auto-start turn-by-turn Toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-gray-50/80 dark:bg-zinc-900">
            <div className="pr-4">
              <strong className="block font-bold">Auto-start turn-by-turn</strong>
              <span className="opacity-70">
                Directly launches active turn-by-turn navigation (&amp;dir_action=navigate). When off, Google Maps opens the route preview with Walk/Drive/Transit options. Default: Off.
              </span>
            </div>
            <input
              type="checkbox"
              checked={autoStartTurnByTurn}
              onChange={(e) => {
                setAutoStartTurnByTurn(e.target.checked);
                speechQueue.speak(
                  e.target.checked
                    ? 'Auto start turn-by-turn enabled'
                    : 'Auto start turn-by-turn disabled',
                  SpeechPriority.STATUS
                );
              }}
              aria-label="Auto-start turn-by-turn navigation toggle"
              className="w-5 h-5 accent-indigo-600 cursor-pointer shrink-0"
            />
          </div>
        </div>
      </div>

      {/* Diagnostics & Maintenance */}
      <div
        className={`rounded-[28px] p-6 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] transition-all border ${
          highContrast
            ? 'bg-black border-2 border-yellow-400 text-yellow-400'
            : 'bg-white border-gray-100 text-gray-900'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="font-extrabold text-base tracking-tight flex items-center gap-2">
            <Bug className="w-5 h-5 text-indigo-600 dark:text-yellow-400" />
            <span>Diagnostics & Maintenance</span>
          </h3>

          {/* Small "Run Self-Test" Button */}
          <button
            onClick={() => {
              useAppStore.getState().setSelfTestOpen(true);
              speechQueue.speak('Starting system self test', SpeechPriority.STATUS);
            }}
            aria-label="Run system self-test"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl font-bold text-xs transition-all shadow-sm cursor-pointer ${
              highContrast
                ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20'
            }`}
          >
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Run Self-Test</span>
          </button>
        </div>

        {/* 11-Point System Self-Test Row */}
        <div className="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-gray-100 dark:border-zinc-800">
          <div>
            <strong className="text-xs block font-bold">11-Point System Self-Test</strong>
            <span className="text-[11px] opacity-70">
              Verify microphone, speech recognition, TTS, GPS, camera, OCR, command parsing, and AI.
            </span>
          </div>

          <button
            onClick={() => {
              useAppStore.getState().setSelfTestOpen(true);
              speechQueue.speak('Starting system self test', SpeechPriority.STATUS);
            }}
            aria-label="Run self-test"
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-black text-xs transition-all cursor-pointer ${
              highContrast
                ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-zinc-800 dark:text-yellow-400'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Launch Check</span>
          </button>
        </div>

        {/* Walking Stride Length Setting for Step Counting */}
        <div className="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-gray-100 dark:border-zinc-800">
          <div>
            <strong className="text-xs block font-bold">Walking Stride Length</strong>
            <span className="text-[11px] opacity-70">
              Adjustable stride for step counting fallback when GPS is weak (default: 0.70 m).
            </span>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0.4"
              max="1.2"
              step="0.05"
              value={strideLength}
              onChange={(e) => setStrideLength(parseFloat(e.target.value))}
              aria-label="Adjust walking stride length in meters"
              className="w-28 sm:w-36 accent-indigo-600 cursor-pointer"
            />
            <span className="text-xs font-mono font-bold w-14 text-right">
              {strideLength.toFixed(2)} m
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <div>
            <strong className="text-xs block font-bold">Reset Today&apos;s Statistics</strong>
            <span className="text-[11px] opacity-70">
              Clear objects count, distance walked, and commands used for today.
            </span>
          </div>

          <button
            onClick={handleResetStats}
            aria-label="Reset today's stats"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 text-gray-800 font-bold text-xs hover:bg-gray-200 transition min-h-[46px] cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Reset Today&apos;s Stats</span>
          </button>
        </div>

        {/* Voice Debug Panel Toggle */}
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-between">
          <div>
            <strong className="text-xs block font-bold">Voice Debug Panel</strong>
            <span className="text-[11px] opacity-70">
              Inspect duration, mimeType, raw transcript, full AI JSON, intent & latency.
            </span>
          </div>
          <input
            type="checkbox"
            checked={voiceDebugPanel}
            onChange={(e) => setVoiceDebugPanel(e.target.checked)}
            aria-label="Toggle voice debug panel"
            className="w-5 h-5 accent-indigo-600 cursor-pointer"
          />
        </div>

        {/* On-Screen Voice Debug Panel */}
        {voiceDebugPanel && (
          <div className="mt-4 p-4 rounded-2xl bg-zinc-950 text-emerald-400 font-mono text-[11px] border border-emerald-500/30 space-y-3">
            <div className="font-bold text-white border-b border-emerald-500/20 pb-1">
              Active Utterance Telemetry Log ({voiceDebugLogs.length} events logged)
            </div>

            {voiceDebugLogs.length === 0 ? (
              <p className="text-zinc-500">No utterances logged yet. Speak into the microphone.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {voiceDebugLogs.map((log, index) => (
                  <div
                    key={index}
                    className="p-2.5 rounded-xl bg-black/60 border border-emerald-500/20 space-y-1"
                  >
                    <div className="text-sky-400 font-bold">
                      [{new Date(log.timestamp).toLocaleTimeString()}] Clip:{' '}
                      {Math.round(log.durationMs)}ms · {log.mimeType} · Latency: {log.latencyMs}ms
                    </div>
                    <div>
                      <span className="text-gray-400">Transcript:</span> &ldquo;{log.transcript}&rdquo;
                    </div>
                    <div>
                      <span className="text-gray-400">Intent:</span>{' '}
                      <strong className="text-amber-400">{log.intent}</strong>
                    </div>
                    <div>
                      <span className="text-gray-400">Spoken Reply:</span> {log.reply}
                    </div>
                    {log.rawJson && (
                      <details className="mt-1 text-[10px] text-zinc-400 cursor-pointer">
                        <summary className="hover:text-emerald-300">View Full JSON Payload</summary>
                        <pre className="p-2 bg-zinc-900 rounded overflow-x-auto text-emerald-300 mt-1">
                          {JSON.stringify(log.rawJson, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
