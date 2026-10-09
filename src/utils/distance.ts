/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type DistanceLabel = 'very close' | 'close' | 'far';

/**
 * Computes proximity based on bounding box area ratio relative to frame area.
 * @param boxArea Area of the bounding box (width * height)
 * @param frameArea Total area of the video frame
 */
export function getDistanceEstimate(boxArea: number, frameArea: number): { label: DistanceLabel; ratio: number } {
  if (frameArea <= 0) return { label: 'far', ratio: 0 };
  const ratio = Math.max(0, Math.min(1, boxArea / frameArea));
  
  if (ratio >= 0.20) {
    return { label: 'very close', ratio };
  } else if (ratio >= 0.055) {
    return { label: 'close', ratio };
  }
  return { label: 'far', ratio };
}

/**
 * Estimates distance in meters formatted string (e.g. "2.1 m", "0.9 m")
 */
export function getEstimatedMetersString(ratio: number): string {
  if (ratio <= 0) return '3.5 m';
  const rawDist = 0.55 / Math.sqrt(Math.max(0.008, ratio));
  const meters = Math.max(0.5, Math.min(8.0, Math.round(rawDist * 10) / 10));
  return `${meters.toFixed(1)} m`;
}
