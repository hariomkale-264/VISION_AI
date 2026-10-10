/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useCallback } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { useAppStore } from '../store/appStore';
import { useStatsStore, LiveDetectionItem } from '../store/statsStore';
import { getDirection } from '../utils/direction';
import { getDistanceEstimate, getEstimatedMetersString } from '../utils/distance';
import { speechQueue, SpeechPriority } from '../services/speechQueue';
import { audioFeedback } from '../services/audioFeedback';

// Distinct color generator for 80 COCO-SSD classes (supports both spaced and underscore names)
const CLASS_COLORS: Record<string, string> = {
  person: '#3B82F6',
  chair: '#10B981',
  bottle: '#8B5CF6',
  cup: '#06B6D4',
  'wine glass': '#EC4899',
  car: '#EF4444',
  bicycle: '#F59E0B',
  motorcycle: '#F97316',
  airplane: '#6366F1',
  bus: '#EA580C',
  train: '#8B5CF6',
  truck: '#DC2626',
  boat: '#0284C7',
  'traffic light': '#EAB308',
  traffic_light: '#EAB308',
  'fire hydrant': '#EF4444',
  'stop sign': '#DC2626',
  stop_sign: '#DC2626',
  bench: '#14B8A6',
  bird: '#10B981',
  cat: '#F43F5E',
  dog: '#EC4899',
  backpack: '#6366F1',
  umbrella: '#A855F7',
  handbag: '#EC4899',
  tie: '#4F46E5',
  suitcase: '#7C3AED',
  'sports ball': '#F59E0B',
  bottle_cap: '#8B5CF6',
  fork: '#65A30D',
  knife: '#DC2626',
  spoon: '#CA8A04',
  bowl: '#0891B2',
  banana: '#FACC15',
  apple: '#EF4444',
  sandwich: '#F59E0B',
  orange: '#FB923C',
  pizza: '#F87171',
  donut: '#DB2777',
  cake: '#F43F5E',
  couch: '#047857',
  'potted plant': '#16A34A',
  potted_plant: '#16A34A',
  bed: '#6D28D9',
  'dining table': '#B45309',
  dining_table: '#B45309',
  toilet: '#64748B',
  tv: '#4F46E5',
  laptop: '#84CC16',
  mouse: '#7C3AED',
  remote: '#0284C7',
  keyboard: '#059669',
  'cell phone': '#F97316',
  cell_phone: '#F97316',
  microwave: '#475569',
  oven: '#334155',
  toaster: '#EAB308',
  sink: '#0EA5E9',
  refrigerator: '#64748B',
  book: '#D97706',
  clock: '#EA580C',
  vase: '#DB2777',
  scissors: '#DC2626',
  'teddy bear': '#F59E0B',
  'hair drier': '#A855F7',
  toothbrush: '#14B8A6',
  door: '#A855F7',
};

