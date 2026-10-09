/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { EyeOff, NavigationOff, MicOff, AlertTriangle, Mic } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { handleEmergencySos } from '../services/intentRouter';

interface BackupControlButtonsProps {
  onStopMic: () => void;
  onStartMic: () => void;
  onStopDetection: () => void;
}

export const BackupControlButtons: React.FC<BackupControlButtonsProps> = ({
  onStopMic,
  onStartMic,
  onStopDetection,
}) => {
  const micStatus = useAppStore((s) => s.micStatus);
  const detectionActive = useAppStore((s) => s.detectionActive);
  const navigationActive = useAppStore((s) => s.navigationActive);
  const stopNavigation = useAppStore((s) => s.stopNavigation);
  const highContrast = useAppStore((s) => s.highContrast);

  const isListening = micStatus === 'listening';

  return (
    <div
      aria-label="High priority accessibility controls"
      className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-4"
    >
      {/* 1. Mic Toggle / Stop Listening Button */}
      {isListening ? (
        <button
          onClick={onStopMic}
          aria-label="Stop listening microphone"
          className={`flex items-center justify-center gap-2 p-4 rounded-2xl font-extrabold text-sm shadow-md transition-all min-h-[56px] ${
            highContrast
              ? 'bg-zinc-900 border-2 border-yellow-400 text-yellow-400 hover:bg-zinc-800'
              : 'bg-gray-800 text-white hover:bg-black'
          }`}
        >
          <MicOff className="w-5 h-5" />
          <span>Stop Listening</span>
        </button>
      ) : (
        <button
          onClick={onStartMic}
          aria-label="Start microphone listening"
          className={`flex items-center justify-center gap-2 p-4 rounded-2xl font-extrabold text-sm shadow-md transition-all min-h-[56px] ${
            highContrast
              ? 'bg-yellow-400 text-black hover:bg-yellow-300'
              : 'bg-emerald-600 text-white hover:bg-emerald-700'
          }`}
        >
          <Mic className="w-5 h-5" />
          <span>Start Listening</span>
        </button>
      )}

      {/* 2. Stop Detection Button */}
      <button
        onClick={onStopDetection}
        disabled={!detectionActive}
        aria-label="Stop obstacle detection"
        className={`flex items-center justify-center gap-2 p-4 rounded-2xl font-extrabold text-sm shadow-md transition-all min-h-[56px] ${
          !detectionActive
            ? 'opacity-40 cursor-not-allowed bg-gray-200 text-gray-500'
            : highContrast
            ? 'bg-zinc-900 border-2 border-yellow-400 text-yellow-400'
            : 'bg-gray-900 text-white hover:bg-black'
        }`}
      >
        <EyeOff className="w-5 h-5" />
        <span>Stop Vision</span>
      </button>

      {/* 3. Stop Navigation Button */}
      <button
        onClick={stopNavigation}
        disabled={!navigationActive}
        aria-label="Stop pedestrian navigation"
        className={`flex items-center justify-center gap-2 p-4 rounded-2xl font-extrabold text-sm shadow-md transition-all min-h-[56px] ${
          !navigationActive
            ? 'opacity-40 cursor-not-allowed bg-gray-200 text-gray-500'
            : highContrast
            ? 'bg-zinc-900 border-2 border-yellow-400 text-yellow-400'
            : 'bg-gray-900 text-white hover:bg-black'
        }`}
      >
        <NavigationOff className="w-5 h-5" />
        <span>Stop Navigation</span>
      </button>

      {/* 4. Large Emergency SOS Button */}
      <button
        onClick={handleEmergencySos}
        aria-label="Trigger emergency SOS location sharing"
        className="flex items-center justify-center gap-2 p-4 rounded-2xl font-extrabold text-sm bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-600/30 transition-all min-h-[56px]"
      >
        <AlertTriangle className="w-5 h-5 animate-pulse" />
        <span>EMERGENCY SOS</span>
      </button>
    </div>
  );
};
