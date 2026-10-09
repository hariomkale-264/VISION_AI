/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { useStatsStore } from '../store/statsStore';
import { reverseGeocode } from '../services/geocode';
import { speechQueue, SpeechPriority } from '../services/speechQueue';

export function useGeolocation() {
  const setCurrentLocation = useAppStore((s) => s.setCurrentLocation);
  const recordGpsPosition = useStatsStore((s) => s.recordGpsPosition);
  const recordStepFallback = useStatsStore((s) => s.recordStepFallback);
  const setLocationPermissionDenied = useStatsStore((s) => s.setLocationPermissionDenied);

  const watchIdRef = useRef<number | null>(null);
  const lastGeocodeTimeRef = useRef<number>(0);

  // Step counter state refs
  const lastStepTimeRef = useRef<number>(0);
  const lastMagRef = useRef<number>(9.8);

  useEffect(() => {
    // 1. Spoken explanation first (once per session)
    const hasSpokenExplanation = sessionStorage.getItem('vision_ai_geo_motion_explained');
    if (!hasSpokenExplanation) {
      sessionStorage.setItem('vision_ai_geo_motion_explained', 'true');
      speechQueue.speak(
        'Vision AI needs location and motion permissions to track distance and steps while navigating.',
        SpeechPriority.STATUS
      );
    }

    // 2. Setup DeviceMotion fallback step counter
    // Minimum 300 ms between steps, peak detection on acceleration magnitude
    const handleDeviceMotion = (event: DeviceMotionEvent) => {
      const acc = event.acceleration || event.accelerationIncludingGravity;
      if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

      const mag = Math.hypot(acc.x, acc.y, acc.z);
      const now = performance.now();

      // If acceleration without gravity is provided, threshold is lower (~2.6 m/s²)
      // If accelerationIncludingGravity is provided, gravity baseline is ~9.8 m/s² so peak threshold is ~12.2 m/s²
      const isLinear = event.acceleration && event.acceleration.x !== null;
      const threshold = isLinear ? 2.6 : 12.2;

      if (mag > threshold && lastMagRef.current <= threshold && now - lastStepTimeRef.current >= 300) {
        lastStepTimeRef.current = now;
        recordStepFallback();
      }

      lastMagRef.current = mag;
    };

    if (typeof window !== 'undefined' && 'ondevicemotion' in window) {
      window.addEventListener('devicemotion', handleDeviceMotion, { passive: true });
    }

    // iOS 13+ permission request if applicable
    if (
      typeof window !== 'undefined' &&
      typeof (DeviceMotionEvent as any)?.requestPermission === 'function'
    ) {
      (DeviceMotionEvent as any)
        .requestPermission()
        .catch(() => {});
    }

    // 3. Geolocation watchPosition
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setCurrentLocation({ address: 'Geolocation not supported' });
      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('devicemotion', handleDeviceMotion);
        }
      };
    }

    const handleSuccess = async (pos: GeolocationPosition) => {
      const { latitude, longitude, accuracy, speed } = pos.coords;

      setLocationPermissionDenied(false);

      setCurrentLocation({
        lat: latitude,
        lng: longitude,
        accuracy,
        speed: speed != null ? Math.max(0, speed) : 0,
      });

      // Feed into real distance walked calculator
      recordGpsPosition(
        latitude,
        longitude,
        accuracy,
        speed != null ? Math.max(0, speed) : undefined
      );

      // Periodically reverse-geocode address (cached, max 1 request per 10-15 seconds)
      const now = Date.now();
      if (now - lastGeocodeTimeRef.current > 15000 || lastGeocodeTimeRef.current === 0) {
        lastGeocodeTimeRef.current = now;
        const addr = await reverseGeocode(latitude, longitude);
        if (addr) {
          setCurrentLocation({ address: addr });
        }
      }
    };

    const handleError = (err: GeolocationPositionError) => {
      if (err.code === 1) {
        // PERMISSION_DENIED
        setLocationPermissionDenied(true);
        const hasSpokenDenied = sessionStorage.getItem('vision_ai_geo_denied_spoken');
        if (!hasSpokenDenied) {
          sessionStorage.setItem('vision_ai_geo_denied_spoken', 'true');
          speechQueue.speak('Location permission needed', SpeechPriority.STATUS);
        }
      }
      console.warn('Geolocation error:', err.message);
    };

    const options: PositionOptions = {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000,
    };

    watchIdRef.current = navigator.geolocation.watchPosition(handleSuccess, handleError, options);

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('devicemotion', handleDeviceMotion);
      }
    };
  }, [setCurrentLocation, recordGpsPosition, recordStepFallback, setLocationPermissionDenied]);
}