function getClassColor(className: string): string {
  const norm = className.toLowerCase().trim();
  if (CLASS_COLORS[norm]) return CLASS_COLORS[norm];
  const spaced = norm.replace(/_/g, ' ');
  if (CLASS_COLORS[spaced]) return CLASS_COLORS[spaced];
  const underscored = norm.replace(/\s+/g, '_');
  if (CLASS_COLORS[underscored]) return CLASS_COLORS[underscored];

  // Hash to HSL for unknown classes
  let hash = 0;
  for (let i = 0; i < className.length; i++) {
    hash = className.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 75%, 50%)`;
}

export function useObjectDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>
) {
  const detectionActive = useAppStore((s) => s.detectionActive);
  const modelType = useAppStore((s) => s.modelType);
  const confidenceThreshold = useAppStore((s) => s.confidenceThreshold);
  const speakFarObjects = useAppStore((s) => s.speakFarObjects);
  const showDetectionDebug = useAppStore((s) => s.showDetectionDebug);

  const setIsModelLoading = useAppStore((s) => s.setIsModelLoading);
  const setModelLoadError = useAppStore((s) => s.setModelLoadError);
  const setFps = useAppStore((s) => s.setFps);
  const announceAria = useAppStore((s) => s.announceAria);

  const recordObjectDetection = useStatsStore((s) => s.recordObjectDetection);
  const updateLiveDetections = useStatsStore((s) => s.updateLiveDetections);

  const modelRef = useRef<cocoSsd.ObjectDetection | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const isDetectingRef = useRef(false);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Debouncing alerts: key = `${className}_${direction}`, value = timestamp
  const alertDebounceMapRef = useRef<Map<string, number>>(new Map());

  // FPS calculation
  const lastFrameTimeRef = useRef<number>(performance.now());
  const frameCountRef = useRef<number>(0);
  const fpsTimerRef = useRef<number>(performance.now());

  // Load COCO-SSD model with automatic fallback
  const loadModel = useCallback(async () => {
    try {
      setIsModelLoading(true);
      setModelLoadError(null);
      announceAria('Loading vision model');

      await tf.ready();
      const baseModel = modelType === 'lite_mobilenet_v2' ? 'lite_mobilenet_v2' : 'mobilenet_v2';
      try {
        const loadedModel = await cocoSsd.load({ base: baseModel });
        modelRef.current = loadedModel;
      } catch (err) {
        console.warn('Initial model load failed, attempting fallback profile...', err);
        const altModel = baseModel === 'mobilenet_v2' ? 'lite_mobilenet_v2' : 'mobilenet_v2';
        const fallbackLoaded = await cocoSsd.load({ base: altModel });
        modelRef.current = fallbackLoaded;
      }

      setIsModelLoading(false);
      setModelLoadError(null);
      announceAria('Vision model ready');
    } catch (err: any) {
      console.error('Failed to load COCO-SSD model:', err);
      setIsModelLoading(false);
      setModelLoadError(
        'Failed to load on-device vision model. Please check network connection and retry.'
      );
    }
  }, [modelType, setIsModelLoading, setModelLoadError, announceAria]);

  useEffect(() => {
    loadModel();
  }, [loadModel]);

  // Main Detection Loop
  const runDetectionLoop = useCallback(async () => {
    if (!isDetectingRef.current) return;

    // Do not run when document/tab is hidden
    if (typeof document !== 'undefined' && document.hidden) {
      animFrameIdRef.current = requestAnimationFrame(runDetectionLoop);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const model = modelRef.current;

    const now = performance.now();
    // Throttle to ~8-10 FPS (interval ~105 ms) to keep browser smooth and responsive
    if (now - lastFrameTimeRef.current >= 105) {
      lastFrameTimeRef.current = now;
      frameCountRef.current += 1;

      // Update FPS every second
      if (now - fpsTimerRef.current >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / (now - fpsTimerRef.current)));
        frameCountRef.current = 0;
        fpsTimerRef.current = now;
      }

      // Check video is ready: readyState >= 2 (HAVE_CURRENT_DATA) and real dimensions
      if (
        video &&
        canvas &&
        model &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        const vWidth = video.videoWidth;
        const vHeight = video.videoHeight;

        // 1. Maintain offscreen canvas for fallback / downscaling
        const DETECT_WIDTH = 640;
        const detectScale = DETECT_WIDTH / vWidth;
        const detectW = DETECT_WIDTH;
        const detectH = Math.round(vHeight * detectScale);

        if (!offscreenCanvasRef.current) {
          offscreenCanvasRef.current = document.createElement('canvas');
        }
        const offCanvas = offscreenCanvasRef.current;
        if (offCanvas.width !== detectW || offCanvas.height !== detectH) {
          offCanvas.width = detectW;
          offCanvas.height = detectH;
        }

        const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

        try {
          // Query model with sensitive internal threshold (0.12) so everyday non-person objects
          // (bottles, cups, phones, laptops, chairs, books, backpacks) aren't prematurely pruned by NMS
          const queryMinScore = 0.12;
          let rawPredictions: cocoSsd.DetectedObject[] = [];

          try {
            // Direct video element detection runs through WebGL textures with full dynamic range
            rawPredictions = await model.detect(video, 40, queryMinScore);
          } catch (vidDetectErr) {
            // Fallback to offscreen canvas if browser requires canvas tensor conversion
            if (offCtx) {
              offCtx.drawImage(video, 0, 0, detectW, detectH);
              const canvasPreds = await model.detect(offCanvas, 40, queryMinScore);
              rawPredictions = canvasPreds.map((p) => ({
                ...p,
                bbox: [
                  p.bbox[0] / detectScale,
                  p.bbox[1] / detectScale,
                  p.bbox[2] / detectScale,
                  p.bbox[3] / detectScale,
                ] as [number, number, number, number],
              }));
            }
          }

          // Balanced multi-class threshold:
          // Large humans easily score 0.70-0.95+, whereas everyday items (phone, bottle, cup, fork, book, chair)
          // typically score 0.20-0.45. Apply adaptive threshold so non-person items are not silenced or failed.
          const predictions = rawPredictions.filter((p) => {
            const isPerson = p.class.toLowerCase() === 'person';
            const effectiveThreshold = isPerson
              ? confidenceThreshold
              : Math.min(confidenceThreshold, Math.max(0.18, confidenceThreshold * 0.75));
            return p.score >= effectiveThreshold;
          });

          // 2. Set overlay canvas size to match the displayed CSS dimensions
          const dispWidth = canvas.clientWidth || video.clientWidth || vWidth;
          const dispHeight = canvas.clientHeight || video.clientHeight || vHeight;
          if (canvas.width !== dispWidth || canvas.height !== dispHeight) {
            canvas.width = dispWidth;
            canvas.height = dispHeight;
          }

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, dispWidth, dispHeight);

            // Calculate object-cover scale and offsets to align overlay with video accurately
            const coverScale = Math.max(dispWidth / vWidth, dispHeight / vHeight);
            const renderW = vWidth * coverScale;
            const renderH = vHeight * coverScale;
            const offsetX = (dispWidth - renderW) / 2;
            const offsetY = (dispHeight - renderH) / 2;

            const frameArea = vWidth * vHeight;
            const liveItems: LiveDetectionItem[] = [];
            let maxArea = 0;
            let nearestItemIdx = -1;

            // Process each prediction with properly scaled coordinates
            predictions.forEach((pred, index) => {
              // Coordinate values are in video coordinate space
              const [vx, vy, vw, vh] = pred.bbox;

              // Scale from full video coordinates to displayed overlay canvas
              const x = Math.round(offsetX + vx * coverScale);
              const y = Math.round(offsetY + vy * coverScale);
              const w = Math.round(vw * coverScale);
              const h = Math.round(vh * coverScale);

              const boxArea = vw * vh;
              const centerX = vx + vw / 2;
              const direction = getDirection(centerX, vWidth);
              const { label: distanceLabel, ratio } = getDistanceEstimate(boxArea, frameArea, pred.class);
              const distanceMetersStr = getEstimatedMetersString(ratio, pred.class);

              if (boxArea > maxArea) {
                maxArea = boxArea;
                nearestItemIdx = index;
              }

              // Record real object in stats store
              recordObjectDetection(pred.class, [vx, vy, vw, vh], pred.score, direction, distanceMetersStr);

              liveItems.push({
                id: `det-${index}-${pred.class}`,
                className: pred.class,
                direction,
                distanceLabel,
                confidence: pred.score,
                isNearest: false,
                timestamp: Date.now(),
              });

              // Draw bounding box
              const color = getClassColor(pred.class);
              ctx.strokeStyle = color;
              ctx.lineWidth = 3.5;
              ctx.strokeRect(x, y, w, h);

              // Draw filled badge tag with clean class name & confidence percentage
              const displayClass = pred.class.replace(/_/g, ' ');
              const tagText = `${displayClass.toUpperCase()} ${Math.round(pred.score * 100)}%`;
              ctx.font = 'bold 13px "Plus Jakarta Sans", sans-serif';
              const textMetrics = ctx.measureText(tagText);
              const tagHeight = 22;
              const tagWidth = textMetrics.width + 12;

              ctx.fillStyle = color;
              ctx.fillRect(x, Math.max(0, y - tagHeight), tagWidth, tagHeight);

              ctx.fillStyle = '#FFFFFF';
              ctx.fillText(tagText, x + 6, Math.max(15, y - 6));
            });

            // Mark nearest object
            if (nearestItemIdx !== -1 && liveItems[nearestItemIdx]) {
              liveItems[nearestItemIdx].isNearest = true;
            }

            // Update live detections in store
            updateLiveDetections(liveItems);

            // Proximity speech alerts & directional audio feedback for multi-objects
            if (liveItems.length > 0) {
              const currentTime = Date.now();
              const candidatesToSpeak: Array<{
                className: string;
                direction: string;
                distanceLabel: 'very close' | 'close' | 'far';
              }> = [];

              // Priority sorting:
              // 1) Urgency of distance (very close > close > far)
              // 2) Boost non-person objects so everyday items aren't suppressed by a visible person
              const sorted = [...liveItems].sort((a, b) => {
                const getScore = (item: LiveDetectionItem) => {
                  const distW = item.distanceLabel === 'very close' ? 30 : item.distanceLabel === 'close' ? 20 : 10;
                  const nonPersonBoost = item.className.toLowerCase() !== 'person' ? 6 : 0;
                  return distW + nonPersonBoost + item.confidence * 4;
                };
                return getScore(b) - getScore(a);
              });

              for (const item of sorted) {
                // If speakFarObjects is false, skip distant person when other closer objects exist
                if (item.distanceLabel === 'far' && !speakFarObjects && item.className.toLowerCase() === 'person' && sorted.some((s) => s.className.toLowerCase() !== 'person' || s.distanceLabel !== 'far')) {
                  continue;
                }

                const alertKey = `${item.className}_${item.direction}`;
                const lastSpoken = alertDebounceMapRef.current.get(alertKey) || 0;

                if (currentTime - lastSpoken >= 3500) {
                  alertDebounceMapRef.current.set(alertKey, currentTime);
                  candidatesToSpeak.push({
                    className: item.className,
                    direction: item.direction,
                    distanceLabel: item.distanceLabel,
                  });
                  if (candidatesToSpeak.length >= 2) break;
                }
              }

              if (candidatesToSpeak.length > 0) {
                const formatName = (str: string) => str.replace(/_/g, ' ');
                const speechAlert =
                  candidatesToSpeak.length === 1
                    ? `${formatName(candidatesToSpeak[0].className)} ${candidatesToSpeak[0].direction}`
                    : `${formatName(candidatesToSpeak[0].className)} ${candidatesToSpeak[0].direction}, and ${formatName(candidatesToSpeak[1].className)} ${candidatesToSpeak[1].direction}`;

                const nearestLabel = candidatesToSpeak[0].distanceLabel;
                const priority =
                  nearestLabel === 'very close'
                    ? SpeechPriority.URGENT_OBSTACLE
                    : SpeechPriority.STATUS;

                speechQueue.speak(speechAlert, priority);
                audioFeedback.playProximityAlert(nearestLabel);
              }
            } else {
              updateLiveDetections([]);
            }
          }
        } catch (detectionErr) {
          console.warn('Detection execution error:', detectionErr);
        }
      }
    }

    if (isDetectingRef.current) {
      animFrameIdRef.current = requestAnimationFrame(runDetectionLoop);
    }
  }, [
    confidenceThreshold,
    speakFarObjects,
    showDetectionDebug,
    setFps,
    videoRef,
    canvasRef,
    recordObjectDetection,
    updateLiveDetections,
  ]);

  // Tab visibility listener: stop/pause loop when tab is hidden, resume when visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        if (animFrameIdRef.current) {
          cancelAnimationFrame(animFrameIdRef.current);
          animFrameIdRef.current = null;
        }
      } else if (detectionActive && isDetectingRef.current) {
        animFrameIdRef.current = requestAnimationFrame(runDetectionLoop);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [detectionActive, runDetectionLoop]);

  // Toggle detection loop
  useEffect(() => {
    if (detectionActive) {
      isDetectingRef.current = true;
      animFrameIdRef.current = requestAnimationFrame(runDetectionLoop);
    } else {
      isDetectingRef.current = false;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      // Clear canvas when stopped
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      updateLiveDetections([]);
      setFps(0);
    }

    return () => {
      isDetectingRef.current = false;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, [detectionActive, runDetectionLoop, canvasRef, updateLiveDetections, setFps]);

  return {
    modelLoaded: !!modelRef.current,
    retryLoadModel: loadModel,
  };
}
