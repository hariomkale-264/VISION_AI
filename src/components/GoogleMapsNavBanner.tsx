/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { MapPin, ExternalLink, X, Navigation, AlertTriangle } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { performRedirect } from '../services/navigationService';

export const GoogleMapsNavBanner: React.FC = () => {
  const googleMapsNav = useAppStore((s) => s.googleMapsNav);
  const setGoogleMapsNav = useAppStore((s) => s.setGoogleMapsNav);
  const highContrast = useAppStore((s) => s.highContrast);

  if (!googleMapsNav) return null;

  const modeIcons: Record<string, string> = {
    walking: '🚶 Walking',
    driving: '🚗 Driving',
    transit: '🚌 Transit',
    bicycling: '🚲 Bicycling',
  };

  const modeLabel = modeIcons[googleMapsNav.travelmode] || '🚶 Walking';

  const handleOpenMaps = (e: React.MouseEvent) => {
    e.preventDefault();
    performRedirect(googleMapsNav.url);
  };

  return (
    <div
      role="region"
      aria-label="Google Maps Navigation Notice"
      className={`border-b transition-all px-3 sm:px-6 py-3 sm:py-3.5 shadow-sm ${
        highContrast
          ? 'bg-black border-yellow-400 text-yellow-300'
          : 'bg-emerald-50/90 border-emerald-200 text-emerald-950 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-100'
      }`}
    >
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3 sm:gap-4">
        {/* Left info column */}
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${
              highContrast
                ? 'bg-yellow-400 text-black'
                : 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-black'
            }`}
          >
            <Navigation className="w-5 h-5 animate-pulse" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-sm sm:text-base tracking-tight">
                Navigating to {googleMapsNav.destination}
              </span>
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                  highContrast
                    ? 'border-yellow-400 text-yellow-300'
                    : 'border-emerald-300 bg-white/80 dark:bg-zinc-800 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200'
                }`}
              >
                {modeLabel}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs opacity-85 mt-0.5 flex-wrap">
              <span>Understood from speech:</span>
              <span className="font-semibold italic truncate max-w-xs sm:max-w-md">
                &ldquo;{googleMapsNav.heardTranscript}&rdquo;
              </span>
            </div>

            {googleMapsNav.popupBlocked && (
              <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-300 font-bold mt-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Popup blocked by browser. Please tap the button to open Google Maps.</span>
              </div>
            )}
          </div>
        </div>

        {/* Right buttons */}
        <div className="flex items-center gap-2.5 w-full md:w-auto justify-end shrink-0">
          <button
            onClick={handleOpenMaps}
            aria-label={`Open route to ${googleMapsNav.destination} in Google Maps`}
            className={`flex-1 md:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs sm:text-sm shadow-md transition-all active:scale-[0.98] min-h-[44px] cursor-pointer ${
              highContrast
                ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
            }`}
          >
            <span>Open in Google Maps</span>
            <ExternalLink className="w-4 h-4 shrink-0" />
          </button>

          <button
            onClick={() => setGoogleMapsNav(null)}
            aria-label="Dismiss navigation notice"
            className={`p-2 rounded-xl border transition min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer ${
              highContrast
                ? 'border-yellow-400 hover:bg-zinc-900 text-yellow-300'
                : 'border-emerald-300 hover:bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:hover:bg-emerald-900 dark:text-emerald-200'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
