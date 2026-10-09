/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  color = '#2563EB',
  height = 32,
  width = 84,
}) => {
  const totalDays = 7;
  // Ensure we have a 7-element array or determine which days have real readings
  const rawArray = data || [];
  const paddingX = 6;
  const paddingY = 5;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;
  const step = innerWidth / (totalDays - 1);

  // If completely empty or all zeros
  const hasAnyData = rawArray.length > 0 && rawArray.some((v) => v > 0);

  if (!hasAnyData) {
    const yMid = height / 2;
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
        aria-hidden="true"
      >
        {Array.from({ length: totalDays }).map((_, i) => (
          <circle
            key={i}
            cx={paddingX + i * step}
            cy={yMid}
            r="1.8"
            className="fill-gray-300 dark:fill-zinc-700"
          />
        ))}
      </svg>
    );
  }

  // Normalize data array to 7 slots (pad with 0 at start if less than 7)
  const paddedData =
    rawArray.length < totalDays
      ? [...Array(totalDays - rawArray.length).fill(0), ...rawArray]
      : rawArray.slice(-totalDays);

  // Determine non-zero / active data points
  const minVal = Math.min(...paddedData);
  const maxVal = Math.max(...paddedData);
  const range = maxVal - minVal === 0 ? 1 : maxVal - minVal;

  // Compute point coordinates
  const points = paddedData.map((val, idx) => {
    const x = paddingX + idx * step;
    const y = height - paddingY - ((val - minVal) / range) * innerHeight;
    return { x, y, val };
  });

  const pathD = `M ${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')}`;
  const lastPoint = points[points.length - 1];

  // Missing history index threshold (how many were padded from the left)
  const missingCount = Math.max(0, totalDays - rawArray.length);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      aria-hidden="true"
    >
      {/* Dots for missing days with no historical data */}
      {points.map((p, i) => {
        if (i < missingCount || p.val === 0) {
          return (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="2"
              className="fill-gray-300 dark:fill-zinc-700"
            />
          );
        }
        return null;
      })}

      {/* Sparkline curve */}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Active endpoint dot for today */}
      <circle
        cx={lastPoint.x}
        cy={lastPoint.y}
        r="3.5"
        fill={color}
        className="animate-pulse"
      />
    </svg>
  );
};
