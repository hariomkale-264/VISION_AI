/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { calculateHaversineDistance } from '../utils/haversine';

export interface GeocodeMatch {
  placeId: string;
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  distanceMeters?: number;
}

/**
 * Forward geocoding with OpenStreetMap Nominatim, biased to user's current area.
 */
export async function searchDestination(
  query: string,
  userLat?: number | null,
  userLng?: number | null
): Promise<GeocodeMatch[]> {
  if (!query || query.trim().length === 0) return [];

  let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`;

  // Bias to bounding box around user's location if available (+/- 0.5 deg ~ 50 km)
  if (userLat != null && userLng != null) {
    const minLon = userLng - 0.5;
    const maxLon = userLng + 0.5;
    const minLat = userLat - 0.5;
    const maxLat = userLat + 0.5;
    url += `&viewbox=${minLon},${maxLat},${maxLon},${minLat}&bounded=0`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'VISION_AI_Assistive_App/1.0',
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Nominatim geocoding failed: ${response.status}`);
    }

    const data = await response.json();
    const results: GeocodeMatch[] = (data || []).map((item: any) => {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    let distanceMeters: number | undefined;
    if (userLat != null && userLng != null) {
      distanceMeters = calculateHaversineDistance(userLat, userLng, lat, lng);
    }

    return {
      placeId: String(item.place_id),
      name: item.name || item.display_name.split(',')[0],
      displayName: item.display_name,
      lat,
      lng,
      distanceMeters,
    };
  });

  // Sort by distance if user location is available
  if (userLat != null && userLng != null) {
    results.sort((a, b) => (a.distanceMeters || 0) - (b.distanceMeters || 0));
  }

    return results;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('Nominatim geocoding aborted or failed:', err);
    return [];
  }
}

let cachedReverseGeocode: { lat: number; lng: number; time: number; address: string } | null = null;

/**
 * Reverse geocodes coordinates to a clean human-readable address with 10-second throttling and coordinate caching.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const now = Date.now();

  // Return cached address if requested within 10 seconds and coordinates are close
  if (cachedReverseGeocode) {
    const elapsed = now - cachedReverseGeocode.time;
    const dist = calculateHaversineDistance(lat, lng, cachedReverseGeocode.lat, cachedReverseGeocode.lng);
    if (elapsed < 10000 && dist < 20) {
      return cachedReverseGeocode.address;
    }
  }

  // If offline, use cached address or fallback
  if (typeof navigator !== 'undefined' && !navigator.onLine && cachedReverseGeocode) {
    return cachedReverseGeocode.address;
  }

  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'VISION_AI_Assistive_App/1.0',
      },
    });

    if (!response.ok) {
      return cachedReverseGeocode?.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    const data = await response.json();
    let computedAddress = '';
    if (data && data.address) {
      const parts = [
        data.address.road || data.address.pedestrian || data.address.suburb,
        data.address.neighbourhood || data.address.city_district || data.address.city || data.address.town,
        data.address.state,
      ].filter(Boolean);
      computedAddress = parts.join(', ') || data.display_name.split(',').slice(0, 3).join(',');
    } else {
      computedAddress = data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    cachedReverseGeocode = {
      lat,
      lng,
      time: now,
      address: computedAddress,
    };

    return computedAddress;
  } catch (err) {
    console.warn('Reverse geocode error:', err);
    return cachedReverseGeocode?.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}
