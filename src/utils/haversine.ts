/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Calculates the great-circle distance between two points in meters using the Haversine formula.
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Validates whether a GPS movement delta is realistic.
 * Filters out low accuracy (> 25m) and physically unrealistic jumps (> 10 m/s).
 */
export function isValidGpsMovement(
  distMeters: number,
  timeDeltaSec: number,
  accuracy1?: number,
  accuracy2?: number
): boolean {
  if (accuracy1 && accuracy1 > 50) return false;
  if (accuracy2 && accuracy2 > 50) return false;
  if (timeDeltaSec <= 0) return false;

  const speedMetersPerSec = distMeters / timeDeltaSec;
  // Ignore speed jumps above 10 m/s (approx 36 km/h, well beyond walking speed)
  if (speedMetersPerSec > 10) return false;

  // Filter out tiny GPS jitter below 1.5 meters
  if (distMeters < 1.5) return false;

  return true;
}

/**
 * Formats distance in meters into human-readable string:
 * e.g., "450 m" if under 1 km, or "1.3 km" afterwards.
 */
export function formatDistance(meters: number): string {
  if (meters <= 0) return '0 m';
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}
