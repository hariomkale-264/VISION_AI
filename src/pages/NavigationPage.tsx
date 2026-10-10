/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Search, MapPin, CornerUpRight, ArrowRight, ExternalLink, Navigation, Compass } from 'lucide-react';
import { NavigationCard } from '../components/NavigationCard';
import { useAppStore } from '../store/appStore';
import { useStatsStore } from '../store/statsStore';
import { searchDestination } from '../services/geocode';
import { getWalkingRoute } from '../services/routing';
import { formatDistance } from '../utils/haversine';
import { speechQueue, SpeechPriority } from '../services/speechQueue';
import { openGoogleMaps } from '../services/navigationService';

export const NavigationPage: React.FC = () => {
  const currentLocation = useAppStore((s) => s.currentLocation);
  const startNavigation = useAppStore((s) => s.startNavigation);
  const navigationActive = useAppStore((s) => s.navigationActive);
  const destination = useAppStore((s) => s.destination);
  const routeSteps = useAppStore((s) => s.routeSteps);
  const currentStepIndex = useAppStore((s) => s.currentStepIndex);
  const highContrast = useAppStore((s) => s.highContrast);
  const googleMapsNav = useAppStore((s) => s.googleMapsNav);
  const navDebugInfo = useAppStore((s) => s.navDebugInfo);

  const recordVoiceCommandSuccess = useStatsStore((s) => s.recordVoiceCommandSuccess);
  const addActivity = useStatsStore((s) => s.addActivity);

  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const dest = query.trim();
    if (!dest) return;

    setIsSearching(true);
    setQuery('');

    // Trigger openGoogleMaps everywhere (search bar, voice, buttons)
    try {
      await openGoogleMaps(dest, { heardText: dest });
    } catch (err) {
      console.error('openGoogleMaps error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleReopenMaps = () => {
    if (googleMapsNav?.destination) {
      openGoogleMaps(googleMapsNav.destination, {
        explicitMode: googleMapsNav.travelmode,
        bypassModePrompt: true,
        heardText: googleMapsNav.heardTranscript || googleMapsNav.destination,
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight">Pedestrian GPS Navigation</h2>
        <p className="text-xs font-semibold opacity-70">
          Turn-by-turn guidance powered by OpenStreetMap & automatic Google Maps navigation.
        </p>
      </div>

      {/* Destination Search Form */}
      <form onSubmit={handleSearch} className="max-w-xl">
        <div
          className={`flex items-center gap-3 p-2.5 rounded-2xl border shadow-sm ${
            highContrast
              ? 'bg-zinc-900 border-yellow-400'
              : 'bg-white border-gray-200'
          }`}
        >
          <Search className="w-5 h-5 opacity-60 ml-2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter destination (e.g., Central Park, Railway Station)..."
            aria-label="Enter destination"
            className="flex-1 bg-transparent text-sm font-semibold focus:outline-none"
          />
          <button
            type="submit"
            disabled={isSearching}
            aria-label="Find route and open Google Maps"
            className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 transition flex items-center gap-1.5 min-h-[44px] cursor-pointer"
          >
            <span>{isSearching ? 'Opening...' : 'Start Route'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </form>

      {/* Active Google Maps Navigation Status Card & Debug Line */}
      {googleMapsNav && (
        <div
          className={`p-5 rounded-[24px] border transition-all ${
            highContrast
              ? 'bg-zinc-950 border-2 border-yellow-400 text-yellow-300'
              : 'bg-emerald-50/90 border-emerald-200 text-emerald-950 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-100 shadow-sm'
          }`}
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black uppercase tracking-wide bg-emerald-600 text-white dark:bg-emerald-500 dark:text-black">
                  <span className="w-2 h-2 rounded-full bg-white dark:bg-black animate-ping" />
                  Nav: Active
                </span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-700 bg-white/70 dark:bg-zinc-900 capitalize">
                  {googleMapsNav.travelmode}
                </span>
                {googleMapsNav.distanceKm ? (
                  <span className="text-xs opacity-75 font-mono">
                    ~{googleMapsNav.distanceKm} km away
                  </span>
                ) : null}
              </div>
              <h3 className="text-lg font-black tracking-tight">
                Destination: {googleMapsNav.destination}
              </h3>
              {googleMapsNav.heardTranscript && (
                <p className="text-xs opacity-80">
                  Heard command: &ldquo;{googleMapsNav.heardTranscript}&rdquo;
                </p>
              )}
            </div>

            <button
              onClick={handleReopenMaps}
              aria-label={`Re-open Google Maps for ${googleMapsNav.destination}`}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs shadow-md transition-all active:scale-[0.98] min-h-[44px] cursor-pointer ${
                highContrast
                  ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
              }`}
            >
              <Navigation className="w-4 h-4" />
              <span>Re-open Google Maps</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Prompt 7: Debug Line: heard text -> extracted destination -> geocoded place -> final URL -> redirect method used */}
          {navDebugInfo && (
            <div className="mt-4 pt-3 border-t border-emerald-200/60 dark:border-emerald-800/60 text-[11px] font-mono break-all space-y-1 opacity-90">
              <span className="font-bold text-emerald-800 dark:text-emerald-300 block">
                Navigation Pipeline Telemetry:
              </span>
              <div>
                <span className="opacity-75">Heard:</span> &ldquo;{navDebugInfo.heardText}&rdquo; &rarr;{' '}
                <span className="opacity-75">Extracted:</span> &ldquo;{navDebugInfo.extractedDest}&rdquo; &rarr;{' '}
                <span className="opacity-75">Geocoded:</span> &ldquo;{navDebugInfo.geocodedPlace}&rdquo; &rarr;{' '}
                <span className="opacity-75">Method:</span> <strong className="text-amber-600 dark:text-yellow-400">{navDebugInfo.redirectMethod}</strong>
              </div>
              <div className="text-[10px] opacity-70 truncate">
                <span className="opacity-75">URL:</span> {navDebugInfo.finalUrl}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <NavigationCard />
        </div>

        {/* Step-by-step cue sheet */}
        <div
          className={`rounded-[24px] p-5 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] transition-all ${
            highContrast
              ? 'bg-black border-2 border-yellow-400 text-yellow-400'
              : 'bg-white border border-gray-100 text-gray-900'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="font-extrabold text-base tracking-tight">Turn Instructions</h3>
            {destination && (
              <button
                onClick={() => openGoogleMaps(destination, { bypassModePrompt: true })}
                className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                <span>Google Maps</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>
          <p className="text-xs font-semibold opacity-70 mb-4">
            {navigationActive ? `Path to ${destination}` : 'No active route'}
          </p>

          {!navigationActive || routeSteps.length === 0 ? (
            <div className="py-12 text-center opacity-60 text-xs">
              <MapPin className="w-8 h-8 mx-auto mb-2" />
              <span>Search a destination or say &ldquo;navigate me to [place]&rdquo;</span>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1 text-xs">
              {routeSteps.map((s, idx) => {
                const isCurrent = idx === currentStepIndex;
                const isPast = idx < currentStepIndex;

                return (
                  <div
                    key={idx}
                    className={`p-3 rounded-2xl flex items-start gap-3 border transition-colors ${
                      isCurrent
                        ? highContrast
                          ? 'bg-yellow-400 text-black font-extrabold'
                          : 'bg-indigo-50 border-indigo-200 text-indigo-950 font-bold'
                        : isPast
                        ? 'opacity-40 bg-gray-50'
                        : 'bg-white border-gray-100'
                    }`}
                  >
                    <CornerUpRight className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="leading-snug">{s.instruction}</p>
                      <span className="text-[10px] opacity-75 mt-0.5 block">
                        {formatDistance(s.distance)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
