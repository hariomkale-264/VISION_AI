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
  const setFps = useAppStore((s) => s.setFps);
  const announceAria = useAppStore((s) => s.announceAria);

  const recordObjectDetection = useStatsStore((s) => s.recordObjectDetection);
  const updateLiveDetections = useStatsStore((s) => s.updateLiveDetections);

  const modelRef = useRef<cocoSsd.ObjectDetection | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const isDetectingRef = useRef(false);

  // Debouncing alerts: key = `${className}_${direction}`, value = timestamp
  const alertDebounceMapRef = useRef<Map<string, number>>(new Map());

  // FPS calculation
  const lastFrameTimeRef = useRef<number>(performance.now());
  const frameCountRef = useRef<number>(0);
  const fpsTimerRef = useRef<number>(performance.now());

  // Load COCO-SSD model
  useEffect(() => {
    let isCancelled = false;

    const loadModel = async () => {
      try {
        setIsModelLoading(true);
        announceAria('Loading vision model');

        await tf.ready();
        const baseModel = modelType === 'lite_mobilenet_v2' ? 'lite_mobilenet_v2' : 'mobilenet_v2';
        const loadedModel = await cocoSsd.load({ base: baseModel });

        if (!isCancelled) {
          modelRef.current = loadedModel;
          setIsModelLoading(false);
          announceAria('Vision model ready');
        }
      } catch (err) {
        console.error('Failed to load COCO-SSD model:', err);
        setIsModelLoading(false);
      }
    };

    loadModel();

    return () => {
      isCancelled = true;
    };
  }, [modelType, setIsModelLoading, announceAria]);

  // Main Detection Loop
  const runDetectionLoop = useCallback(async () => {
    if (!isDetectingRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const model = modelRef.current;

    const now = performance.now();
    // Throttle to ~8-10 FPS (interval ~110 ms)
    if (now - lastFrameTimeRef.current >= 105) {
      lastFrameTimeRef.current = now;
      frameCountRef.current += 1;

      // Update FPS every second
      if (now - fpsTimerRef.current >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / (now - fpsTimerRef.current)));
        frameCountRef.current = 0;
        fpsTimerRef.current = now;
      }

      if (
        video &&
        canvas &&
        model &&
        video.readyState === 4 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        const vWidth = video.videoWidth;
        const vHeight = video.videoHeight;

        // Match canvas dimensions to video
        if (canvas.width !== vWidth || canvas.height !== vHeight) {
          canvas.width = vWidth;
          canvas.height = vHeight;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, vWidth, vHeight);

          try {
            // Detect up to 20 objects across all 80 COCO classes
            const predictions = await model.detect(video, 20, confidenceThreshold);

            const frameArea = vWidth * vHeight;
            const liveItems: LiveDetectionItem[] = [];
            let maxArea = 0;
            let nearestItemIdx = -1;

            // 1. Process and draw predictions
            predictions.forEach((pred, index) => {
              const [x, y, w, h] = pred.bbox;
              const boxArea = w * h;
              const centerX = x + w / 2;

              const direction = getDirection(centerX, vWidth);
              const { label: distanceLabel, ratio } = getDistanceEstimate(boxArea, frameArea);
              const distanceMetersStr = getEstimatedMetersString(ratio);

              if (boxArea > maxArea) {
                maxArea = boxArea;
                nearestItemIdx = index;
              }

              // Record real object in stats store (simple tracking: 3s window, 80px distance, conf >= 0.5)
              recordObjectDetection(pred.class, pred.bbox, pred.score, direction, distanceMetersStr);

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

              // Draw filled badge tag
              const tagText = `${pred.class.toUpperCase()} ${Math.round(pred.score * 100)}%`;
              ctx.font = 'bold 14px "Plus Jakarta Sans", sans-serif';
              const textMetrics = ctx.measureText(tagText);
              const tagHeight = 22;
              const tagWidth = textMetrics.width + 14;

              ctx.fillStyle = color;
              ctx.fillRect(x, Math.max(0, y - tagHeight), tagWidth, tagHeight);

              ctx.fillStyle = '#FFFFFF';
              ctx.fillText(tagText, x + 7, Math.max(16, y - 5));
            });

            // Mark nearest
            if (nearestItemIdx !== -1 && liveItems[nearestItemIdx]) {
              liveItems[nearestItemIdx].isNearest = true;
            }

            // Update live detections in store
            updateLiveDetections(liveItems);

            // 2. Handle speech alerts & proximity audio feedback
            if (liveItems.length > 0) {
              const currentTime = Date.now();
              const candidatesToSpeak: Array<{
                className: string;
                direction: string;
                distanceLabel: 'very close' | 'close' | 'far';
              }> = [];

              // Sort by proximity: very close first, then close, then far
              const sorted = [...liveItems].sort((a, b) => {
                const weight = (l: string) => (l === 'very close' ? 3 : l === 'close' ? 2 : 1);
                return weight(b.distanceLabel) - weight(a.distanceLabel);
              });

              for (const item of sorted) {
                // If far and user disabled far speaking and closer items exist, skip
                if (item.distanceLabel === 'far' && !speakFarObjects && sorted.some((s) => s.distanceLabel !== 'far')) {
                  continue;
                }

                // Debounce per class AND direction every 4 seconds
                const alertKey = `${item.className}_${item.direction}`;
                const lastSpoken = alertDebounceMapRef.current.get(alertKey) || 0;

                if (currentTime - lastSpoken >= 4000) {
                  alertDebounceMapRef.current.set(alertKey, currentTime);
                  candidatesToSpeak.push({
                    className: item.className,
                    direction: item.direction,
                    distanceLabel: item.distanceLabel,
                  });
                  if (candidatesToSpeak.length >= 2) break; // Combine up to 2 items
                }
              }

              // Speak combined alert if any candidate found
              if (candidatesToSpeak.length > 0) {
                let speechAlert = '';
                if (candidatesToSpeak.length === 1) {
                  speechAlert = `${candidatesToSpeak[0].className} ${candidatesToSpeak[0].direction}`;
                } else {
                  speechAlert = `${candidatesToSpeak[0].className} ${candidatesToSpeak[0].direction} and ${candidatesToSpeak[1].className} ${candidatesToSpeak[1].direction}`;
                }

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
  };
}
