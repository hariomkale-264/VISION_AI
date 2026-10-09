/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Eye, ShieldAlert } from 'lucide-react';
import { useStatsStore } from '../store/statsStore';
import { useAppStore } from '../store/appStore';

export const LiveDetectionsTable: React.FC = () => {
  const liveDetections = useStatsStore((s) => s.liveDetections);
  const highContrast = useAppStore((s) => s.highContrast);

  return (
    <div
      className={`rounded-[24px] p-5 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.15)] transition-all ${
        highContrast
          ? 'bg-black border-2 border-yellow-400 text-yellow-400'
          : 'bg-[#14141C] text-white'
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center">
            <Eye className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <h3 className="font-extrabold text-base tracking-tight">Live Detections</h3>
            <p className="text-xs font-semibold opacity-70">
              Real-time objects in camera field of view
            </p>
          </div>
        </div>

        <span className="text-xs font-mono font-bold bg-white/10 px-3 py-1 rounded-full">
          {liveDetections.length} Detected
        </span>
      </div>

      {liveDetections.length === 0 ? (
        <div className="py-10 text-center flex flex-col items-center justify-center opacity-60">
          <ShieldAlert className="w-8 h-8 mb-2" />
          <p className="text-sm font-semibold">No detections yet</p>
          <p className="text-xs mt-1">
            Turn on detection or point the camera at surroundings to scan objects
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 opacity-70 text-[11px] font-bold uppercase tracking-wider">
                <th className="pb-2.5 px-2">Object</th>
                <th className="pb-2.5 px-2">Direction</th>
                <th className="pb-2.5 px-2">Distance</th>
                <th className="pb-2.5 px-2 text-right">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-medium">
              {liveDetections.map((item) => {
                const isNearest = item.isNearest;

                return (
                  <tr
                    key={item.id}
                    className={`transition-colors ${
                      isNearest
                        ? 'bg-white/15 text-white font-bold'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <td className="py-2.5 px-2 flex items-center gap-2">
                      {isNearest && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-sky-400 text-black font-extrabold uppercase">
                          Nearest
                        </span>
                      )}
                      <span className="capitalize">{item.className}</span>
                    </td>
                    <td className="py-2.5 px-2 capitalize opacity-90">{item.direction}</td>
                    <td className="py-2.5 px-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          item.distanceLabel === 'very close'
                            ? 'bg-red-500/30 text-red-300 border border-red-500/40'
                            : item.distanceLabel === 'close'
                            ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40'
                            : 'bg-emerald-500/20 text-emerald-300'
                        }`}
                      >
                        {item.distanceLabel}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono opacity-80">
                      {Math.round(item.confidence * 100)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
