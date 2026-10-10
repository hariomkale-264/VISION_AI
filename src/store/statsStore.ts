/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { calculateHaversineDistance } from '../utils/haversine';

export interface ActivityItem {
  id: string;
  type: 'detection' | 'navigation' | 'voice' | 'emergency' | 'system';
  title: string;
  detail: string;
  timestamp: string; // ISO string
  status: 'Completed' | 'Pending';
}

export interface LiveDetectionItem {
  id: string;
  className: string;
  direction: 'on your left' | 'ahead' | 'on your right';
  distanceLabel: 'very close' | 'close' | 'far';
  confidence: number;
  isNearest: boolean;
  timestamp: number;
}

export interface LastDetectedObjectInfo {
  name: string;
  distance: string;
  time: string;
}

export interface LastCommandInfo {
  text: string;
  time: string;
}

export interface DayRecord {
  date: string; // YYYY-MM-DD
  objects: number;
  distanceMeters: number;
  commands: number;
  classBreakdown?: Record<string, number>;
}

interface TrackedObject {
  className: string;
  x: number;
  y: number;
  lastSeenTime: number;
}

interface StatsState {
  currentDate: string; // Local YYYY-MM-DD
  objectsDetectedToday: number;
  distanceWalkedMeters: number;
  voiceCommandsUsed: number;
  dailyHistory: DayRecord[]; // Last 7 days history

  // Card 1 live details
  lastDetectedObject: LastDetectedObjectInfo | null;
  classBreakdown: Record<string, number>;

  // Card 2 live details
  gpsAccuracy: number | null;
  isWalking: boolean;
  locationPermissionDenied: boolean;
  strideLength: number; // default 0.7m

  // Card 3 live details
  lastCommand: LastCommandInfo | null;

  // General app telemetry
  recentActivities: ActivityItem[];
  liveDetections: LiveDetectionItem[];

  // Internal tracking states (not persisted)
  lastGpsPoint: { lat: number; lng: number; accuracy: number; time: number } | null;
  lastValidGpsTime: number;
  lastStepTime: number;
  trackedObjects: TrackedObject[];

  // Actions
  recordObjectDetection: (
    className: string,
    bbox: [number, number, number, number],
    confidence: number,
    direction?: 'on your left' | 'ahead' | 'on your right',
    distanceText?: string
  ) => boolean;
  updateLiveDetections: (items: LiveDetectionItem[]) => void;
  recordGpsPosition: (lat: number, lng: number, accuracy: number, speed?: number) => number;
  recordStepFallback: () => boolean;
  recordVoiceCommandSuccess: (commandText: string, summary?: string) => void;
  setLocationPermissionDenied: (denied: boolean) => void;
  setStrideLength: (length: number) => void;
  addActivity: (activity: Omit<ActivityItem, 'id' | 'timestamp'>) => void;
  resetTodayStats: () => void;
  checkAndRolloverDate: () => void;
}

// Get local date YYYY-MM-DD
export const getLocalDateString = (): string => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const formatTimeShort = (date: Date = new Date()): string => {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
};

