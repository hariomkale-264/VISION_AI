/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { registerCameraSnapshotProvider } from '../services/intentRouter';

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const setVideoResolution = useAppStore((s) => s.setVideoResolution);

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      // Try environment (rear) camera first, with automatic fallback for laptop webcams
      let stream: MediaStream;
      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (firstErr) {
        // Fallback for laptops/desktops or devices without rear cameras
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          if (videoRef.current) {
            videoRef.current.play().catch(() => {});
            setIsCameraReady(true);
            setVideoResolution({
              width: videoRef.current.videoWidth,
              height: videoRef.current.videoHeight,
            });
          }
        };
      }
    } catch (err: any) {
      console.warn('Camera access error:', err);
      let errMsg = 'Unable to access camera.';
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        errMsg = 'Camera permission denied. Please allow camera access in your browser settings.';
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        errMsg = 'No camera found on this device.';
      } else if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
        errMsg = 'Camera is in use by another application or hardware is busy.';
      } else if (err?.message) {
        errMsg = err.message;
      }
      setCameraError(errMsg);
      setIsCameraReady(false);
    }
  }, [setVideoResolution]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraReady(false);
  }, []);

  /**
   * Generates a JPEG base64 snapshot (~640px wide) for Gemini Vision.
   */
  const captureSnapshot = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    // Sensible processing size (~640px wide)
    const targetW = 640;
    const aspect = video.videoHeight / video.videoWidth;
    const targetH = Math.round(targetW * aspect);

    const offscreen = document.createElement('canvas');
    offscreen.width = targetW;
    offscreen.height = targetH;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, targetW, targetH);
    const dataUrl = offscreen.toDataURL('image/jpeg', 0.85);
    // Strip data:image/jpeg;base64, prefix
    return dataUrl.split(',')[1] || null;
  }, []);

  // Register snapshot getter for intentRouter
  useEffect(() => {
    return registerCameraSnapshotProvider(captureSnapshot);
  }, [captureSnapshot]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return {
    videoRef,
    isCameraReady,
    cameraError,
    startCamera,
    stopCamera,
    captureSnapshot,
  };
}
