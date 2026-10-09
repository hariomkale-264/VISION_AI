/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Mic, MicOff, Volume2, Loader2, Sparkles } from 'lucide-react';
import { useAppStore } from '../store/appStore';

interface VoiceAssistantCardProps {
  onStartMic: () => void;
  onStopMic: () => void;
}

export const VoiceAssistantCard: React.FC<VoiceAssistantCardProps> = ({
  onStartMic,
  onStopMic,
}) => {
  const micStatus = useAppStore((s) => s.micStatus);
  const micLevel = useAppStore((s) => s.micLevel);
  const isProcessingAudio = useAppStore((s) => s.isProcessingAudio);
  const isSpeaking = useAppStore((s) => s.isSpeaking);
  const lastTranscript = useAppStore((s) => s.lastTranscript);
  const lastIntent = useAppStore((s) => s.lastIntent);
  const lastReply = useAppStore((s) => s.lastReply);
  const highContrast = useAppStore((s) => s.highContrast);

  const isListening = micStatus === 'listening';

  return (
    <div
      className={`rounded-[24px] p-5 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05),0_8px_10px_-6px_rgba(0,0,0,0.01)] transition-all ${
        highContrast
          ? 'bg-black border-2 border-yellow-400 text-yellow-400'
          : 'bg-white border border-gray-100 text-gray-900'
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
              highContrast ? 'bg-yellow-400 text-black' : 'bg-[#14141C] text-white shadow-sm'
            }`}
          >
            <Mic className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <h3 className="font-extrabold text-base tracking-tight">Voice Assistant (Gemini)</h3>
            <p className="text-xs font-semibold opacity-70">
              {isListening
                ? isSpeaking
                  ? 'Speaking response (mic muted)'
                  : isProcessingAudio
                  ? 'Transcribing & reasoning...'
                  : 'Always-on listening active'
                : 'Microphone is currently paused'}
            </p>
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2 text-xs font-bold">
          {isProcessingAudio ? (
            <span className="flex items-center gap-1.5 text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Analyzing</span>
            </span>
          ) : isSpeaking ? (
            <span className="flex items-center gap-1.5 text-sky-600 bg-sky-50 px-3 py-1.5 rounded-full">
              <Volume2 className="w-3.5 h-3.5 animate-pulse" />
              <span>Speaking</span>
            </span>
          ) : isListening ? (
            <span className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span>Listening</span>
            </span>
          ) : (
            <span className="text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">
              Paused
            </span>
          )}
        </div>
      </div>

      {/* Dynamic Animated Audio Waveform & Level Meter */}
      <div
        className={`w-full py-6 px-4 rounded-2xl flex flex-col items-center justify-center gap-3 transition-colors ${
          highContrast ? 'bg-zinc-900 border border-yellow-400/40' : 'bg-[#14141C] text-white shadow-inner'
        }`}
      >
        {/* Animated Bar Visualizer */}
        <div className="flex items-center justify-center gap-1.5 h-12 w-full max-w-xs">
          {[0.2, 0.45, 0.8, 1.0, 0.65, 0.9, 0.35, 0.7, 0.5, 0.25].map((mult, idx) => {
            const barHeight = isListening && !isSpeaking
              ? Math.max(8, Math.min(48, Math.round(micLevel * 50 * mult + Math.random() * 6)))
              : 6;

            return (
              <div
                key={idx}
                style={{ height: `${barHeight}px` }}
                className={`w-2.5 rounded-full transition-all duration-75 ${
                  highContrast
                    ? 'bg-yellow-400'
                    : isListening
                    ? micLevel > 0.1
                      ? 'bg-sky-400'
                      : 'bg-indigo-500/60'
                    : 'bg-gray-700'
                }`}
              />
            );
          })}
        </div>

        {/* Live level meter bar */}
        <div className="w-full max-w-xs bg-gray-800 rounded-full h-1.5 overflow-hidden">
          <div
            style={{ width: `${Math.round(micLevel * 100)}%` }}
            className={`h-full transition-all duration-75 ${
              highContrast ? 'bg-yellow-400' : 'bg-gradient-to-r from-sky-400 to-indigo-500'
            }`}
          />
        </div>
        <span className="text-[10px] font-mono opacity-60">
          VAD Level: {Math.round(micLevel * 100)}% · 300ms pre-roll · 1.2s silence close
        </span>
      </div>

      {/* Live Transcript & Reply Panel */}
      <div className="mt-4 space-y-2.5">
        <div
          className={`p-3.5 rounded-2xl border text-xs leading-relaxed transition-colors ${
            highContrast ? 'bg-zinc-900 border-yellow-400 text-yellow-300' : 'bg-gray-50 border-gray-100'
          }`}
        >
          <div className="font-bold opacity-60 uppercase text-[10px] tracking-wider mb-1">
            Last Spoken Utterance
          </div>
          <p className="font-semibold text-sm">
            {lastTranscript ? `“${lastTranscript}”` : 'Waiting for speech...'}
          </p>
        </div>

        {lastIntent && (
          <div className="flex items-center gap-2 text-xs font-semibold px-1">
            <span className="opacity-60">Recognized Intent:</span>
            <span className="px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-bold">
              {lastIntent}
            </span>
          </div>
        )}

        {lastReply && (
          <div
            className={`p-3.5 rounded-2xl border text-xs leading-relaxed transition-colors ${
              highContrast
                ? 'bg-zinc-900 border-yellow-400 text-yellow-300'
                : 'bg-emerald-50/70 border-emerald-100 text-emerald-950'
            }`}
          >
            <div className="font-bold flex items-center gap-1.5 mb-1 text-emerald-700">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Assistant Spoken Reply</span>
            </div>
            <p className="font-medium text-sm">{lastReply}</p>
          </div>
        )}
      </div>

      {/* Mic Controls (Minimum 56px touch target backup buttons) */}
      <div className="mt-5 pt-3 border-t border-gray-100 flex items-center gap-3">
        {isListening ? (
          <button
            onClick={onStopMic}
            aria-label="Stop listening"
            className="flex-1 py-3.5 px-4 rounded-xl bg-gray-900 text-white font-extrabold text-xs hover:bg-black transition shadow min-h-[56px] flex items-center justify-center gap-2"
          >
            <MicOff className="w-4 h-4" />
            <span>Stop Listening</span>
          </button>
        ) : (
          <button
            onClick={onStartMic}
            aria-label="Start listening"
            className="flex-1 py-3.5 px-4 rounded-xl bg-emerald-600 text-white font-extrabold text-xs hover:bg-emerald-700 transition shadow min-h-[56px] flex items-center justify-center gap-2"
          >
            <Mic className="w-4 h-4" />
            <span>Start Listening</span>
          </button>
        )}
      </div>
    </div>
  );
};
