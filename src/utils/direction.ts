/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type DirectionLabel = 'on your left' | 'ahead' | 'on your right';

/**
 * Computes direction relative to user based on bounding box center x coordinate.
 * @param boxCenterX Center x coordinate of bounding box
 * @param frameWidth Width of the video frame
 */
export function getDirection(boxCenterX: number, frameWidth: number): DirectionLabel {
  if (frameWidth <= 0) return 'ahead';
  const ratio = boxCenterX / frameWidth;
  if (ratio < 0.35) {
    return 'on your left';
  } else if (ratio > 0.65) {
    return 'on your right';
  }
  return 'ahead';
}
