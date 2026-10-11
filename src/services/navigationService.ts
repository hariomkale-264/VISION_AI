/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppStore } from '../store/appStore';
import { useStatsStore } from '../store/statsStore';
import { searchDestination, reverseGeocode } from './geocode';
import { calculateHaversineDistance, formatDistance } from '../utils/haversine';
import { getWalkingRoute } from './routing';
import { speechQueue, SpeechPriority } from './speechQueue';
import { switchTab } from './tabNavigation';

export interface OpenGoogleMapsOptions {
  origin?: string;
  explicitMode?: 'walking' | 'driving' | 'transit' | 'bicycling';
  heardText?: string;
  bypassModePrompt?: boolean;
}

declare global {
  interface Window {
    isWaitingForDestination?: boolean;
  }
}

/**
 * Extracts destination string from spoken sentence using open-vocabulary pattern matching.
 */
export function extractDestination(text: string): string | null {
  const t = text.toLowerCase().trim();
  const patterns = [
    /(?:navigate|navigation|take me|go|directions?|route|guide me|walk me|drive me)\s*(?:to|towards)?\s+(.+)/i,
    /(?:i want to|i wanna|i need to)\s*(?:go|reach|get)\s*(?:to)?\s+(.+)/i,
    /(?:how (?:do i|can i|to))\s*(?:reach|get to)\s+(.+)/i,
    // Hindi & Marathi patterns
    /(?:कृपया\s+)?(?:मुझे\s+)?(.+?)\s*(?:ले\s+चलो|जाना\s+है|का\s+रास्ता|का\s+मार्ग)$/i,
    /(?:कृपया\s+)?(?:मला\s+)?(.+?)\s*(?:ला\s+जायचं\s+आहे|कडे\s+जा|चा\s+मार्ग)$/i,
  ];

  for (const p of patterns) {
    const m = t.match(p);
    if (m && m[1]) {
      let dest = m[1].replace(/[.,?!]+$/, '').trim();
      // Remove trailing filler words if any
      dest = dest.replace(/\s+(?:please)$/i, '').trim();
      return dest;
    }
  }
  return null;
}

/**
 * Speech synthesis announcement helper with Promise completion.
 */
export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    speechQueue.speak(text, SpeechPriority.NAVIGATION, {
      allowDuplicate: true,
      onEnd: () => resolve(),
    });
    // Safety timeout in case speech engine onEnd does not trigger
    setTimeout(resolve, 2000);
  });
}

/**
 * Direct voice-triggered navigation handler.
 * Does NOT depend on the Navigation tab being open or rendered.
 */
/**
 * Direct voice-triggered and UI-triggered navigation handler.
 * Runs inside Vision AI with Leaflet map and continuous turn-by-turn voice guidance.
 * Does NOT redirect to Google Maps by default (keeps Vision AI assistant alive).
 */