export const useStatsStore = create<StatsState>()(
  persist(
    (set, get) => ({
      currentDate: getLocalDateString(),
      objectsDetectedToday: 0,
      distanceWalkedMeters: 0,
      voiceCommandsUsed: 0,
      dailyHistory: [],

      lastDetectedObject: null,
      classBreakdown: {},

      gpsAccuracy: null,
      isWalking: false,
      locationPermissionDenied: false,
      strideLength: 0.7,

      lastCommand: null,

      recentActivities: [],
      liveDetections: [],

      lastGpsPoint: null,
      lastValidGpsTime: 0,
      lastStepTime: 0,
      trackedObjects: [],

      checkAndRolloverDate: () => {
        const today = getLocalDateString();
        const state = get();
        if (state.currentDate !== today) {
          // Archive yesterday's real stats into dailyHistory (up to 7 days)
          const yesterdayRecord: DayRecord = {
            date: state.currentDate,
            objects: state.objectsDetectedToday,
            distanceMeters: Math.round(state.distanceWalkedMeters),
            commands: state.voiceCommandsUsed,
            classBreakdown: { ...state.classBreakdown },
          };

          const newHistory = [
            ...state.dailyHistory.filter((h) => h.date !== state.currentDate),
            yesterdayRecord,
          ]
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-7);

          set({
            currentDate: today,
            objectsDetectedToday: 0,
            distanceWalkedMeters: 0,
            voiceCommandsUsed: 0,
            dailyHistory: newHistory,
            lastDetectedObject: null,
            classBreakdown: {},
            lastCommand: null,
            lastGpsPoint: null,
            lastValidGpsTime: 0,
            lastStepTime: 0,
            trackedObjects: [],
            isWalking: false,
          });
        }
      },

      recordObjectDetection: (className, bbox, confidence, direction = 'ahead', distanceText = '2.1 m') => {
        // Count detections with confidence of 0.20 or higher (or 0.25 for person)
        const minConf = className.toLowerCase() === 'person' ? 0.25 : 0.20;
        if (confidence < minConf) {
          return false;
        }

        get().checkAndRolloverDate();
        const now = Date.now();
        const [x, y, w, h] = bbox;
        const centerX = x + w / 2;
        const centerY = y + h / 2;

        const state = get();
        const existingTracked = state.trackedObjects;

        // Simple tracking: an object of same class at similar position (center within ~80px)
        // seen in the last 3 seconds is the SAME object.
        // Only count it again if it disappears for more than 3 seconds and returns.
        const matchIdx = existingTracked.findIndex((item) => {
          if (item.className.toLowerCase() !== className.toLowerCase()) return false;
          const dist = Math.hypot(item.x - centerX, item.y - centerY);
          return dist <= 80;
        });

        if (matchIdx !== -1) {
          const match = existingTracked[matchIdx];
          const timeSinceLastSeen = now - match.lastSeenTime;

          if (timeSinceLastSeen <= 3000) {
            // Seen in the last 3 seconds -> SAME object, update position and timestamp, DO NOT increment
            const updated = [...existingTracked];
            updated[matchIdx] = {
              ...match,
              x: centerX,
              y: centerY,
              lastSeenTime: now,
            };
            set({ trackedObjects: updated });
            return false;
          } else {
            // Disappeared for more than 3 seconds and returned! Count as NEW object
            const updated = [...existingTracked];
            updated[matchIdx] = {
              ...match,
              x: centerX,
              y: centerY,
              lastSeenTime: now,
            };

            const newCount = state.objectsDetectedToday + 1;
            const updatedBreakdown = {
              ...state.classBreakdown,
              [className]: (state.classBreakdown[className] || 0) + 1,
            };

            const capName = className.charAt(0).toUpperCase() + className.slice(1);
            const formattedTime = formatTimeShort(new Date());

            const newActivity: ActivityItem = {
              id: `act-obj-${now}-${Math.random().toString(36).substring(2, 6)}`,
              type: 'detection',
              title: `Detected ${capName}`,
              detail: `${direction}, ${distanceText} (${Math.round(confidence * 100)}% conf)`,
              timestamp: new Date().toISOString(),
              status: 'Completed',
            };

            set({
              objectsDetectedToday: newCount,
              classBreakdown: updatedBreakdown,
              lastDetectedObject: {
                name: capName,
                distance: distanceText,
                time: formattedTime,
              },
              trackedObjects: updated.filter((item) => now - item.lastSeenTime <= 20000),
              recentActivities: [newActivity, ...state.recentActivities.slice(0, 39)],
            });

            return true;
          }
        }

        // New object never seen or not matched near center
        const newTrack: TrackedObject = {
          className,
          x: centerX,
          y: centerY,
          lastSeenTime: now,
        };

        const newCount = state.objectsDetectedToday + 1;
        const updatedBreakdown = {
          ...state.classBreakdown,
          [className]: (state.classBreakdown[className] || 0) + 1,
        };

        const capName = className.charAt(0).toUpperCase() + className.slice(1);
        const formattedTime = formatTimeShort(new Date());

        const newActivity: ActivityItem = {
          id: `act-obj-${now}-${Math.random().toString(36).substring(2, 6)}`,
          type: 'detection',
          title: `Detected ${capName}`,
          detail: `${direction}, ${distanceText} (${Math.round(confidence * 100)}% conf)`,
          timestamp: new Date().toISOString(),
          status: 'Completed',
        };

        set({
          objectsDetectedToday: newCount,
          classBreakdown: updatedBreakdown,
          lastDetectedObject: {
            name: capName,
            distance: distanceText,
            time: formattedTime,
          },
          trackedObjects: [...existingTracked.filter((item) => now - item.lastSeenTime <= 20000), newTrack],
          recentActivities: [newActivity, ...state.recentActivities.slice(0, 39)],
        });

        return true;
      },

      updateLiveDetections: (items) => {
        set({ liveDetections: items });
      },

      recordGpsPosition: (lat, lng, accuracy, speed) => {
        get().checkAndRolloverDate();
        const now = Date.now();
        const state = get();

        set({ gpsAccuracy: accuracy, locationPermissionDenied: false });

        // 1. Ignore readings with accuracy worse than 25 m
        if (!accuracy || accuracy > 25) {
          return 0;
        }

        // 2. Ignore the first reading, which is only the starting point
        if (!state.lastGpsPoint) {
          set({
            lastGpsPoint: { lat, lng, accuracy, time: now },
            lastValidGpsTime: now,
            isWalking: speed != null && speed > 0.3,
          });
          return 0;
        }

        const prev = state.lastGpsPoint;
        const timeDeltaSec = (now - prev.time) / 1000;
        const distMeters = calculateHaversineDistance(prev.lat, prev.lng, lat, lng);

        // 3. Ignore movement smaller than max(3 m, accuracy / 2)
        const minThreshold = Math.max(3, accuracy / 2);
        if (distMeters < minThreshold) {
          // Stationary or noise jitter
          set({
            isWalking: speed != null ? speed > 0.3 : false,
          });
          return 0;
        }

        // 4. Ignore jumps implying a speed above 3 m/s (running speed) as GPS errors
        if (timeDeltaSec > 0) {
          const impliedSpeed = distMeters / timeDeltaSec;
          if (impliedSpeed > 3.0) {
            // Update reference point so future movements calculate correctly, but do not count jump
            set({
              lastGpsPoint: { lat, lng, accuracy, time: now },
              lastValidGpsTime: now,
            });
            return 0;
          }
        }

        // Valid physical walking movement
        const newDistance = state.distanceWalkedMeters + distMeters;
        const isWalking = speed != null ? speed > 0.3 : true;

        set({
          distanceWalkedMeters: newDistance,
          lastGpsPoint: { lat, lng, accuracy, time: now },
          lastValidGpsTime: now,
          isWalking,
        });

        return distMeters;
      },

      recordStepFallback: () => {
        get().checkAndRolloverDate();
        const now = Date.now();
        const state = get();

        // If good GPS was acquired in the last 4 seconds, do NOT count steps
        // (Use GPS when accuracy is good, otherwise steps. Never count both for the same movement)
        const hasRecentGoodGps =
          state.lastValidGpsTime > 0 &&
          now - state.lastValidGpsTime < 4000 &&
          state.gpsAccuracy != null &&
          state.gpsAccuracy <= 25;

        if (hasRecentGoodGps) {
          set({ isWalking: true, lastStepTime: now });
          return false;
        }

        // GPS is unavailable or accuracy is poor -> add step distance
        const stepDist = state.strideLength > 0 ? state.strideLength : 0.7;
        const newDist = state.distanceWalkedMeters + stepDist;

        set({
          distanceWalkedMeters: newDist,
          isWalking: true,
          lastStepTime: now,
        });

        return true;
      },

      recordVoiceCommandSuccess: (commandText, summary) => {
        get().checkAndRolloverDate();
        const state = get();
        const newCount = state.voiceCommandsUsed + 1;
        const now = Date.now();
        const formattedTime = formatTimeShort(new Date());

        const cleanCmd = (commandText || 'Voice command').replace(/^["']|["']$/g, '').trim();

        const newActivity: ActivityItem = {
          id: `act-cmd-${now}-${Math.random().toString(36).substring(2, 6)}`,
          type: 'voice',
          title: `Command: "${cleanCmd}"`,
          detail: summary || 'Executed successfully',
          timestamp: new Date().toISOString(),
          status: 'Completed',
        };

        set({
          voiceCommandsUsed: newCount,
          lastCommand: {
            text: cleanCmd,
            time: formattedTime,
          },
          recentActivities: [newActivity, ...state.recentActivities.slice(0, 39)],
        });
      },

      setLocationPermissionDenied: (denied) => {
        set({ locationPermissionDenied: denied });
      },

      setStrideLength: (length) => {
        const clamped = Math.max(0.3, Math.min(1.5, Math.round(length * 100) / 100));
        set({ strideLength: clamped });
      },

      addActivity: (activity) => {
        const state = get();
        const newActivity: ActivityItem = {
          ...activity,
          id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: new Date().toISOString(),
        };
        set({
          recentActivities: [newActivity, ...state.recentActivities.slice(0, 39)],
        });
      },

      resetTodayStats: () => {
        set({
          objectsDetectedToday: 0,
          distanceWalkedMeters: 0,
          voiceCommandsUsed: 0,
          lastDetectedObject: null,
          classBreakdown: {},
          lastCommand: null,
          lastGpsPoint: null,
          lastValidGpsTime: 0,
          lastStepTime: 0,
          trackedObjects: [],
          isWalking: false,
        });
      },
    }),
    {
      name: 'vision_ai_stats',
      partialize: (state) => ({
        currentDate: state.currentDate,
        objectsDetectedToday: state.objectsDetectedToday,
        distanceWalkedMeters: state.distanceWalkedMeters,
        voiceCommandsUsed: state.voiceCommandsUsed,
        dailyHistory: state.dailyHistory,
        lastDetectedObject: state.lastDetectedObject,
        classBreakdown: state.classBreakdown,
        lastCommand: state.lastCommand,
        strideLength: state.strideLength,
        recentActivities: state.recentActivities,
      }),
    }
  )
);

// Automatic midnight rollover timer
if (typeof window !== 'undefined') {
  setInterval(() => {
    useStatsStore.getState().checkAndRolloverDate();
  }, 20000);
}
