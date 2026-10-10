/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { ExternalLink, X, MapPin } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { speechQueue, SpeechPriority } from '../services/speechQueue';
import { performRedirect } from '../services/navigationService';

export const TapMapsOverlay: React.FC = () => {
  const tapOverlay = useAppStore((s) => s.tapOverlay);
  const setTapOverlay = useAppStore((s) => s.setTapOverlay);

  useEffect(() => {
    if (!tapOverlay?.active) return;

    const announceAndVibrate = () => {
      speechQueue.speak('Tap anywhere to open Google Maps', SpeechPriority.URGENT_OBSTACLE);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(200);
        } catch {}
      }
    };

    // Immediate announcement
    announceAndVibrate();

    // Repeat every 5 seconds
    const interval = setInterval(announceAndVibrate, 5000);

    return () => clearInterval(interval);
  }, [tapOverlay?.active]);

  if (!tapOverlay?.active) return null;

  const handleScreenTap = () => {
    // Tap is a direct user touch gesture, allowed unconditionally by all browsers
    try {
      window.open(tapOverlay.url, '_blank');
    } catch {}
    performRedirect(tapOverlay.url);
    setTapOverlay(null);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTapOverlay(null);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleScreenTap}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleScreenTap();
        }
      }}
      aria-label="Tap anywhere to open Google Maps"
      className="fixed inset-0 z-[9999] bg-black text-yellow-400 cursor-pointer flex flex-col items-center justify-center p-6 text-center select-none active:bg-yellow-950 transition-colors"
    >
      {/* Small close button for sighted users */}
      <button
        onClick={handleClose}
        aria-label="Close overlay"
        className="absolute top-6 right-6 p-3 rounded-2xl bg-zinc-900 border border-yellow-400/50 text-yellow-400 hover:bg-zinc-800 transition min-h-[48px] min-w-[48px] flex items-center justify-center cursor-pointer shadow-lg"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Giant Tap Target Content */}
      <div className="max-w-xl mx-auto space-y-6 pointer-events-none">
        <div className="w-24 h-24 mx-auto rounded-3xl bg-yellow-400 text-black flex items-center justify-center shadow-[0_0_50px_rgba(250,204,21,0.5)] animate-pulse">
          <MapPin className="w-14 h-14" />
        </div>

        <div className="space-y-3">
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight uppercase">
            Tap anywhere to open Google Maps
          </h1>
          {tapOverlay.destination && (
            <p className="text-lg sm:text-xl font-bold text-yellow-200">
              Route to: {tapOverlay.destination}
            </p>
          )}
        </div>

        <div className="pt-4 flex items-center justify-center gap-2 text-sm font-extrabold text-yellow-400/90 bg-yellow-400/10 py-3 px-6 rounded-2xl border border-yellow-400/30">
          <ExternalLink className="w-5 h-5" />
          <span>Touch anywhere on screen to continue</span>
        </div>
      </div>
    </div>
  );
};