export async function startNavigation(rawInput: string): Promise<void> {
  console.log('[Nav] startNavigation called with:', rawInput);

  // 1. Extract destination if full sentence was passed
  const extracted = extractDestination(rawInput);
  let destination = extracted || rawInput.trim();

  // Strip leading filler words: "please", "the", "nearest", "a", "an"
  let changed = true;
  while (changed) {
    const prev = destination;
    destination = destination.replace(/^(?:please|the|nearest|a|an)\s+/i, '').trim();
    changed = prev !== destination;
  }
  destination = destination.replace(/[.,?!]+$/, '').trim();

  const isGenericNavOnly =
    /^(?:navigate|navigation|directions?|route|take me|go|walk|drive|where|open navigation|navigation tab)$/i.test(
      destination
    );

  console.log('[Nav] Extracted destination:', destination);

  if (!destination || isGenericNavOnly) {
    await speak('Where do you want to go?');
    // Set a flag to capture the next voice input as destination
    if (typeof window !== 'undefined') {
      window.isWaitingForDestination = true;
    }
    useAppStore.getState().setIsPendingDestination(true);
    return;
  }

  // Clear pending destination flag
  if (typeof window !== 'undefined') {
    window.isWaitingForDestination = false;
  }
  useAppStore.getState().setIsPendingDestination(false);

  // 2. Announce initial search to blind user
  await speak(`Looking up walking route to ${destination}`);

  // 3. Resolve user's current GPS location
  let userLat: number | null = null;
  let userLng: number | null = null;

  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 5000,
        enableHighAccuracy: true,
      });
    });
    userLat = pos.coords.latitude;
    userLng = pos.coords.longitude;
    useAppStore.getState().setCurrentLocation({
      lat: userLat,
      lng: userLng,
      accuracy: pos.coords.accuracy,
      speed: pos.coords.speed != null ? Math.max(0, pos.coords.speed) : 0,
    });
  } catch (geoErr) {
    console.warn('[Nav] Live GPS fetch timed out or denied, falling back to stored location:', geoErr);
    const storeLoc = useAppStore.getState().currentLocation;
    if (storeLoc.lat != null && storeLoc.lng != null) {
      userLat = storeLoc.lat;
      userLng = storeLoc.lng;
    }
  }

  if (userLat == null || userLng == null) {
    await speak('Cannot obtain your current location. Please enable GPS permissions and try again.');
    return;
  }

  // 4. Geocode destination using Nominatim
  let bestMatch: any = null;
  try {
    const matches = await searchDestination(destination, userLat, userLng);
    if (matches && matches.length > 0) {
      bestMatch = matches[0];
    }
  } catch (searchErr) {
    console.warn('[Nav] Geocoding lookup error:', searchErr);
  }

  if (!bestMatch || bestMatch.lat == null || bestMatch.lng == null) {
    await speak(`Could not find location coordinates for ${destination}. Please try another destination.`);
    return;
  }

  const destDisplayName = bestMatch.name || destination;
  const destCoords: [number, number] = [bestMatch.lat, bestMatch.lng];
  const distanceDirectM = calculateHaversineDistance(userLat, userLng, bestMatch.lat, bestMatch.lng);

  // 5. Calculate walking route via OSRM
  try {
    const route = await getWalkingRoute(userLat, userLng, bestMatch.lat, bestMatch.lng);

    const app = useAppStore.getState();
    const stats = useStatsStore.getState();

    // Switch to Navigation view so the Leaflet map and step cards are visible
    switchTab('navigation', { source: 'system' });

    // Start in-app navigation
    app.startNavigation(
      destDisplayName,
      destCoords,
      route.coordinates,
      route.steps,
      route.distanceMeters,
      route.durationSeconds
    );

    // Build Google Maps fallback URL (for manual user request or Re-open button)
    const encodedDest = encodeURIComponent(`${bestMatch.lat.toFixed(6)},${bestMatch.lng.toFixed(6)}`);
    const mapsFallbackUrl = `https://www.google.com/maps/dir/?api=1&origin=${userLat},${userLng}&destination=${encodedDest}&travelmode=walking`;

    app.setGoogleMapsNav({
      destination: destDisplayName,
      geocodedName: bestMatch.displayName || destDisplayName,
      url: mapsFallbackUrl,
      travelmode: 'walking',
      heardTranscript: rawInput,
      popupBlocked: false,
      lat: bestMatch.lat,
      lng: bestMatch.lng,
      distanceKm: Math.round(route.distanceMeters / 1000) || undefined,
      status: 'active',
      redirectMethod: 'internal Vision AI navigation',
    });

    app.setNavDebugInfo({
      heardText: rawInput,
      extractedDest: destination,
      geocodedPlace: bestMatch.displayName || destDisplayName,
      finalUrl: mapsFallbackUrl,
      redirectMethod: 'internal Vision AI navigation',
      timestamp: Date.now(),
    });

    stats.recordVoiceCommandSuccess(`navigate to ${destination}`, `Internal walking route to ${destDisplayName}`);
    stats.addActivity({
      type: 'navigation',
      title: `Route to ${destDisplayName}`,
      detail: `${formatDistance(route.distanceMeters)}, ~${Math.ceil(route.durationSeconds / 60)} min walk`,
      status: 'Completed',
    });

    // 6. Speak clear start instruction
    const firstStep = route.steps[0]?.instruction || `Head toward ${destDisplayName}`;
    const initialAnnouncement = `Navigation started for ${destDisplayName}. Route distance is ${formatDistance(route.distanceMeters)}. ${firstStep}`;
    await speak(initialAnnouncement);
  } catch (routeErr: any) {
    console.error('[Nav] Failed to calculate walking route:', routeErr);
    await speak(`Unable to calculate walking route to ${destDisplayName}. Direct distance is ${formatDistance(distanceDirectM)}.`);
  }
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
  const inIframe = typeof window !== 'undefined' && window.top !== window;

  try {
    if (inIframe && window.top) {
      try {
        window.top.location.href = mapsUrl;
      } catch {
        window.location.href = mapsUrl;
      }
    } else {
      window.location.href = mapsUrl;
    }
  } catch (e) {
    console.warn('location.href redirect error:', e);
  }

  try {
    let anchor = document.getElementById('maps-redirect-anchor') as HTMLAnchorElement | null;
    if (!anchor) {
      anchor = document.createElement('a');
      anchor.id = 'maps-redirect-anchor';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
    }
    anchor.href = mapsUrl;
    anchor.target = inIframe ? '_top' : '_self';
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
 * Master openGoogleMaps function for launching external Google Maps when explicitly requested by user.
 * Opens Google Maps in a new tab if possible or redirects, providing an accessible external fallback.
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
  } else if (userLat != null && userLng != null) {
    mapsUrl += `&origin=${userLat},${userLng}`;
  }

  if (app.autoStartTurnByTurn) {
    mapsUrl += `&dir_action=navigate`;
  }

  const destinationDisplayName = bestMatch ? bestMatch.name : query;
  const heardText = options.heardText || query;
  let redirectMethod = 'window.open / external fallback';

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

  stats.recordVoiceCommandSuccess(`open Google Maps for ${destinationDisplayName}`, `Opening Google Maps (${chosenMode})`);

  speechQueue.speak(`Opening Google Maps for ${destinationDisplayName}. Note that Vision AI assistant cannot speak continuously once you leave the browser.`, SpeechPriority.NAVIGATION);

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

  // Wait 1.2s so speech warning completes before navigating away
  await new Promise((resolve) => setTimeout(resolve, 1200));

  // Try window.open first so Vision AI tab remains open in background
  let opened: Window | null = null;
  try {
    opened = window.open(mapsUrl, '_blank');
  } catch (e) {
    console.warn('[Nav] window.open error:', e);
  }

  if (!opened || opened.closed || typeof opened.closed === 'undefined') {
    performRedirect(mapsUrl);
  }
}
