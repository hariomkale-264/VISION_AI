/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';

export function useWakeLock(enabled: boolean) {
  const sentinelRef = useRef<any>(null);
  const setWakeLockActive = useAppStore((s) => s.setWakeLockActive);

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      if (sentinelRef.current) {
        sentinelRef.current.release().catch(() => {});
        sentinelRef.current = null;
        setWakeLockActive(false);
      }
      return;
    }

    let isCancelled = false;

    const requestLock = async () => {
      try {
        if (document.visibilityState === 'visible') {
          const lock = await (navigator as any).wakeLock.request('screen');
          if (isCancelled) {
            lock.release();
            return;
          }
          sentinelRef.current = lock;
          setWakeLockActive(true);
          lock.addEventListener('release', () => {
            setWakeLockActive(false);
          });
        }
      } catch (err) {
        console.warn('Wake Lock request error:', err);
      }
    };

    requestLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && enabled) {
        requestLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isCancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (sentinelRef.current) {
        sentinelRef.current.release().catch(() => {});
        sentinelRef.current = null;
        setWakeLockActive(false);
      }
    };
  }, [enabled, setWakeLockActive]);
}
