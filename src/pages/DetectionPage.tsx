/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { LiveCameraCard } from '../components/LiveCameraCard';
import { LiveDetectionsTable } from '../components/LiveDetectionsTable';

interface DetectionPageProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isCameraReady: boolean;
  cameraError: string | null;
  onStartDetection: () => void;
  onStopDetection: () => void;
  captureSnapshot: () => string | null;
}

export const DetectionPage: React.FC<DetectionPageProps> = (props) => {
  return (
    <div className="space-y-6 w-full max-w-[1400px] mx-auto">
      <div>
        <h2 className="text-xl sm:text-2xl lg:text-3xl font-black tracking-tight">
          Real-Time Object Detection
        </h2>
        <p className="text-xs sm:text-sm font-semibold opacity-75 mt-1">
          In-browser COCO-SSD neural network scanning all 80 object classes with 3D directional guidance.
        </p>
      </div>

      {/* Main Spacious Detection Screen (up to 1400px on desktop, ~95% width on mobile) */}
      <div className="w-full">
        <LiveCameraCard {...props} />
      </div>

      {/* Live Detections Table */}
      <div className="w-full">
        <LiveDetectionsTable />
      </div>
    </div>
  );
};
