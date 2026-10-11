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

  // 2. Announce immediately to blind user
  await speak(`Starting navigation to ${destination}`);

  // 3. Get current location (with timeout fallback)
  let origin = '';
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation?.getCurrentPosition(resolve, reject, {
        timeout: 3000,
        enableHighAccuracy: false,
      });
    });
    origin = `${pos.coords.latitude},${pos.coords.longitude}`;
    console.log('[Nav] Got GPS coordinates:', origin);
  } catch (err) {
    console.log('[Nav] GPS not available or timed out, Maps will use device location');
    const storeLoc = useAppStore.getState().currentLocation;
    if (storeLoc.lat != null && storeLoc.lng != null) {
      origin = `${storeLoc.lat},${storeLoc.lng}`;
    }
  }

  // 4. Build URL
  const encoded = encodeURIComponent(destination);
  const mapsUrl = origin
    ? `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${encoded}&travelmode=walking`
    : `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=walking`;

  console.log('[Nav] Redirecting to:', mapsUrl);

  // Update App State for Navigation Tab and Activity
  const app = useAppStore.getState();
  const stats = useStatsStore.getState();
  app.setActiveTab('navigation');
  app.setGoogleMapsNav({
    destination,
    geocodedName: destination,
    url: mapsUrl,
    travelmode: 'walking',
    heardTranscript: rawInput,
    popupBlocked: false,
    status: 'active',
    redirectMethod: 'window.open / location.href',
  });
  app.setNavDebugInfo({
    heardText: rawInput,
    extractedDest: destination,
    geocodedPlace: destination,
    finalUrl: mapsUrl,
    redirectMethod: 'window.open / location.href',
    timestamp: Date.now(),
  });
  stats.recordVoiceCommandSuccess(`navigate to ${destination}`, `Walking navigation to ${destination}`);

  // STEP 4: Make sure Speech Synthesis finishes before redirect
  // Wait a brief moment (e.g. 1.5 seconds) so the user hears the confirmation before the page leaves
  await new Promise((r) => setTimeout(r, 1500));

  // 5. Open Google Maps
  // Try window.open first, fallback to window.location.href
  // (blind users cannot see new tabs, so location.href is often preferred on mobile)
  let opened: Window | null = null;
  try {
    opened = window.open(mapsUrl, '_blank');
  } catch (e) {
    console.warn('[Nav] window.open failed:', e);
  }

  if (!opened || opened.closed || typeof opened.closed === 'undefined') {
    // Popup was blocked or on mobile PWA -> redirect directly
    console.log('[Nav] Popup was blocked or on mobile PWA -> redirect directly');
    performRedirect(mapsUrl);
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

  // 4. Calculate guidance route and start in-app navigation if location available
  let guidanceAnnounced = false;
  if (userLat != null && userLng != null && bestMatch?.lat != null && bestMatch?.lng != null) {
    try {
      const route = await getWalkingRoute(userLat, userLng, bestMatch.lat, bestMatch.lng);
      app.startNavigation(
        destinationDisplayName,
        [bestMatch.lat, bestMatch.lng],
        route.coordinates,
        route.steps,
        route.distanceMeters,
        route.durationSeconds
      );
      app.setActiveTab('navigation');

      const firstStep = route.steps[0]?.instruction || `Proceed toward ${destinationDisplayName}`;
      const distDesc = distanceMeters ? `about ${formatDistance(distanceMeters)} away` : '';
      speechQueue.speak(
        `Starting guidance to ${destinationDisplayName}${distDesc ? ', ' + distDesc : ''}. ${firstStep}. Redirecting to Google Maps.`,
        SpeechPriority.NAVIGATION
      );
      guidanceAnnounced = true;

      stats.addActivity({
        type: 'navigation',
        title: `Route to ${destinationDisplayName}`,
        detail: `${formatDistance(route.distanceMeters)}, ~${Math.ceil(route.durationSeconds / 60)} min walk`,
        status: 'Completed',
      });
    } catch (routeErr) {
      console.warn('In-app routing warning:', routeErr);
    }
  }

  // 5. Update state & debug line
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

  stats.recordVoiceCommandSuccess(`navigate to ${destinationDisplayName}`, `Starting guidance & Google Maps (${chosenMode})`);

  // 6. Loading behavior:
  if (!guidanceAnnounced) {
    speechQueue.speak(`Starting guidance to ${destinationDisplayName}. Opening Google Maps.`, SpeechPriority.NAVIGATION);
  }

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
