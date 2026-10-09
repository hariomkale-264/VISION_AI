/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Mic,
  Eye,
  Navigation,
  MessageSquare,
  Clock,
  Battery,
  BatteryCharging,
  Wifi,
  WifiOff,
  MapPin,
  AlertTriangle,
  Key,
  X,
  ArrowRight,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useStatsStore } from '../store/statsStore';

export const LiveStatusStrip: React.FC = () => {
  const micStatus = useAppStore((s) => s.micStatus);
  const detectionActive = useAppStore((s) => s.detectionActive);
  const navigationActive = useAppStore((s) => s.navigationActive);
  const destination = useAppStore((s) => s.destination);
  const lastTranscript = useAppStore((s) => s.lastTranscript);
  const highContrast = useAppStore((s) => s.highContrast);
  const currentLocation = useAppStore((s) => s.currentLocation);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  const currentTimeString = useAppStore((s) => s.currentTimeString);
  const currentDateString = useAppStore((s) => s.currentDateString);
  const batteryLevel = useAppStore((s) => s.batteryLevel);
  const isCharging = useAppStore((s) => s.isCharging);
  const isOnline = useAppStore((s) => s.isOnline);
  const lastErrorDebug = useAppStore((s) => s.lastErrorDebug);
  const setLastErrorDebug = useAppStore((s) => s.setLastErrorDebug);
  const keyMissingAlert = useAppStore((s) => s.keyMissingAlert);
  const setKeyMissingAlert = useAppStore((s) => s.setKeyMissingAlert);

  const liveDetections = useStatsStore((s) => s.liveDetections);

  // Format latest detected objects summary
  const latestObjectsSummary =
    liveDetections.length > 0
      ? liveDetections
          .slice(0, 2)
          .map((d) => `${d.className} (${d.distanceLabel})`)
          .join(', ')
      : 'None';

  const isKeyMissing =
    keyMissingAlert ||
    (lastErrorDebug && lastErrorDebug.includes('Gemini API key is missing'));

  const handleGoToSettings = () => {
    setActiveTab('settings');
    setKeyMissingAlert(false);
  };

  return (
    <div className="flex flex-col border-b transition-colors">
      {/* 1. Missing API Key Alert Banner with Jump to Settings Button */}
      {isKeyMissing && (
        <div
          role="alert"
          className={`px-4 py-2 text-xs font-semibold flex items-center justify-between gap-3 border-b transition-all ${
            highContrast
              ? 'bg-yellow-400 text-black border-black font-extrabold'
              : 'bg-amber-500 text-white border-amber-600 shadow-sm'
          }`}
        >
          <div className="flex items-center gap-2 truncate">
            <Key className="w-4 h-4 shrink-0 animate-bounce" />
            <span className="font-bold">Notice:</span>
            <span className="truncate">Gemini API key is missing. Please add it in Settings.</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleGoToSettings}
              aria-label="Open Settings to add Gemini API key"
              className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold transition shadow-sm ${
                highContrast
                  ? 'bg-black text-yellow-400 hover:bg-zinc-900 border border-black'
                  : 'bg-white text-amber-900 hover:bg-amber-50'
              }`}
            >
              <span>Open Settings</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                setKeyMissingAlert(false);
                if (lastErrorDebug?.includes('Gemini API key is missing')) {
                  setLastErrorDebug(null);
                }
              }}
              aria-label="Dismiss key notice"
              className="p-1 rounded-full hover:bg-black/10 transition opacity-80 hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 2. Small Screen Debug Line (For errors other than missing key) */}
      {lastErrorDebug && !isKeyMissing && (
        <div
          role="alert"
          className="px-4 py-1.5 bg-red-900/90 text-red-100 text-xs font-mono flex items-center justify-between gap-3 border-b border-red-700"
        >
          <div className="flex items-center gap-2 truncate">
            <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
            <span className="font-bold">DEBUG:</span>
            <span className="truncate">{lastErrorDebug}</span>
          </div>
          <button
            onClick={() => setLastErrorDebug(null)}
            aria-label="Dismiss error debug message"
            className="p-0.5 rounded hover:bg-red-800 text-red-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 3. Main Live Status Strip (Updated every second) */}
      <div
        className={`px-4 lg:px-8 py-2 text-xs font-semibold flex flex-wrap items-center justify-between gap-3 transition-colors ${
          highContrast
            ? 'bg-zinc-950 text-yellow-400 border-yellow-400/80'
            : 'bg-white/70 backdrop-blur-sm text-gray-700'
        }`}
        aria-label="Real-time system telemetry"
      >
        {/* Left metrics: Time/Date, Battery, Connectivity, GPS */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-5">
          {/* Live Clock & Date */}
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-gray-900 dark:text-yellow-400">
            <Clock className="w-3.5 h-3.5 opacity-70 text-indigo-600" />
            <span>
              {currentTimeString || '00:00:00'} · {currentDateString || 'Today'}
            </span>
          </div>

          {/* Online/Offline status */}
          <div className="flex items-center gap-1.5 text-[11px]">
            {isOnline ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-700 dark:text-emerald-400">Online</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-red-500 animate-pulse" />
                <span className="text-red-700 dark:text-red-400 font-bold">Offline</span>
              </>
            )}
          </div>

          {/* Battery level if supported */}
          {batteryLevel !== null && (
            <div className="flex items-center gap-1 text-[11px]">
              {isCharging ? (
                <BatteryCharging className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Battery className="w-3.5 h-3.5 opacity-70" />
              )}
              <span>{batteryLevel}%</span>
            </div>
          )}

          {/* GPS Accuracy and Address */}
          <div className="flex items-center gap-1 text-[11px] truncate max-w-xs">
            <MapPin className="w-3.5 h-3.5 text-sky-500 shrink-0" />
            <span className="truncate">
              {currentLocation.accuracy
                ? `±${Math.round(currentLocation.accuracy)}m · ${currentLocation.address || 'Locating...'}`
                : currentLocation.address || 'GPS acquiring...'}
            </span>
          </div>
        </div>

        {/* Right metrics: Mic, Vision, Nav, Latest Objects & Last Heard */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-[11px]">
          {/* Latest Obstacles in view */}
          <div className="hidden md:flex items-center gap-1 opacity-80 truncate max-w-xs">
            <span className="font-bold">Latest:</span>
            <span className="truncate text-indigo-700 dark:text-yellow-300 font-mono">
              {latestObjectsSummary}
            </span>
          </div>

          {/* System states */}
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                micStatus === 'listening' ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'
              }`}
            />
            <Mic className="w-3 h-3 opacity-70" />
            <span className="capitalize">{micStatus}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Eye className="w-3 h-3 opacity-70" />
            <span>{detectionActive ? 'Vision On' : 'Vision Off'}</span>
          </div>

          {navigationActive && (
            <div className="flex items-center gap-1.5 text-amber-600 font-bold">
              <Navigation className="w-3 h-3 animate-pulse" />
              <span className="truncate max-w-[120px]">{destination}</span>
            </div>
          )}

          {/* Live "Last Heard" */}
          <div className="flex items-center gap-1.5 bg-gray-100/90 dark:bg-zinc-900 px-2.5 py-0.5 rounded-full border border-gray-200 dark:border-zinc-800 truncate max-w-xs">
            <MessageSquare className="w-3 h-3 text-sky-500 shrink-0" />
            <span className="font-bold opacity-60">Heard:</span>
            <span className="truncate text-gray-900 dark:text-yellow-300 font-medium not-italic">
              {lastTranscript ? `“${lastTranscript}”` : 'None yet'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
