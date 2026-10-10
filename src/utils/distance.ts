/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type DistanceLabel = 'very close' | 'close' | 'far';

// Small handheld / tabletop objects
const SMALL_OBJECTS = new Set([
  'cell phone',
  'bottle',
  'cup',
  'wine glass',
  'fork',
  'knife',
  'spoon',
  'bowl',
  'banana',
  'apple',
  'sandwich',
  'orange',
  'broccoli',
  'carrot',
  'hot dog',
  'pizza',
  'donut',
  'cake',
  'book',
  'clock',
  'vase',
  'scissors',
  'remote',
  'mouse',
  'keyboard',
  'toothbrush',
  'hair drier',
  'sports ball',
  'baseball bat',
  'baseball glove',
  'frisbee',
]);

// Medium room / furniture / pet objects
const MEDIUM_OBJECTS = new Set([
  'chair',
  'laptop',
  'backpack',
  'handbag',
  'suitcase',
  'potted plant',
  'tv',
  'toilet',
  'microwave',
  'oven',
  'toaster',
  'sink',
  'dog',
  'cat',
  'bird',
  'bench',
  'fire hydrant',
  'stop sign',
  'parking meter',
  'skateboard',
  'surfboard',
  'tennis racket',
  'teddy bear',
]);

/**
 * Computes proximity based on bounding box area ratio relative to frame area,
 * taking real-world object scale into account (e.g. handheld cup vs full human body).
 * @param boxArea Area of the bounding box (width * height)
 * @param frameArea Total area of the video frame
 * @param className Optional object class name for realistic scale calibration
 */
export function getDistanceEstimate(
  boxArea: number,
  frameArea: number,
  className?: string
): { label: DistanceLabel; ratio: number } {
  if (frameArea <= 0) return { label: 'far', ratio: 0 };
  const ratio = Math.max(0, Math.min(1, boxArea / frameArea));
  const normalizedClass = (className || '').toLowerCase().trim();

  if (SMALL_OBJECTS.has(normalizedClass)) {
    // A handheld phone or bottle taking 3% of the screen is right in front of the user (close/very close)
    if (ratio >= 0.025) {
      return { label: 'very close', ratio };
    } else if (ratio >= 0.006) {
      return { label: 'close', ratio };
    }
    return { label: 'far', ratio };
  }

  if (MEDIUM_OBJECTS.has(normalizedClass)) {
    // A chair or laptop taking 6% of the frame is within arm's reach
    if (ratio >= 0.08) {
      return { label: 'very close', ratio };
    } else if (ratio >= 0.02) {
      return { label: 'close', ratio };
    }
    return { label: 'far', ratio };
  }

  // Default & large objects (person, car, couch, bus)
  if (ratio >= 0.16) {
    return { label: 'very close', ratio };
  } else if (ratio >= 0.045) {
    return { label: 'close', ratio };
  }
  return { label: 'far', ratio };
}

/**
 * Estimates distance in meters formatted string (e.g. "0.8 m", "1.5 m")
 */
export function getEstimatedMetersString(ratio: number, className?: string): string {
  if (ratio <= 0) return '3.5 m';
  const normalizedClass = (className || '').toLowerCase().trim();

  let meters = 2.0;
  if (SMALL_OBJECTS.has(normalizedClass)) {
    const rawDist = 0.16 / Math.sqrt(Math.max(0.003, ratio));
    meters = Math.max(0.3, Math.min(3.0, Math.round(rawDist * 10) / 10));
  } else if (MEDIUM_OBJECTS.has(normalizedClass)) {
    const rawDist = 0.35 / Math.sqrt(Math.max(0.005, ratio));
    meters = Math.max(0.5, Math.min(4.5, Math.round(rawDist * 10) / 10));
  } else {
    const rawDist = 0.55 / Math.sqrt(Math.max(0.008, ratio));
    meters = Math.max(0.6, Math.min(8.0, Math.round(rawDist * 10) / 10));
  }

  return `${meters.toFixed(1)} m`;
}
