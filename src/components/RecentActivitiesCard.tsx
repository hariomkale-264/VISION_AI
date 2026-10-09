/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { History, Eye, Navigation, Mic, AlertTriangle } from 'lucide-react';
import { useStatsStore, ActivityItem } from '../store/statsStore';
import { useAppStore } from '../store/appStore';

export const RecentActivitiesCard: React.FC = () => {
  const recentActivities = useStatsStore((s) => s.recentActivities);
  const highContrast = useAppStore((s) => s.highContrast);

  const getActivityIcon = (type: ActivityItem['type']) => {
    switch (type) {
      case 'detection':
        return <Eye className="w-4 h-4 text-sky-400" />;
      case 'navigation':
        return <Navigation className="w-4 h-4 text-amber-400" />;
      case 'voice':
        return <Mic className="w-4 h-4 text-emerald-400" />;
      case 'emergency':
        return <AlertTriangle className="w-4 h-4 text-red-400" />;
      default:
        return <History className="w-4 h-4 text-indigo-400" />;
    }
  };

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return 'Just now';
    }
  };

  return (
    <div
      className={`rounded-[24px] p-5 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05),0_8px_10px_-6px_rgba(0,0,0,0.01)] transition-all ${
        highContrast
          ? 'bg-black border-2 border-yellow-400 text-yellow-400'
          : 'bg-white border border-gray-100 text-gray-900'
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
              highContrast ? 'bg-yellow-400 text-black' : 'bg-[#14141C] text-white shadow-sm'
            }`}
          >
            <History className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h3 className="font-extrabold text-base tracking-tight">Recent Activities</h3>
            <p className="text-xs font-semibold opacity-70">
              Verified real events logged today
            </p>
          </div>
        </div>
      </div>

      {recentActivities.length === 0 ? (
        <div className="py-10 text-center flex flex-col items-center justify-center opacity-60">
          <History className="w-8 h-8 mb-2" />
          <p className="text-sm font-semibold">No activities yet</p>
          <p className="text-xs mt-1">Actions taken via voice or camera will appear here</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          {recentActivities.slice(0, 10).map((act) => (
            <div
              key={act.id}
              className={`p-3 rounded-2xl flex items-center justify-between gap-3 border transition-colors ${
                highContrast
                  ? 'bg-zinc-900 border-yellow-400/40 text-yellow-300'
                  : 'bg-gray-50/80 border-gray-100 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="w-8 h-8 rounded-full bg-[#14141C] flex items-center justify-center shrink-0 shadow-sm">
                  {getActivityIcon(act.type)}
                </div>
                <div className="truncate">
                  <h4 className="text-xs font-bold truncate">{act.title}</h4>
                  <p className="text-[11px] opacity-70 truncate">{act.detail}</p>
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="text-[10px] font-mono opacity-60 block">
                  {formatTimestamp(act.timestamp)}
                </span>
                <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-800">
                  {act.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
