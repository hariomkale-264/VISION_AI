/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Eye, Navigation, Mic } from 'lucide-react';
import { useStatsStore } from '../store/statsStore';
import { StatCard } from '../components/StatCard';
import { LiveCameraCard } from '../components/LiveCameraCard';
import { VoiceAssistantCard } from '../components/VoiceAssistantCard';
import { NavigationCard } from '../components/NavigationCard';
import { LiveDetectionsTable } from '../components/LiveDetectionsTable';
import { RecentActivitiesCard } from '../components/RecentActivitiesCard';
import { BackupControlButtons } from '../components/BackupControlButtons';
import { formatDistance } from '../utils/haversine';

interface DashboardPageProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isCameraReady: boolean;
  cameraError: string | null;
  onStartDetection: () => void;
  onStopDetection: () => void;
  onStartMic: () => void;
  onStopMic: () => void;
  captureSnapshot: () => string | null;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  videoRef,
  canvasRef,
  isCameraReady,
  cameraError,
  onStartDetection,
  onStopDetection,
  onStartMic,
  onStopMic,
  captureSnapshot,
}) => {
  // Live stats from statsStore
  const objectsDetectedToday = useStatsStore((s) => s.objectsDetectedToday);
  const distanceWalkedMeters = useStatsStore((s) => s.distanceWalkedMeters);
  const voiceCommandsUsed = useStatsStore((s) => s.voiceCommandsUsed);
  const dailyHistory = useStatsStore((s) => s.dailyHistory);

  // Live details for the 3 cards
  const lastDetectedObject = useStatsStore((s) => s.lastDetectedObject);
  const classBreakdown = useStatsStore((s) => s.classBreakdown);
  const gpsAccuracy = useStatsStore((s) => s.gpsAccuracy);
  const isWalking = useStatsStore((s) => s.isWalking);
  const locationPermissionDenied = useStatsStore((s) => s.locationPermissionDenied);
  const lastCommand = useStatsStore((s) => s.lastCommand);

  // 7-day sparkline history including today's live value
  const last6DaysObjects = dailyHistory.slice(-6).map((d) => d.objects);
  const objectHistory = [...last6DaysObjects, objectsDetectedToday];

  const last6DaysDistance = dailyHistory.slice(-6).map((d) => d.distanceMeters);
  const distanceHistory = [...last6DaysDistance, Math.round(distanceWalkedMeters)];

  const last6DaysCommands = dailyHistory.slice(-6).map((d) => d.commands);
  const commandHistory = [...last6DaysCommands, voiceCommandsUsed];

  // Card 1 caption: "Last: Chair, 2.1 m, 10:42 AM" or "No detections yet today"
  const objectsCaption = lastDetectedObject
    ? `Last: ${lastDetectedObject.name}, ${lastDetectedObject.distance}, ${lastDetectedObject.time}`
    : 'No detections yet today';

  // Card 2 caption: "Walking now" / "Standing still", plus GPS accuracy ("GPS ±8 m")
  let distanceCaption = '';
  if (locationPermissionDenied) {
    distanceCaption = 'Location permission needed';
  } else {
    const statusText = isWalking ? 'Walking now' : 'Standing still';
    const accuracyText = gpsAccuracy != null ? `GPS ±${Math.round(gpsAccuracy)} m` : 'GPS active';
    distanceCaption = `${statusText} · ${accuracyText}`;
  }

  // Card 3 caption: Last: "open navigation", 10:44 AM or "No commands yet today"
  const commandsCaption = lastCommand
    ? `Last: "${lastCommand.text}", ${lastCommand.time}`
    : 'No commands yet today';

  // Format distance (under 1000m: "245 m", otherwise: "1.24 km")
  const formattedDistance = formatDistance(distanceWalkedMeters);
  const [distanceNumber, distanceUnit] = formattedDistance.split(' ');

  return (
    <div className="space-y-6">
      {/* 1. Three Real-data Live Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={<Eye className="w-5 h-5 text-sky-400" />}
          label="Objects Detected Today"
          value={objectsDetectedToday}
          caption={objectsCaption}
          history={objectHistory}
          sparklineColor="#38BDF8"
          classBreakdown={classBreakdown}
        />

        <StatCard
          icon={<Navigation className="w-5 h-5 text-amber-400" />}
          label="Distance Walked"
          value={distanceNumber}
          unit={distanceUnit || 'm'}
          caption={distanceCaption}
          history={distanceHistory}
          sparklineColor="#F59E0B"
        />

        <StatCard
          icon={<Mic className="w-5 h-5 text-emerald-400" />}
          label="Voice Commands Used"
          value={voiceCommandsUsed}
          caption={commandsCaption}
          history={commandHistory}
          sparklineColor="#10B981"
        />
      </div>

      {/* Large Accessibility Backup Control Buttons */}
      <BackupControlButtons
        onStartMic={onStartMic}
        onStopMic={onStopMic}
        onStopDetection={onStopDetection}
      />

      {/* 2. Hero Live Camera & Obstacle Vision Section (Expansive, Full Width up to 1400px) */}
      <div className="w-full">
        <LiveCameraCard
          videoRef={videoRef}
          canvasRef={canvasRef}
          isCameraReady={isCameraReady}
          cameraError={cameraError}
          onStartDetection={onStartDetection}
          onStopDetection={onStopDetection}
          captureSnapshot={captureSnapshot}
        />
      </div>

      {/* 3. Voice Assistant & Navigation Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <VoiceAssistantCard
          onStartMic={onStartMic}
          onStopMic={onStopMic}
        />
        <NavigationCard />
      </div>

      {/* 4. Live Detections Section */}
      <div className="w-full">
        <LiveDetectionsTable />
      </div>

      {/* 5. Recent Activities Section */}
      <RecentActivitiesCard />
    </div>
  );
};
