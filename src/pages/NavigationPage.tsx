/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Search, MapPin, CornerUpRight, ArrowRight } from 'lucide-react';
import { NavigationCard } from '../components/NavigationCard';
import { useAppStore } from '../store/appStore';
import { useStatsStore } from '../store/statsStore';
import { searchDestination } from '../services/geocode';
import { getWalkingRoute } from '../services/routing';
import { formatDistance } from '../utils/haversine';
import { speechQueue, SpeechPriority } from '../services/speechQueue';

export const NavigationPage: React.FC = () => {
  const currentLocation = useAppStore((s) => s.currentLocation);
  const startNavigation = useAppStore((s) => s.startNavigation);
  const navigationActive = useAppStore((s) => s.navigationActive);
  const destination = useAppStore((s) => s.destination);
  const routeSteps = useAppStore((s) => s.routeSteps);
  const currentStepIndex = useAppStore((s) => s.currentStepIndex);
  const highContrast = useAppStore((s) => s.highContrast);

  const recordVoiceCommandSuccess = useStatsStore((s) => s.recordVoiceCommandSuccess);
  const addActivity = useStatsStore((s) => s.addActivity);

  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    if (currentLocation.lat == null || currentLocation.lng == null) {
      speechQueue.speak('Waiting for GPS signal before route search.', SpeechPriority.STATUS);
      return;
    }

    setIsSearching(true);
    speechQueue.speak(`Searching destination: ${query}`, SpeechPriority.STATUS);

    try {
      const matches = await searchDestination(query, currentLocation.lat, currentLocation.lng);
      if (matches.length === 0) {
        speechQueue.speak('No matching places found nearby.', SpeechPriority.ASSISTANT_REPLY);
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

        recordVoiceCommandSuccess('navigate', `Route to ${best.name}`);
        addActivity({
          type: 'navigation',
          title: `Route to ${best.name}`,
          detail: `${formatDistance(route.distanceMeters)}, ~${Math.ceil(route.durationSeconds / 60)} min walk`,
          status: 'Completed',
        });
        setQuery('');
      }
    } catch (err) {
      console.error('Navigation search error:', err);
      speechQueue.speak('Unable to calculate walking route.', SpeechPriority.ASSISTANT_REPLY);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight">Pedestrian GPS Navigation</h2>
        <p className="text-xs font-semibold opacity-70">
          Turn-by-turn spoken guidance powered by OpenStreetMap & OSRM with automatic 30m rerouting.
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
            placeholder="Enter destination (e.g., Central Park, Pharmacy, Grocery)..."
            aria-label="Enter destination"
            className="flex-1 bg-transparent text-sm font-semibold focus:outline-none"
          />
          <button
            type="submit"
            disabled={isSearching}
            aria-label="Find walking route"
            className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 transition flex items-center gap-1.5 min-h-[44px]"
          >
            <span>{isSearching ? 'Finding...' : 'Start Route'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </form>

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
          <h3 className="font-extrabold text-base tracking-tight mb-2">Turn Instructions</h3>
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
