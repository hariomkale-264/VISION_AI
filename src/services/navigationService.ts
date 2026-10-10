/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppStore } from '../store/appStore';
import { useStatsStore } from '../store/statsStore';
import { searchDestination, reverseGeocode } from './geocode';
import { calculateHaversineDistance } from '../utils/haversine';
import { speechQueue, SpeechPriority } from './speechQueue';

export interface OpenGoogleMapsOptions {
  origin?: string;
  explicitMode?: 'walking' | 'driving' | 'transit' | 'bicycling';
  heardText?: string;
  bypassModePrompt?: boolean;
}

// Handler for temporary travel mode voice answering
let pendingTravelModeResolver: ((mode: 'walking' | 'driving' | 'transit') => void) | null = null;
let travelModeTimer: any = null;

export function handleTravelModeAnswer(speech: string): boolean {
  if (!pendingTravelModeResolver) return false;

  const lower = speech.toLowerCase().trim();
  let selectedMode: 'walking' | 'driving' | 'transit' | null = null;

  if (
    lower.includes('walk') ||
    lower.includes('walking') ||
    lower.includes('foot') ||
    lower.includes('पैदल') ||
    lower.includes('चालत')
  ) {
    selectedMode = 'walking';
  } else if (
    lower.includes('drive') ||
    lower.includes('driving') ||
    lower.includes('car') ||
    lower.includes('गाड़ी') ||
    lower.includes('कार') ||
    lower.includes('ड्राइव')
  ) {
    selectedMode = 'driving';
  } else if (
    lower.includes('transit') ||
    lower.includes('bus') ||
    lower.includes('train') ||
    lower.includes('metro') ||
    lower.includes('बस') ||
    lower.includes('ट्रेन') ||
    lower.includes('मेट्रो')
  ) {
    selectedMode = 'transit';
  }

  if (selectedMode) {
    if (travelModeTimer) clearTimeout(travelModeTimer);
    travelModeTimer = null;
    const resolver = pendingTravelModeResolver;
    pendingTravelModeResolver = null;
    useAppStore.getState().setIsWaitingForTravelMode(false);
    resolver(selectedMode);
    return true;
  }

  return false;
}

/**
 * Executes multi-stage redirect without window.open:
 * 1) window.location.href
 * 2) hidden <a target="_self"> click()
 */
export function performRedirect(mapsUrl: string): void {
  try {
    window.location.href = mapsUrl;
  } catch (e) {
    console.warn('location.href redirect error:', e);
  }

  try {
    let anchor = document.getElementById('maps-redirect-anchor') as HTMLAnchorElement | null;
    if (!anchor) {
      anchor = document.createElement('a');
      anchor.id = 'maps-redirect-anchor';
      anchor.style.display = 'none';
      anchor.target = '_self';
      document.body.appendChild(anchor);
    }
    anchor.href = mapsUrl;
    anchor.click();
  } catch (e) {
    console.warn('anchor click redirect error:', e);
  }
}

/**
 * Prompts user aloud for travel mode if destination is > 5 km away.
 * Waits 8 seconds, defaults to driving on timeout.
 */
function promptUserForTravelMode(distanceKm: number): Promise<'walking' | 'driving' | 'transit'> {
  return new Promise((resolve) => {
    useAppStore.getState().setIsWaitingForTravelMode(true);

    const promptText = `This place is about ${distanceKm} kilometers away. Say walk, drive, or transit.`;
    speechQueue.speak(promptText, SpeechPriority.URGENT_OBSTACLE);

    pendingTravelModeResolver = (mode) => {
      resolve(mode);
    };

    travelModeTimer = setTimeout(() => {
      if (pendingTravelModeResolver) {
        pendingTravelModeResolver = null;
        useAppStore.getState().setIsWaitingForTravelMode(false);
        speechQueue.speak('Defaulting to driving mode.', SpeechPriority.STATUS);
        resolve('driving');
      }
    }, 8000);
  });
}

/**
 * Extracts city name from current location address if available.
 */
function extractCurrentCity(address?: string): string {
  if (!address) return '';
  const parts = address.split(',').map((p) => p.trim());
  if (parts.length >= 2) {
    return parts[parts.length - 2] || parts[0];
  }
  return parts[0] || '';
}

/**
 * Master openGoogleMaps function used everywhere (voice, search bar, buttons).
 * Never uses window.open. Redirects current page automatically.
 */
