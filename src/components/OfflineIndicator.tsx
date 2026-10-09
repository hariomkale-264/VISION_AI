/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 lg:bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-2xl bg-amber-600 px-4 py-2.5 text-xs font-bold text-white shadow-xl animate-bounce"
    >
      <WifiOff className="w-4 h-4" />
      <span>Offline Mode — On-device vision detection remains active.</span>
    </div>
  );
};
