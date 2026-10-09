/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Mic, MessageSquare, HelpCircle } from 'lucide-react';
import { VoiceAssistantCard } from '../components/VoiceAssistantCard';
import { useAppStore } from '../store/appStore';

interface VoicePageProps {
  onStartMic: () => void;
  onStopMic: () => void;
}

export const VoicePage: React.FC<VoicePageProps> = ({ onStartMic, onStopMic }) => {
  const conversationHistory = useAppStore((s) => s.conversationHistory);
  const highContrast = useAppStore((s) => s.highContrast);

  const sampleCommands = [
    { cmd: 'Open Settings / Dashboard / Navigation / Detection', desc: 'Switches tabs instantly offline (EN/HI/MR)' },
    { cmd: 'Start detection', desc: 'Activates camera and real-time obstacle scan' },
    { cmd: 'Stop detection', desc: 'Turns off camera immediately and clears boxes' },
    { cmd: 'Describe scene / What is in front of me?', desc: 'Analyzes hazards, stairs, walls, poles, and ground' },
    { cmd: 'Read text / Read this', desc: 'Reads all printed or sign text aloud (OCR)' },
    { cmd: 'Navigate me to [Place]', desc: 'Computes walking route with turn-by-turn speech' },
    { cmd: 'Where am I?', desc: 'Reverse geocodes current street or landmark' },
    { cmd: 'Emergency / SOS / Help me', desc: 'Triggers instant SOS with GPS link' },
    { cmd: 'What time is it? / What is the date?', desc: 'Answers real-time clock and calendar' },
    { cmd: 'Battery level', desc: 'Checks device battery status locally' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight">Always-On Voice Assistant</h2>
        <p className="text-xs font-semibold opacity-70">
          Powered by Gemini for conversational intent understanding in English, Hindi, and Marathi.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <VoiceAssistantCard onStartMic={onStartMic} onStopMic={onStopMic} />

        {/* Available Spoken Commands Reference */}
        <div
          className={`rounded-[24px] p-5 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] transition-all ${
            highContrast
              ? 'bg-black border-2 border-yellow-400 text-yellow-400'
              : 'bg-white border border-gray-100 text-gray-900'
          }`}
        >
          <div className="flex items-center gap-2 mb-3">
            <HelpCircle className="w-5 h-5 text-indigo-600" />
            <h3 className="font-extrabold text-base tracking-tight">Available Commands</h3>
          </div>
          <p className="text-xs opacity-70 mb-4">
            Natural phrasing is fully supported. Speak naturally without memorizing exact keywords.
          </p>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1 text-xs">
            {sampleCommands.map((item, idx) => (
              <div
                key={idx}
                className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 ${
                  highContrast
                    ? 'bg-zinc-900 border-yellow-400/40 text-yellow-300'
                    : 'bg-gray-50 border-gray-100'
                }`}
              >
                <strong className="text-indigo-600 font-bold">&ldquo;{item.cmd}&rdquo;</strong>
                <span className="opacity-70 text-right">{item.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Conversation Turns History */}
      <div
        className={`rounded-[24px] p-5 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] transition-all ${
          highContrast
            ? 'bg-black border-2 border-yellow-400 text-yellow-400'
            : 'bg-white border border-gray-100 text-gray-900'
        }`}
      >
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="w-5 h-5 text-sky-500" />
          <h3 className="font-extrabold text-base tracking-tight">Recent Conversation Turns</h3>
        </div>

        {conversationHistory.length === 0 ? (
          <p className="text-xs opacity-60 py-6 text-center">No conversation history yet. Start speaking!</p>
        ) : (
          <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1 text-xs">
            {conversationHistory.map((turn, i) => (
              <div
                key={i}
                className={`p-3 rounded-2xl flex items-start gap-2.5 ${
                  turn.role === 'user'
                    ? 'bg-indigo-50/80 border border-indigo-100 text-indigo-950 ml-6'
                    : 'bg-gray-50 border border-gray-200 text-gray-900 mr-6'
                }`}
              >
                <span className="font-bold uppercase text-[10px] opacity-60 shrink-0 mt-0.5">
                  {turn.role === 'user' ? 'You:' : 'AI:'}
                </span>
                <p className="font-medium leading-relaxed">{turn.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
