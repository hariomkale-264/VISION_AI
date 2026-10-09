/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { useStatsStore } from '../store/statsStore';
import { calculateHaversineDistance, formatDistance } from '../utils/haversine';
import { getWalkingRoute } from '../services/routing';
import { speechQueue, SpeechPriority } from '../services/speechQueue';

export function useNavigation() {
  const navigationActive = useAppStore((s) => s.navigationActive);
  const destination = useAppStore((s) => s.destination);
  const destinationCoords = useAppStore((s) => s.destinationCoords);
  const routePolyline = useAppStore((s) => s.routePolyline);
  const routeSteps = useAppStore((s) => s.routeSteps);
  const currentStepIndex = useAppStore((s) => s.currentStepIndex);
  const currentLocation = useAppStore((s) => s.currentLocation);
  const isRerouting = useAppStore((s) => s.isRerouting);

  const startNavigation = useAppStore((s) => s.startNavigation);
  const updateNavigationProgress = useAppStore((s) => s.updateNavigationProgress);
  const stopNavigation = useAppStore((s) => s.stopNavigation);
  const setIsRerouting = useAppStore((s) => s.setIsRerouting);
  const addActivity = useStatsStore((s) => s.addActivity);

  const lastAnnouncedStepIndexRef = useRef<number>(-1);
  const announced20mRef = useRef<boolean>(false);
  const lastRerouteTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!navigationActive || !destinationCoords || currentLocation.lat == null || currentLocation.lng == null) {
      return;
    }

    const userLat = currentLocation.lat;
    const userLng = currentLocation.lng;
    const destLat = destinationCoords[0];
    const destLng = destinationCoords[1];

    // Total distance to destination
    const totalDistToDest = calculateHaversineDistance(userLat, userLng, destLat, destLng);

    // Check arrival (< 12 meters)
    if (totalDistToDest <= 12) {
      speechQueue.speak('You have arrived at your destination.', SpeechPriority.URGENT_OBSTACLE);
      addActivity({
        type: 'navigation',
        title: 'Arrived at Destination',
        detail: `Reached ${destination}`,
        status: 'Completed',
      });
      stopNavigation();
      return;
    }

    // Check current step
    const step = routeSteps[currentStepIndex];
    if (step) {
      const distToStep = calculateHaversineDistance(userLat, userLng, step.location[0], step.location[1]);

      // Initial announcement for this step
      if (lastAnnouncedStepIndexRef.current !== currentStepIndex) {
        lastAnnouncedStepIndexRef.current = currentStepIndex;
        announced20mRef.current = false;
        const msg = distToStep > 35
          ? `In ${formatDistance(distToStep)}, ${step.instruction}`
          : step.instruction;
        speechQueue.speak(msg, SpeechPriority.NAVIGATION);
      }

      // Re-announce within 20m of the turn
      if (distToStep <= 22 && !announced20mRef.current && distToStep > 6) {
        announced20mRef.current = true;
        speechQueue.speak(step.instruction, SpeechPriority.NAVIGATION);
      }

      // Advance step if close enough or passed (< 8 meters)
      if (distToStep <= 8) {
        const nextIdx = currentStepIndex + 1;
        if (nextIdx < routeSteps.length) {
          updateNavigationProgress(nextIdx, totalDistToDest, Math.ceil(totalDistToDest / 1.2));
        }
      } else {
        // Update remaining distance
        updateNavigationProgress(currentStepIndex, totalDistToDest, Math.ceil(totalDistToDest / 1.2));
      }
    }

    // Check off-route (> 30 meters from all polyline segments)
    if (routePolyline.length > 0 && !isRerouting) {
      let minDistanceToRoute = Infinity;
      for (const pt of routePolyline) {
        const d = calculateHaversineDistance(userLat, userLng, pt[0], pt[1]);
        if (d < minDistanceToRoute) {
          minDistanceToRoute = d;
        }
      }

      const now = Date.now();
      if (minDistanceToRoute > 32 && now - lastRerouteTimeRef.current > 15000) {
        lastRerouteTimeRef.current = now;
        setIsRerouting(true);
        speechQueue.speak('Rerouting', SpeechPriority.NAVIGATION);

        getWalkingRoute(userLat, userLng, destLat, destLng)
          .then((newRoute) => {
            startNavigation(
              destination,
              destinationCoords,
              newRoute.coordinates,
              newRoute.steps,
              newRoute.distanceMeters,
              newRoute.durationSeconds
            );
            lastAnnouncedStepIndexRef.current = -1;
            announced20mRef.current = false;
            setIsRerouting(false);
          })
          .catch((err) => {
            console.warn('Rerouting calculation error:', err);
            setIsRerouting(false);
          });
      }
    }
  }, [
    navigationActive,
    destination,
    destinationCoords,
    routePolyline,
    routeSteps,
    currentStepIndex,
    currentLocation,
    isRerouting,
    startNavigation,
    updateNavigationProgress,
    stopNavigation,
    setIsRerouting,
    addActivity,
  ]);
}
