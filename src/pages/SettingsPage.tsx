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
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useStatsStore } from '../store/statsStore';
import { speechQueue, SpeechPriority } from '../services/speechQueue';
import {
  GEMINI_STORAGE_KEY,
  GEMINI_DEFAULT_MODEL,
  GEMINI_FALLBACK_MODEL,
  getApiKey,
  maskApiKey,
  testApiKey,
} from '../services/apiKey';
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

  const resetTodayStats = useStatsStore((s) => s.resetTodayStats);
  const strideLength = useStatsStore((s) => s.strideLength);
  const setStrideLength = useStatsStore((s) => s.setStrideLength);

  // Gemini API Key State
  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savedKeyMasked, setSavedKeyMasked] = useState<string>('');
  const [hasLocalStorageKey, setHasLocalStorageKey] = useState<boolean>(false);
  const [testStatus, setTestStatus] = useState<{
    tested: boolean;
    ok: boolean;
    message: string;
  } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Load current saved key on mount
  useEffect(() => {
    refreshKeyStatus();
  }, []);

  const refreshKeyStatus = () => {
    try {
      const stored = localStorage.getItem(GEMINI_STORAGE_KEY);
      if (stored && stored.trim()) {
        setSavedKeyMasked(maskApiKey(stored));
        setHasLocalStorageKey(true);
      } else {
        const fallback = getApiKey();
        if (fallback) {
          setSavedKeyMasked(maskApiKey(fallback));
          setHasLocalStorageKey(false);
        } else {
          setSavedKeyMasked('');
          setHasLocalStorageKey(false);
        }
      }
    } catch (_) {
      setSavedKeyMasked('');
      setHasLocalStorageKey(false);
    }
  };

  const handleSaveKey = () => {
    const keyToSave = inputKey.trim();
    if (!keyToSave) {
      speechQueue.speak('Please enter a key before saving.', SpeechPriority.STATUS);
      return;
    }

    try {
      localStorage.setItem(GEMINI_STORAGE_KEY, keyToSave);
      setInputKey('');
      setShowKey(false);
      refreshKeyStatus();
      setTestStatus(null);
      setKeyMissingAlert(false);
      setLastErrorDebug(null);

      const successNotice = 'API key saved successfully.';
      speechQueue.speak(successNotice, SpeechPriority.STATUS);
    } catch (err: any) {
      speechQueue.speak('Failed to save API key to local storage.', SpeechPriority.STATUS);
    }
  };

  const handleRemoveKey = () => {
    try {
      localStorage.removeItem(GEMINI_STORAGE_KEY);
      setInputKey('');
      setShowKey(false);
      setTestStatus(null);
      refreshKeyStatus();

      const notice = 'API key removed.';
      speechQueue.speak(notice, SpeechPriority.STATUS);
    } catch (_) {}
  };

  const handleTestKey = async () => {
    // Test the input key if typed, otherwise test the saved key
    const keyToTest = inputKey.trim() || getApiKey();

    if (!keyToTest) {
      setTestStatus({
        tested: true,
        ok: false,
        message: 'No key to test. Please enter or save an API key first.',
      });
      speechQueue.speak('No key to test. Please enter a key.', SpeechPriority.STATUS);
      return;
    }

    setIsTesting(true);
    setTestStatus(null);
    speechQueue.speak('Testing API key with Gemini...', SpeechPriority.STATUS);

    try {
      const res = await testApiKey(keyToTest);
      setTestStatus({
        tested: true,
        ok: res.ok,
        message: res.message,
      });

      if (res.ok) {
        speechQueue.speak('Key works.', SpeechPriority.STATUS);
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

  return (
    <div className="space-y-6 max-w-4xl pb-12">
      <div>
        <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">
          Accessibility & System Settings
        </h2>
        <p className="text-xs sm:text-sm font-semibold opacity-70">
          Configure Gemini AI credentials, speech synthesis, display contrast, and diagnostics.
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
      {/* FEATURE 1: GEMINI API KEY SECTION */}
      {/* ========================================================================= */}
      <div
        className={`rounded-[28px] p-6 transition-all shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] border ${
          highContrast
            ? 'bg-black border-2 border-yellow-400 text-yellow-400'
            : 'bg-white border-gray-200/80 text-gray-900'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
                highContrast
                  ? 'bg-yellow-400 text-black font-extrabold'
                  : 'bg-indigo-600 text-white shadow-md'
              }`}
            >
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base tracking-tight">Gemini API Key</h3>
              <p className="text-xs opacity-70">
                Required for scene descriptions, visual text reading, and general questions.
              </p>
            </div>
          </div>

          {/* Current Saved Key Masked Badge */}
          {savedKeyMasked ? (
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono font-bold ${
                highContrast
                  ? 'bg-zinc-900 text-yellow-300 border border-yellow-400'
                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                {hasLocalStorageKey ? 'Saved Key: ' : 'Env Key: '}
                {savedKeyMasked}
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
              <span>No API key saved in Settings</span>
            </div>
          )}
        </div>

        {/* Input & Show/Hide Field */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="gemini-api-key-input"
              className="block text-xs font-bold tracking-wide uppercase opacity-80"
            >
              Enter API Key
            </label>
            <div
              className={`flex items-center rounded-2xl border transition-all ${
                highContrast
                  ? 'bg-zinc-950 border-yellow-400 focus-within:ring-2 focus-within:ring-yellow-400'
                  : 'bg-gray-50 border-gray-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent'
              }`}
            >
              <input
                id="gemini-api-key-input"
                type={showKey ? 'text' : 'password'}
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder={
                  savedKeyMasked
                    ? `Currently active: ${savedKeyMasked} (enter new key to replace)`
                    : 'Paste your Gemini API key (e.g. AIzaSy...)'
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
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition shadow-sm min-h-[46px] ${
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
              aria-label="Test API key with Gemini"
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition border min-h-[46px] ${
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
              <span>{isTesting ? 'Testing...' : 'Test Key'}</span>
            </button>

            {hasLocalStorageKey && (
              <button
                type="button"
                onClick={handleRemoveKey}
                aria-label="Remove saved API key"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 min-h-[46px]"
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

          {/* Active Model & Fallback Info */}
          <div
            className={`p-3 rounded-2xl text-xs flex flex-wrap items-center justify-between gap-2 border transition-all ${
              highContrast
                ? 'bg-zinc-950 border-yellow-400/60 text-yellow-300'
                : 'bg-indigo-50/60 border-indigo-100 text-indigo-950'
            }`}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600 dark:text-yellow-400 shrink-0" />
              <span className="font-semibold">Gemini Model:</span>
              <span className="font-mono font-bold px-2 py-0.5 rounded-md bg-white/80 dark:bg-black/50 border border-indigo-200 dark:border-yellow-400/40">
                {GEMINI_DEFAULT_MODEL}
              </span>
            </div>
            <div className="text-[11px] opacity-75 font-mono">
              Auto-fallback: {GEMINI_FALLBACK_MODEL}
            </div>
          </div>

          {/* Help text */}
          <div className="pt-2 text-xs flex items-center gap-1.5 opacity-80">
            <span>Get a free key at</span>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-bold text-indigo-600 dark:text-yellow-400 hover:underline"
            >
              <span>aistudio.google.com/apikey</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
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

      {/* Reset Stats & Developer Tools */}
      <div
        className={`rounded-[28px] p-6 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] transition-all border ${
          highContrast
            ? 'bg-black border-2 border-yellow-400 text-yellow-400'
            : 'bg-white border-gray-100 text-gray-900'
        }`}
      >
        <h3 className="font-extrabold text-base tracking-tight mb-4 flex items-center gap-2">
          <Bug className="w-5 h-5 text-indigo-600" />
          <span>Diagnostics & Maintenance</span>
        </h3>

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
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 text-gray-800 font-bold text-xs hover:bg-gray-200 transition min-h-[46px]"
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
              Inspect duration, mimeType, raw transcript, full Gemini JSON, intent & latency.
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
