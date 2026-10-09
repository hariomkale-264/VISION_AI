/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { reverseGeocode } from '../services/geocode';

export function useRealtimeStatus() {
  const setRealtimeMetrics = useAppStore((s) => s.setRealtimeMetrics);
  const setCurrentLocation = useAppStore((s) => s.setCurrentLocation);
  const currentLocation = useAppStore((s) => s.currentLocation);

  const batteryRef = useRef<any>(null);
  const lastGeocodeTimeRef = useRef<number>(0);

  // Set up Battery Status API
  useEffect(() => {
    let isCancelled = false;

    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      (navigator as any)
        .getBattery()
        .then((battery: any) => {
          if (isCancelled) return;
          batteryRef.current = battery;

          const updateBattery = () => {
            setRealtimeMetrics({
              batteryLevel: Math.round(battery.level * 100),
              isCharging: battery.charging,
            });
          };

          updateBattery();
          battery.addEventListener('levelchange', updateBattery);
          battery.addEventListener('chargingchange', updateBattery);
        })
        .catch(() => {
          // Battery API denied or unsupported
        });
    }

    return () => {
      isCancelled = true;
    };
  }, [setRealtimeMetrics]);

  // Tick every second (1000 ms)
  useEffect(() => {
    const updateTick = () => {
      const now = new Date();

      const timeStr = now.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      const dateStr = now.toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });

      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

      setRealtimeMetrics({
        currentTimeString: timeStr,
        currentDateString: dateStr,
        isOnline,
      });

      // Throttle reverse geocoding: at most once every 10 seconds if coordinates exist
      const nowMs = Date.now();
      if (
        currentLocation.lat != null &&
        currentLocation.lng != null &&
        nowMs - lastGeocodeTimeRef.current >= 10000
      ) {
        lastGeocodeTimeRef.current = nowMs;
        reverseGeocode(currentLocation.lat, currentLocation.lng)
          .then((addr) => {
            if (addr) {
              setCurrentLocation({ address: addr });
            }
          })
          .catch(() => {});
      }
    };

    updateTick();
    const intervalId = setInterval(updateTick, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [setRealtimeMetrics, setCurrentLocation, currentLocation.lat, currentLocation.lng]);
}
