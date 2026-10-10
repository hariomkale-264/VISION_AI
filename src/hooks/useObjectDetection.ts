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

// Distinct color generator for classes
const CLASS_COLORS: Record<string, string> = {
  person: '#3B82F6',
  chair: '#10B981',
  bottle: '#8B5CF6',
  car: '#EF4444',
  bicycle: '#F59E0B',
  dog: '#EC4899',
  cat: '#06B6D4',
  bench: '#14B8A6',
  backpack: '#6366F1',
  cell_phone: '#F97316',
  laptop: '#84CC16',
  traffic_light: '#EAB308',
  stop_sign: '#DC2626',
  door: '#A855F7',
};

function getClassColor(className: string): string {
  if (CLASS_COLORS[className]) return CLASS_COLORS[className];
  // Hash to HSL
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

  // Load COCO-SSD model
  const loadModel = useCallback(async () => {
    try {
      setIsModelLoading(true);
      setModelLoadError(null);
      announceAria('Loading vision model');

      await tf.ready();
      const baseModel = modelType === 'lite_mobilenet_v2' ? 'lite_mobilenet_v2' : 'mobilenet_v2';
      const loadedModel = await cocoSsd.load({ base: baseModel });

      modelRef.current = loadedModel;
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

        // 1. Draw frame to an offscreen canvas at a sensible size (~640px wide)
        // Passing downscaled frame avoids freezing main thread on 1080p/4K feeds
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
        if (offCtx) {
          offCtx.drawImage(video, 0, 0, detectW, detectH);

          try {
            // Run on-device COCO-SSD detection on downscaled canvas (0 API calls!)
            const rawPredictions = await model.detect(offCanvas, 20, confidenceThreshold);

            // Filter out predictions below confidence threshold (default 0.5)
            const predictions = rawPredictions.filter((p) => p.score >= confidenceThreshold);

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
                const [px, py, pw, ph] = pred.bbox;

                // Scale from offscreen canvas coordinates back to full video coordinates
                const vx = px / detectScale;
                const vy = py / detectScale;
                const vw = pw / detectScale;
                const vh = ph / detectScale;

                // Scale from full video coordinates to displayed overlay canvas
                const x = Math.round(offsetX + vx * coverScale);
                const y = Math.round(offsetY + vy * coverScale);
                const w = Math.round(vw * coverScale);
                const h = Math.round(vh * coverScale);

                const boxArea = vw * vh;
                const centerX = vx + vw / 2;
                const direction = getDirection(centerX, vWidth);
                const { label: distanceLabel, ratio } = getDistanceEstimate(boxArea, frameArea);
                const distanceMetersStr = getEstimatedMetersString(ratio);

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

                // Draw filled badge tag with class name & confidence percentage
                const tagText = `${pred.class.toUpperCase()} ${Math.round(pred.score * 100)}%`;
                ctx.font = 'bold 14px "Plus Jakarta Sans", sans-serif';
                const textMetrics = ctx.measureText(tagText);
                const tagHeight = 24;
                const tagWidth = textMetrics.width + 14;

                ctx.fillStyle = color;
                ctx.fillRect(x, Math.max(0, y - tagHeight), tagWidth, tagHeight);

                ctx.fillStyle = '#FFFFFF';
                ctx.fillText(tagText, x + 7, Math.max(16, y - 6));
              });

              // Mark nearest object
              if (nearestItemIdx !== -1 && liveItems[nearestItemIdx]) {
                liveItems[nearestItemIdx].isNearest = true;
              }

              // Update live detections in store
              updateLiveDetections(liveItems);

              // Proximity speech alerts & directional audio feedback
              if (liveItems.length > 0) {
                const currentTime = Date.now();
                const candidatesToSpeak: Array<{
                  className: string;
                  direction: string;
                  distanceLabel: 'very close' | 'close' | 'far';
                }> = [];

                const sorted = [...liveItems].sort((a, b) => {
                  const weight = (l: string) => (l === 'very close' ? 3 : l === 'close' ? 2 : 1);
                  return weight(b.distanceLabel) - weight(a.distanceLabel);
                });

                for (const item of sorted) {
                  if (item.distanceLabel === 'far' && !speakFarObjects && sorted.some((s) => s.distanceLabel !== 'far')) {
                    continue;
                  }

                  const alertKey = `${item.className}_${item.direction}`;
                  const lastSpoken = alertDebounceMapRef.current.get(alertKey) || 0;

                  if (currentTime - lastSpoken >= 4000) {
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
                  const speechAlert =
                    candidatesToSpeak.length === 1
                      ? `${candidatesToSpeak[0].className} ${candidatesToSpeak[0].direction}`
                      : `${candidatesToSpeak[0].className} ${candidatesToSpeak[0].direction} and ${candidatesToSpeak[1].className} ${candidatesToSpeak[1].direction}`;

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