export async function openGoogleMaps(
  destinationInput: string,
  options: OpenGoogleMapsOptions = {}
): Promise<void> {
  const query = (destinationInput || '').trim();
  if (!query) {
    speechQueue.speak('Where would you like to go?', SpeechPriority.ASSISTANT_REPLY);
    return;
  }

  const app = useAppStore.getState();
  const stats = useStatsStore.getState();
  const userLat = app.currentLocation.lat;
  const userLng = app.currentLocation.lng;
  const currentCity = extractCurrentCity(app.currentLocation.address);

  // 1. Fuzzy geocoding with Nominatim (zero Gemini/API key dependencies)
  let bestMatch: any = null;
  let geocodedPlace = query;
  let destParam = '';
  let distanceMeters: number | undefined;

  try {
    const matches = await searchDestination(query, userLat, userLng);
    if (matches && matches.length > 0) {
      bestMatch = matches[0];
      destParam = `${bestMatch.lat.toFixed(6)},${bestMatch.lng.toFixed(6)}`;
      geocodedPlace = bestMatch.name || bestMatch.displayName.split(',')[0];

      if (userLat != null && userLng != null) {
        distanceMeters = calculateHaversineDistance(userLat, userLng, bestMatch.lat, bestMatch.lng);
      }

      // If Nominatim match name has a slight spelling variation, inform the user
      const cleanQ = query.toLowerCase();
      const cleanMatch = (bestMatch.name || '').toLowerCase();
      if (cleanMatch && !cleanQ.includes(cleanMatch) && !cleanMatch.includes(cleanQ)) {
        speechQueue.speak(`Matching place: ${bestMatch.name}.`, SpeechPriority.STATUS);
      }
    }
  } catch (geoErr) {
    console.warn('Nominatim lookup error:', geoErr);
  }

  // Text search fallback if Nominatim returned 0 matches
  if (!bestMatch) {
    const placeWithCity =
      currentCity && !query.toLowerCase().includes(currentCity.toLowerCase())
        ? `${query}, ${currentCity}`
        : query;
    destParam = encodeURIComponent(placeWithCity);
    geocodedPlace = placeWithCity;
  }

  const distanceKm = distanceMeters ? Math.round(distanceMeters / 1000) : 0;

  // 2. Travel Mode Resolution
  let chosenMode: 'walking' | 'driving' | 'transit' | 'bicycling' =
    options.explicitMode || 'walking';

  // If distance > 5 km and mode wasn't explicitly given by user
  if (!options.explicitMode && !options.bypassModePrompt && distanceKm > 5) {
    chosenMode = await promptUserForTravelMode(distanceKm);
  }

  // 3. Build URL
  let mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${destParam}&travelmode=${chosenMode}`;

  if (options.origin) {
    mapsUrl += `&origin=${encodeURIComponent(options.origin)}`;
  }

  if (app.autoStartTurnByTurn) {
    mapsUrl += `&dir_action=navigate`;
  }

  const destinationDisplayName = bestMatch ? bestMatch.name : query;
  const heardText = options.heardText || query;
  let redirectMethod = 'href / anchor';

  // 4. Update state & debug line
  const debugLine = {
    heardText,
    extractedDest: query,
    geocodedPlace,
    finalUrl: mapsUrl,
    redirectMethod,
    timestamp: Date.now(),
  };

  app.setNavDebugInfo(debugLine);
  app.setGoogleMapsNav({
    destination: destinationDisplayName,
    geocodedName: geocodedPlace,
    url: mapsUrl,
    travelmode: chosenMode,
    heardTranscript: heardText,
    popupBlocked: false,
    lat: bestMatch?.lat,
    lng: bestMatch?.lng,
    distanceKm: distanceKm || undefined,
    status: 'active',
    redirectMethod,
  });

  stats.recordVoiceCommandSuccess(`navigate to ${destinationDisplayName}`, `Opening Google Maps (${chosenMode})`);

  // 5. Loading behavior:
  // Speak "Opening Google Maps to X", vibrate 200ms, save to localStorage, wait 600ms
  speechQueue.speak(`Opening Google Maps to ${destinationDisplayName}`, SpeechPriority.NAVIGATION);

  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(200);
    } catch {}
  }

  try {
    localStorage.setItem(
      'vision_ai_last_maps_nav',
      JSON.stringify({
        destination: destinationDisplayName,
        geocodedName: geocodedPlace,
        lat: bestMatch?.lat,
        lng: bestMatch?.lng,
        url: mapsUrl,
        travelmode: chosenMode,
        timestamp: Date.now(),
        status: 'active',
        redirectMethod,
        heardText,
      })
    );
    localStorage.setItem('vision_ai_has_left_for_maps', 'true');
  } catch {}

  // Wait 600 ms so speech starts cleanly
  await new Promise((resolve) => setTimeout(resolve, 600));

  // Perform immediate redirect
  performRedirect(mapsUrl);

  // 6. Multi-stage Fallback if redirect is blocked
  // Step A: 1.5s check -> Android Intent
  setTimeout(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
      if (isAndroid) {
        redirectMethod = 'intent';
        debugLine.redirectMethod = redirectMethod;
        app.setNavDebugInfo({ ...debugLine });

        const dirActionParam = app.autoStartTurnByTurn ? '&dir_action=navigate' : '';
        const intentUrl = `intent://maps.google.com/maps/dir/?api=1&destination=${destParam}&travelmode=${chosenMode}${dirActionParam}#Intent;scheme=https;package=com.google.android.apps.maps;end`;
        performRedirect(intentUrl);
      }
    }
  }, 1500);

  // Step B: 3.0s check -> Full-Screen Tap Target Overlay
  setTimeout(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      redirectMethod = 'tap overlay';
      debugLine.redirectMethod = redirectMethod;
      app.setNavDebugInfo({ ...debugLine });

      app.setTapOverlay({
        active: true,
        url: mapsUrl,
        destination: destinationDisplayName,
      });
    }
  }, 3000);
}
