/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Sparkline } from './Sparkline';
import { useAppStore } from '../store/appStore';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  caption: string;
  history: number[];
  sparklineColor?: string;
  classBreakdown?: Record<string, number>;
}

export const StatCard: React.FC<StatCardProps> = ({
  icon,
  label,
  value,
  unit,
  caption,
  history,
  sparklineColor = '#3B82F6',
  classBreakdown,
}) => {
  const highContrast = useAppStore((s) => s.highContrast);
  const [isHighlighted, setIsHighlighted] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const prevValueRef = useRef(value);

  // Subtle highlight animation on the number when value changes
  useEffect(() => {
    if (prevValueRef.current !== value) {
      prevValueRef.current = value;
      setIsHighlighted(true);
      const timer = setTimeout(() => setIsHighlighted(false), 500);
      return () => clearTimeout(timer);
    }
  }, [value]);

  const hasBreakdown = classBreakdown && Object.keys(classBreakdown).length > 0;
  const breakdownEntries = hasBreakdown ? Object.entries(classBreakdown!) : [];

  return (
    <div
      className={`rounded-[24px] p-5 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05),0_8px_10px_-6px_rgba(0,0,0,0.01)] transition-all ${
        highContrast
          ? 'bg-black border-2 border-yellow-400 text-yellow-400 shadow-none'
          : 'bg-white border border-gray-100/80 text-gray-900'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div
          className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${
            highContrast ? 'bg-yellow-400 text-black' : 'bg-[#14141C] text-white shadow-sm'
          }`}
        >
          {icon}
        </div>
        <Sparkline data={history} color={highContrast ? '#FACC15' : sparklineColor} />
      </div>

      <div className="text-xs font-semibold uppercase tracking-wider mb-1 opacity-75">
        {label}
      </div>

      <div className="flex items-baseline gap-1.5 mb-2">
        <span
          className={`text-3xl font-extrabold tracking-tight transition-all duration-300 transform inline-block ${
            isHighlighted
              ? highContrast
                ? 'scale-110 text-yellow-300 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]'
                : 'scale-110 text-indigo-600 drop-shadow-sm'
              : 'scale-100'
          }`}
        >
          {value}
        </span>
        {unit && <span className="text-sm font-semibold opacity-70">{unit}</span>}
      </div>

      <div
        className={`h-px w-full my-2.5 ${
          highContrast ? 'bg-yellow-400/40' : 'bg-gray-100'
        }`}
      />

      {/* Live caption */}
      <div className="text-xs font-medium flex items-center gap-1.5 opacity-80 min-h-[1.5rem]">
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 inline-block shrink-0" />
        <span className="truncate">{caption}</span>
      </div>

      {/* Optional per-class breakdown expandable section for Card 1 */}
      {hasBreakdown && (
        <div className="mt-2.5 pt-2 border-t border-dashed border-gray-100 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setShowBreakdown((prev) => !prev)}
            aria-expanded={showBreakdown}
            className={`w-full flex items-center justify-between text-[11px] font-bold py-1 px-1.5 rounded-lg transition-colors ${
              highContrast
                ? 'text-yellow-400 hover:bg-yellow-400/10'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span>
              Breakdown ({breakdownEntries.reduce((acc, [, count]) => acc + count, 0)} total)
            </span>
            {showBreakdown ? (
              <ChevronUp className="w-3.5 h-3.5 opacity-70" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            )}
          </button>

          {showBreakdown && (
            <div className="mt-2 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
              {breakdownEntries.map(([cls, count]) => (
                <span
                  key={cls}
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                    highContrast
                      ? 'bg-zinc-900 border-yellow-400/40 text-yellow-300'
                      : 'bg-gray-50 border-gray-200 text-gray-700'
                  }`}
                >
                  {cls} <strong className="font-extrabold ml-0.5">{count}</strong>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
