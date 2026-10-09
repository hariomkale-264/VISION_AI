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
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight">Real-Time Object Detection</h2>
        <p className="text-xs font-semibold opacity-70">
          In-browser COCO-SSD neural network scanning all 80 object classes with 3D directional guidance.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <LiveCameraCard {...props} />
        </div>
        <div className="lg:col-span-1">
          <LiveDetectionsTable />
        </div>
      </div>
    </div>
  );
};
