/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Mic, Volume2, AlertCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { speechQueue, SpeechPriority } from '../services/speechQueue';

interface VoiceGestureOverlayProps {
  needsUserGesture: boolean;
  onRequestPermissionAndStart: () => void;
}

export const VoiceGestureOverlay: React.FC<VoiceGestureOverlayProps> = ({
  needsUserGesture,
  onRequestPermissionAndStart,
}) => {
  const micStatus = useAppStore((s) => s.micStatus);
  const highContrast = useAppStore((s) => s.highContrast);
  const lastErrorDebug = useAppStore((s) => s.lastErrorDebug);

  const [inIframe, setInIframe] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.self !== window.top) {
        setInIframe(true);
      }
    } catch (_) {
      setInIframe(true);
    }
  }, []);

  const isErrorState = micStatus === 'error';

  // Full-screen overlay on initial load if user gesture is required
  if (needsUserGesture && !isErrorState) {
    return (
      <div
        role="dialog"
        aria-label="Start Voice Control Overlay"
        aria-modal="true"
        onClick={onRequestPermissionAndStart}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onRequestPermissionAndStart();
          }
        }}
        tabIndex={0}
        className={`fixed inset-0 z-50 flex flex-col items-center justify-center p-6 text-center cursor-pointer select-none transition-all ${
          highContrast
            ? 'bg-black text-yellow-400 border-8 border-yellow-400'
            : 'bg-indigo-950/95 text-white backdrop-blur-md'
        }`}
      >
        <div className="max-w-lg space-y-6 flex flex-col items-center animate-fade-in">
          <div
            className={`w-28 h-28 rounded-full flex items-center justify-center animate-bounce ${
              highContrast ? 'bg-yellow-400 text-black' : 'bg-indigo-600 text-white shadow-2xl shadow-indigo-500/50'
            }`}
          >
            <Mic className="w-14 h-14" />
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight">
              Tap Anywhere to Start
            </h1>
            <p className="text-lg sm:text-xl font-bold opacity-90">
              Voice-controlled assistive vision for blind & visually impaired users
            </p>
          </div>

          <p className="text-sm font-semibold opacity-75 max-w-sm">
            Browsers require a single screen tap to grant microphone access and enable hands-free voice commands.
          </p>

          <div
            className={`px-8 py-4 rounded-2xl font-black text-lg sm:text-xl shadow-xl flex items-center gap-3 transition-transform hover:scale-105 active:scale-95 ${
              highContrast
                ? 'bg-yellow-400 text-black border-2 border-white'
                : 'bg-white text-indigo-950'
            }`}
          >
            <Volume2 className="w-6 h-6 shrink-0" />
            <span>Tap the Screen to Enable Voice</span>
          </div>
        </div>
      </div>
    );
  }

  // Recovery UI if micStatus === 'error' (Microphone access actually failed)
  if (isErrorState) {
    if (inIframe) {
      // Smart iframe failure recovery: clear warning, large "Open in new tab" button, and retry inside iframe
      return (
        <div
          role="alertdialog"
          aria-label="Microphone Restricted in Preview"
          className="fixed inset-x-4 bottom-20 z-50 sm:bottom-6 sm:left-auto sm:right-6 sm:max-w-md animate-fade-in"
        >
          <div
            className={`p-5 rounded-3xl border-4 shadow-2xl flex flex-col gap-4 transition-all ${
              highContrast
                ? 'bg-black text-yellow-400 border-yellow-400'
                : 'bg-indigo-950 text-white border-amber-400 shadow-indigo-950/80'
            }`}
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-7 h-7 shrink-0 text-amber-400 mt-0.5" />
              <div className="flex-1 text-xs sm:text-sm space-y-1">
                <p className="font-extrabold text-base leading-tight">
                  Voice Control Restricted in Preview Mode
                </p>
                <p className="opacity-90 leading-snug">
                  The embedded preview iframe restricted microphone access. Open in a full browser tab for uninterrupted voice control.
                </p>
                {lastErrorDebug && (
                  <p className="font-mono text-[11px] opacity-70 break-words mt-1">
                    DEBUG: {lastErrorDebug}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2.5 pt-1">
              {/* Large "Open in new tab" button */}
              <button
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.open(window.location.href, '_blank');
                  }
                }}
                aria-label="Open in new tab"
                className={`w-full py-4 px-6 rounded-2xl font-black text-base sm:text-lg flex items-center justify-center gap-3 transition-transform active:scale-95 cursor-pointer shadow-xl ${
                  highContrast
                    ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                    : 'bg-amber-400 hover:bg-amber-300 text-black'
                }`}
              >
                <ExternalLink className="w-5 h-5 shrink-0" />
                <span>Open in New Tab</span>
              </button>

              {/* Do not block: keep trying in the iframe */}
              <button
                onClick={onRequestPermissionAndStart}
                aria-label="Keep trying to use microphone in this tab"
                className={`w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-transform active:scale-95 cursor-pointer border ${
                  highContrast
                    ? 'bg-zinc-900 text-yellow-400 border-yellow-400 hover:bg-zinc-800'
                    : 'bg-white/10 hover:bg-white/20 text-white border-white/20'
                }`}
              >
                <RefreshCw className="w-4 h-4 shrink-0" />
                <span>Keep Trying in This Tab</span>
              </button>

              <button
                onClick={() => useAppStore.getState().setMicStatus('paused')}
                className="text-[11px] text-center opacity-70 hover:opacity-100 underline cursor-pointer pt-0.5"
              >
                Dismiss & use touch controls
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Standard recovery button when not in an iframe
    return (
      <div className="fixed bottom-20 left-4 right-4 z-40 sm:bottom-6 sm:left-auto sm:right-6 sm:max-w-md">
        <div
          className={`p-4 rounded-3xl border-4 shadow-2xl flex flex-col gap-3 transition-all animate-bounce ${
            highContrast
              ? 'bg-black text-yellow-400 border-yellow-400'
              : 'bg-red-950 text-white border-red-500 shadow-red-950/50'
          }`}
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 shrink-0 text-amber-400 mt-0.5" />
            <div className="flex-1 text-xs sm:text-sm">
              <p className="font-extrabold text-base">Voice Recognition Paused</p>
              <p className="opacity-80">
                {lastErrorDebug ? `DEBUG: ${lastErrorDebug}` : 'Tap the button below to restart microphone access.'}
              </p>
            </div>
          </div>

          <button
            onClick={onRequestPermissionAndStart}
            aria-label="Tap to enable voice"
            className={`w-full py-4 px-6 rounded-2xl font-black text-base sm:text-lg flex items-center justify-center gap-3 transition-transform active:scale-95 cursor-pointer shadow-lg ${
              highContrast
                ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                : 'bg-amber-400 hover:bg-amber-300 text-black'
            }`}
          >
            <RefreshCw className="w-5 h-5 shrink-0" />
            <span>Tap to Enable Voice</span>
          </button>
        </div>
      </div>
    );
  }

  // When mic is functioning or not in error, do not show any warning or banner
  return null;
};
