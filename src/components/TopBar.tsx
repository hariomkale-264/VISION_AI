/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Search,
  Mic,
  MicOff,
  SunMoon,
  Settings,
  Bell,
  ArrowRight,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { PWAInstallButton } from './PWAInstallButton';
import { searchDestination } from '../services/geocode';
import { getWalkingRoute } from '../services/routing';
import { formatDistance } from '../utils/haversine';
import { speechQueue, SpeechPriority } from '../services/speechQueue';
import { useStatsStore } from '../store/statsStore';

interface TopBarProps {
  onToggleMic: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onToggleMic }) => {
  const micStatus = useAppStore((s) => s.micStatus);
  const highContrast = useAppStore((s) => s.highContrast);
  const setHighContrast = useAppStore((s) => s.setHighContrast);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const currentLocation = useAppStore((s) => s.currentLocation);
  const startNavigation = useAppStore((s) => s.startNavigation);
  const recordVoiceCommandSuccess = useStatsStore((s) => s.recordVoiceCommandSuccess);
  const addActivity = useStatsStore((s) => s.addActivity);

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    if (currentLocation.lat == null || currentLocation.lng == null) {
      speechQueue.speak('Please wait for GPS location before searching.', SpeechPriority.ASSISTANT_REPLY);
      return;
    }

    setIsSearching(true);
    speechQueue.speak(`Searching destination: ${searchQuery}`, SpeechPriority.STATUS);

    try {
      const matches = await searchDestination(searchQuery, currentLocation.lat, currentLocation.lng);
      if (matches.length === 0) {
        speechQueue.speak('No matching places found. Try another search term.', SpeechPriority.ASSISTANT_REPLY);
      } else {
        const best = matches[0];
        const route = await getWalkingRoute(currentLocation.lat, currentLocation.lng, best.lat, best.lng);

        startNavigation(
          best.name,
          [best.lat, best.lng],
          route.coordinates,
          route.steps,
          route.distanceMeters,
          route.durationSeconds
        );

        speechQueue.speak(
          `Navigating to ${best.name}. ${route.steps[0]?.instruction || ''}`,
          SpeechPriority.NAVIGATION
        );

        recordVoiceCommandSuccess('navigate', `Searched: ${best.name}`);
        addActivity({
          type: 'navigation',
          title: `Route to ${best.name}`,
          detail: `${formatDistance(route.distanceMeters)}, ~${Math.ceil(route.durationSeconds / 60)} min walk`,
          status: 'Completed',
        });
        setSearchQuery('');
        setActiveTab('navigation');
      }
    } catch (err) {
      console.error('Search navigation error:', err);
      speechQueue.speak('Failed to calculate route to destination.', SpeechPriority.ASSISTANT_REPLY);
    } finally {
      setIsSearching(false);
    }
  };

  const isListening = micStatus === 'listening';

  return (
    <header
      className={`px-4 lg:px-8 py-4 flex flex-wrap items-center justify-between gap-4 border-b transition-colors ${
        highContrast
          ? 'bg-black border-yellow-400 text-yellow-400'
          : 'bg-white/70 backdrop-blur-md border-gray-200/60 text-gray-900'
      }`}
    >
      {/* Mobile brand header */}
      <div className="flex items-center gap-2 lg:hidden">
        <span className="font-extrabold text-lg tracking-tight">VISION_AI</span>
        <span className="text-[10px] uppercase font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full">
          Voice OS
        </span>
      </div>

      {/* Search destination pill */}
      <form onSubmit={handleSearchSubmit} className="flex-1 max-w-md min-w-[240px]">
        <div
          className={`flex items-center gap-2.5 px-4 py-2.5 rounded-full border transition-all shadow-sm ${
            highContrast
              ? 'bg-zinc-900 border-yellow-400 focus-within:ring-2 focus-within:ring-yellow-400'
              : 'bg-gray-50/90 border-gray-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent'
          }`}
        >
          <Search className="w-4 h-4 opacity-60 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Type or speak destination (e.g. Metro Station)..."
            aria-label="Search destination or navigate"
            className="w-full bg-transparent text-xs sm:text-sm font-medium focus:outline-none placeholder:opacity-60"
          />
          {searchQuery.trim().length > 0 && (
            <button
              type="submit"
              disabled={isSearching}
              aria-label="Start route"
              className="p-1 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 transition"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </form>

      {/* Right controls: Mic pill, PWA Install, High Contrast, Settings */}
      <div className="flex items-center gap-3">
        {/* Prominent Mic Status Pill */}
        <button
          onClick={onToggleMic}
          aria-label={isListening ? 'Stop listening' : 'Start listening'}
          className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold text-xs sm:text-sm transition-all shadow-sm min-h-[46px] ${
            isListening
              ? 'bg-emerald-500 text-white shadow-emerald-500/25 ring-2 ring-emerald-400/40 animate-pulse'
              : highContrast
              ? 'bg-zinc-900 text-yellow-400 border border-yellow-400'
              : 'bg-[#14141C] text-white hover:bg-gray-800'
          }`}
        >
          {isListening ? (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
              <Mic className="w-4 h-4" />
              <span>Listening</span>
            </>
          ) : (
            <>
              <MicOff className="w-4 h-4 opacity-75" />
              <span>Mic Paused</span>
            </>
          )}
        </button>

        <PWAInstallButton />

        {/* High Contrast Toggle Button */}
        <button
          onClick={() => setHighContrast(!highContrast)}
          aria-label={highContrast ? 'Disable high contrast' : 'Enable high contrast'}
          title="Toggle High Contrast"
          className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all shadow-sm ${
            highContrast
              ? 'bg-yellow-400 text-black border-yellow-400 font-bold'
              : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
          }`}
        >
          <SunMoon className="w-4 h-4" />
        </button>

        {/* Settings Button */}
        <button
          onClick={() => setActiveTab('settings')}
          aria-label="Open settings"
          title="Settings"
          className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all shadow-sm ${
            highContrast
              ? 'bg-zinc-900 border-yellow-400 text-yellow-400'
              : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-100'
          }`}
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
