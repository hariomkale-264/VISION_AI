/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { speechQueue, SpeechPriority } from '../services/speechQueue';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      speechQueue.speak('Internet connection restored.', SpeechPriority.STATUS);
    };

    const handleOffline = () => {
      setIsOnline(false);
      speechQueue.speak('You are currently offline. Local obstacle detection is still active.', SpeechPriority.STATUS);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
