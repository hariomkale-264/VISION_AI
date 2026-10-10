/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  Video,
  VideoOff,
  Play,
  RotateCcw,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Clock,
  Volume2,
  HelpCircle,
  FlipHorizontal,
  Flame,
  Activity,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { speechQueue, SpeechPriority } from '../services/speechQueue';
import {
  analyzeFrameWithGemini,
  FrameAnalysisResult,
  formatSpecificError,
} from '../services/gemini';
import { getApiKey, GEMINI_DEFAULT_MODEL, GEMINI_FALLBACK_MODEL } from '../services/apiKey';

const TASK_PRESETS = [
  {
    label: 'Identify & Describe',
    prompt: 'Identify the main object or scene in front of the camera, describe it clearly, and point out any important details.',
  },
  {
    label: 'Obstacle / Hazard Check',
    prompt: 'Describe the obstacles, ground hazards, or pathway conditions visible from a walking perspective.',
  },
  {
    label: 'Read Text (OCR)',
    prompt: 'Read all visible text, labels, numbers, or signs in this camera frame and transcribe them accurately.',
  },
  {
    label: 'Describe Colors & Items',
    prompt: 'List the distinct items seen in this camera frame with their colors, positions, and relative sizes.',
  },
];

export const CameraTestSection: React.FC = () => {
  const highContrast = useAppStore((s) => s.highContrast);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoCaptureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Camera state
  const [isCameraOn, setIsCameraOn] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isMirrored, setIsMirrored] = useState<boolean>(false);

  // Analysis & Prompt state
  const [taskPrompt, setTaskPrompt] = useState<string>(
    'Identify the object in front of the camera and describe it in detail.'
  );
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<FrameAnalysisResult | null>(null);
  const [lastCapturedImage, setLastCapturedImage] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // Auto-capture state (default off, minimum 5 seconds to protect 20 req/day quota)
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState<boolean>(false);
  const [autoCaptureIntervalSec, setAutoCaptureIntervalSec] = useState<number>(10);
  const [countdownSec, setCountdownSec] = useState<number>(10);

  // Session request counter
  const [sessionRequestCount, setSessionRequestCount] = useState<number>(0);

  // Clean stop all camera tracks
  const stopCameraTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {}
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
  }, []);

  // Parse friendly camera errors
  const parseCameraError = (err: any): string => {
    const name = err?.name || '';
    const message = String(err?.message || err);
    if (
      name === 'NotAllowedError' ||
      name === 'PermissionDeniedError' ||
      message.toLowerCase().includes('denied') ||
      message.toLowerCase().includes('permission')
    ) {
      return 'Camera permission was denied. Please allow camera access in your browser or site settings.';
    }
    if (
      name === 'NotFoundError' ||
      name === 'DevicesNotFoundError' ||
      message.toLowerCase().includes('not found')
    ) {
      return 'No camera was found on this device. Please connect a webcam or enable your laptop camera.';
    }
    if (
      name === 'NotReadableError' ||
      name === 'TrackStartError' ||
      message.toLowerCase().includes('in use') ||
      message.toLowerCase().includes('could not start')
    ) {
      return 'Camera is in use by another application (e.g. Zoom, Meet, Teams, or another browser tab). Please close it and retry.';
    }
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      return 'The selected camera does not support this video mode. Please select a different camera from the dropdown.';
    }
    return `Camera error: ${message || name || 'Unable to access video stream'}`;
  };

  // Enumerate video devices
  const updateDeviceList = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      setAvailableDevices(videoInputs);
      if (videoInputs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(videoInputs[0].deviceId);
      }
    } catch (_) {}
  }, [selectedDeviceId]);

  // Listen to device changes
  useEffect(() => {
    updateDeviceList();
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', updateDeviceList);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', updateDeviceList);
      };
    }
  }, [updateDeviceList]);

  // Start camera stream
  const startCamera = useCallback(
    async (deviceIdToUse?: string) => {
      setCameraError(null);
      stopCameraTracks();

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('getUserMedia is not supported by this browser environment.');
        setIsCameraOn(false);
        return;
      }

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: deviceIdToUse ? { exact: deviceIdToUse } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current
              ?.play()
              .then(() => setIsStreaming(true))
              .catch((err) => {
                setCameraError(`Video playback error: ${err.message}`);
              });
          };
        }
        setIsStreaming(true);
        // Refresh device labels if they were blank before permission
        updateDeviceList();
      } catch (err: any) {
        const friendly = parseCameraError(err);
        setCameraError(friendly);
        setIsCameraOn(false);
        stopCameraTracks();
      }
    },
    [stopCameraTracks, updateDeviceList]
  );

  // Toggle Camera
  const handleToggleCamera = () => {
    if (isCameraOn) {
      setIsCameraOn(false);
      setAutoCaptureEnabled(false);
      stopCameraTracks();
      speechQueue.speak('Webcam turned off.', SpeechPriority.STATUS);
    } else {
      setIsCameraOn(true);
      startCamera(selectedDeviceId);
      speechQueue.speak('Webcam starting.', SpeechPriority.STATUS);
    }
  };

  // Change camera device
  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    setSelectedDeviceId(newId);
    if (isCameraOn) {
      startCamera(newId);
    }
  };

  // Capture video frame to base64 JPEG
  const captureFrameBase64 = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (isMirrored) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const parts = dataUrl.split(',');
    return parts[1] || null;
  }, [isMirrored]);

  // Capture & Run action
  const handleCaptureAndRun = useCallback(async () => {
    if (isRunning) return;
    setRunError(null);

    const hasKey = getApiKey();
    if (!hasKey) {
      const err = 'Gemini API key is missing. Please enter or test your key in Settings above.';
      setRunError(err);
      speechQueue.speak('Gemini API key is missing. Add your key above.', SpeechPriority.STATUS);
      return;
    }

    const base64 = captureFrameBase64();
    if (!base64) {
      const err = 'Unable to grab video frame. Make sure the webcam is active and streaming.';
      setRunError(err);
      return;
    }

    setLastCapturedImage(`data:image/jpeg;base64,${base64}`);
    setIsRunning(true);

    try {
      const promptToUse = taskPrompt.trim() || 'Identify the object and describe it in detail';
      const result = await analyzeFrameWithGemini(base64, promptToUse);
      setLastResult(result);
      setSessionRequestCount((c) => c + 1);
      speechQueue.speak('Analysis complete.', SpeechPriority.STATUS);
    } catch (err: any) {
      const formatted = formatSpecificError(err);
      const msg = formatted.spoken || err?.message || 'Failed to analyze camera frame';
      setRunError(msg);
      speechQueue.speak(`Camera analysis failed: ${msg}`, SpeechPriority.STATUS);
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, captureFrameBase64, taskPrompt]);

  // Auto-capture countdown loop
  useEffect(() => {
    if (!autoCaptureEnabled || !isCameraOn || !isStreaming) {
      if (autoCaptureTimerRef.current) {
        clearInterval(autoCaptureTimerRef.current);
        autoCaptureTimerRef.current = null;
      }
      return;
    }

    // Reset initial countdown
    setCountdownSec(autoCaptureIntervalSec);

    autoCaptureTimerRef.current = setInterval(() => {
      setCountdownSec((prev) => {
        if (prev <= 1) {
          // Trigger capture when not currently running
          if (!isRunning) {
            handleCaptureAndRun();
          }
          return autoCaptureIntervalSec;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (autoCaptureTimerRef.current) {
        clearInterval(autoCaptureTimerRef.current);
        autoCaptureTimerRef.current = null;
      }
    };
  }, [autoCaptureEnabled, isCameraOn, isStreaming, autoCaptureIntervalSec, isRunning, handleCaptureAndRun]);

  // Clean up when toggle is turned off or component unmounts or page unloads
  useEffect(() => {
    const handleBeforeUnload = () => {
      stopCameraTracks();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      stopCameraTracks();
      if (autoCaptureTimerRef.current) {
        clearInterval(autoCaptureTimerRef.current);
      }
    };
  }, [stopCameraTracks]);

  return (
    <div
      className={`rounded-[28px] p-6 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05)] transition-all border ${
        highContrast
          ? 'bg-black border-2 border-yellow-400 text-yellow-400'
          : 'bg-white border-gray-100 text-gray-900'
      }`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-gray-100 dark:border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-9 h-9 rounded-2xl flex items-center justify-center ${
              highContrast
                ? 'bg-yellow-400 text-black'
                : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400'
            }`}
          >
            <Camera className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-extrabold text-base tracking-tight flex items-center gap-2">
              <span>Webcam Camera Test</span>
              {isStreaming && (
                <span className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  LIVE
                </span>
              )}
            </h3>
            <p className="text-xs opacity-75">
              Test Gemini Vision with your laptop webcam before deploying. Grab live frames and run tasks.
            </p>
          </div>
        </div>

        {/* Session Request Counter */}
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-bold border ${
              sessionRequestCount >= 18
                ? 'bg-amber-100 border-amber-300 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300'
                : highContrast
                ? 'bg-zinc-900 border-yellow-400 text-yellow-300'
                : 'bg-gray-50 border-gray-200 text-gray-700 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300'
            }`}
            title="Requests sent to Gemini in this session"
          >
            <Activity className="w-3.5 h-3.5 text-indigo-600 dark:text-yellow-400" />
            <span>Session Requests:</span>
            <span className="font-bold text-sm">{sessionRequestCount}</span>
            <span className="text-[10px] opacity-70">/ ~20 free quota</span>
          </div>

          {/* Webcam On / Off Main Toggle */}
          <button
            type="button"
            onClick={handleToggleCamera}
            aria-label={isCameraOn ? 'Turn webcam off' : 'Turn webcam on'}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition min-h-[42px] cursor-pointer shadow-sm ${
              isCameraOn
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : highContrast
                ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            }`}
          >
            {isCameraOn ? (
              <>
                <VideoOff className="w-4 h-4" />
                <span>Turn Camera Off</span>
              </>
            ) : (
              <>
                <Video className="w-4 h-4" />
                <span>Turn Camera On</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Camera Error Banner */}
      {cameraError && (
        <div
          role="alert"
          className="mb-4 p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-900 dark:bg-red-950/60 dark:border-red-900/60 dark:text-red-200 text-xs flex items-start gap-2.5 font-medium"
        >
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <strong className="block font-bold">Camera Access Error</strong>
            <span>{cameraError}</span>
          </div>
          <button
            onClick={() => startCamera(selectedDeviceId)}
            className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-[11px] font-bold hover:bg-red-700 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Device Selector & Preview Controls (visible when camera is on or devices exist) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {/* Device Select */}
        <div className="flex flex-col gap-1">
          <label htmlFor="camera-device-select" className="text-xs font-bold opacity-80">
            Select Camera Device
          </label>
          <select
            id="camera-device-select"
            value={selectedDeviceId}
            onChange={handleDeviceChange}
            disabled={!isCameraOn}
            className={`w-full px-3 py-2 rounded-xl text-xs font-medium border transition ${
              highContrast
                ? 'bg-black border-yellow-400 text-yellow-300'
                : 'bg-gray-50 dark:bg-zinc-900 border-gray-200 dark:border-zinc-700'
            } disabled:opacity-50`}
          >
            {availableDevices.length === 0 ? (
              <option value="">Default Web Camera</option>
            ) : (
              availableDevices.map((dev, i) => (
                <option key={dev.deviceId || i} value={dev.deviceId}>
                  {dev.label || `Camera ${i + 1} (${dev.deviceId ? dev.deviceId.slice(0, 8) + '...' : 'System default'})`}
                </option>
              ))
            )}
          </select>
        </div>

        {/* View Options (Mirror toggle) */}
        <div className="flex items-end justify-between sm:justify-end gap-2">
          <button
            type="button"
            onClick={() => setIsMirrored(!isMirrored)}
            disabled={!isCameraOn}
            aria-label="Toggle mirror preview"
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition ${
              isMirrored
                ? 'bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-950 dark:border-indigo-700 dark:text-indigo-300'
                : 'bg-gray-50 border-gray-200 dark:bg-zinc-900 dark:border-zinc-700'
            } disabled:opacity-40`}
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
            <span>Mirror Video</span>
          </button>

          <button
            type="button"
            onClick={updateDeviceList}
            aria-label="Refresh camera list"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-900 hover:bg-gray-100 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Refresh Devices</span>
          </button>
        </div>
      </div>

      {/* Live Video Preview Box */}
      <div className="mb-4">
        <div
          className={`relative rounded-2xl overflow-hidden bg-black aspect-video max-h-[360px] flex items-center justify-center border ${
            highContrast ? 'border-yellow-400' : 'border-zinc-800'
          }`}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-contain ${isMirrored ? 'scale-x-[-1]' : ''} ${
              !isCameraOn ? 'hidden' : ''
            }`}
          />

          {!isCameraOn && (
            <div className="text-center p-6 text-zinc-400 space-y-2">
              <VideoOff className="w-10 h-10 mx-auto text-zinc-600" />
              <p className="text-xs font-medium">Webcam is currently turned off.</p>
              <button
                type="button"
                onClick={handleToggleCamera}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition shadow"
              >
                Start Webcam Preview
              </button>
            </div>
          )}

          {isCameraOn && !isStreaming && !cameraError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-zinc-300 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></span>
                <span>Connecting to camera stream...</span>
              </div>
            </div>
          )}

          {/* Running / Analyzing Overlay */}
          {isRunning && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center text-white p-4 space-y-2">
              <div className="w-8 h-8 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs font-bold tracking-wide">Sending Frame to Gemini Vision...</p>
              <span className="text-[10px] text-zinc-300 font-mono">
                Model: {GEMINI_DEFAULT_MODEL}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Task Prompt Selection & Custom Input */}
      <div className="space-y-3 mb-4">
        <div className="flex items-center justify-between">
          <label htmlFor="task-prompt-input" className="text-xs font-bold">
            Task Prompt for Gemini:
          </label>
          <span className="text-[11px] opacity-70">
            Customize what Gemini should do with the frame
          </span>
        </div>

        {/* Quick Presets */}
        <div className="flex flex-wrap gap-1.5">
          {TASK_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setTaskPrompt(preset.prompt)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border font-medium transition ${
                taskPrompt === preset.prompt
                  ? 'bg-indigo-600 text-white border-indigo-600 font-bold'
                  : highContrast
                  ? 'border-yellow-400/60 hover:bg-yellow-400 hover:text-black'
                  : 'bg-gray-50 dark:bg-zinc-900 border-gray-200 dark:border-zinc-700 hover:border-indigo-400'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Editable Prompt */}
        <div className="relative">
          <input
            id="task-prompt-input"
            type="text"
            value={taskPrompt}
            onChange={(e) => setTaskPrompt(e.target.value)}
            placeholder="e.g. Identify the object and describe it in detail"
            className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium border transition ${
              highContrast
                ? 'bg-black border-yellow-400 text-yellow-300'
                : 'bg-gray-50 dark:bg-zinc-900 border-gray-200 dark:border-zinc-700'
            } focus:outline-none focus:ring-2 focus:ring-indigo-500`}
          />
        </div>
      </div>

      {/* Action Controls: Capture & Run + Auto-Capture Settings */}
      <div className="p-4 rounded-2xl bg-gray-50 dark:bg-zinc-900/60 border border-gray-200 dark:border-zinc-800 space-y-4 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Main "Capture & Run" Button */}
          <button
            type="button"
            onClick={handleCaptureAndRun}
            disabled={!isCameraOn || !isStreaming || isRunning}
            aria-label="Capture frame and run task with Gemini"
            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-xs sm:text-sm transition shadow-md min-h-[46px] cursor-pointer ${
              !isCameraOn || !isStreaming || isRunning
                ? 'bg-gray-300 dark:bg-zinc-800 text-gray-500 cursor-not-allowed'
                : highContrast
                ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            {isRunning ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                <span>Analyzing Frame...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>Capture &amp; Run</span>
              </>
            )}
          </button>

          {/* Auto-Capture Toggle */}
          <div className="flex items-center gap-3">
            <div className="text-right">
              <label
                htmlFor="auto-capture-toggle"
                className="text-xs font-bold block cursor-pointer"
              >
                Auto-Capture
              </label>
              <span className="text-[11px] opacity-70">
                {autoCaptureEnabled
                  ? `Capturing every ${autoCaptureIntervalSec}s (next in ${countdownSec}s)`
                  : 'Capture automatically on timer'}
              </span>
            </div>

            <input
              id="auto-capture-toggle"
              type="checkbox"
              checked={autoCaptureEnabled}
              disabled={!isCameraOn || !isStreaming}
              onChange={(e) => setAutoCaptureEnabled(e.target.checked)}
              aria-label="Toggle auto-capture timer"
              className="w-5 h-5 accent-indigo-600 cursor-pointer disabled:opacity-40"
            />
          </div>
        </div>

        {/* Auto-Capture Interval Setting (Minimum 5 seconds) */}
        {autoCaptureEnabled && (
          <div className="pt-3 border-t border-gray-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-600 dark:text-yellow-400" />
              <label htmlFor="auto-capture-interval" className="text-xs font-bold">
                Interval (seconds, min 5s):
              </label>
              <span className="text-[11px] opacity-75">
                (Keeps quota safe: ~20 free req/day)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="auto-capture-interval"
                type="range"
                min="5"
                max="60"
                step="1"
                value={autoCaptureIntervalSec}
                onChange={(e) => {
                  const val = Math.max(5, parseInt(e.target.value, 10) || 5);
                  setAutoCaptureIntervalSec(val);
                }}
                className="w-28 sm:w-36 accent-indigo-600 cursor-pointer"
              />
              <span className="text-xs font-mono font-bold w-12 text-right">
                {autoCaptureIntervalSec}s
              </span>

              {/* Live countdown badge */}
              <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 font-mono text-[11px] font-bold">
                ⏱ {countdownSec}s
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Run Error Display */}
      {runError && (
        <div
          role="alert"
          className="mb-4 p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-900 dark:bg-red-950/60 dark:border-red-900/60 dark:text-red-200 text-xs flex items-start gap-2.5 font-medium"
        >
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <strong className="block font-bold">Inference Error</strong>
            <span>{runError}</span>
          </div>
        </div>
      )}

      {/* Result Display Below Preview */}
      {lastResult && (
        <div
          className={`p-4 rounded-2xl border transition-all ${
            highContrast
              ? 'bg-zinc-950 border-yellow-400 text-yellow-300'
              : 'bg-emerald-50/70 border-emerald-200 text-emerald-950 dark:bg-zinc-900/80 dark:border-emerald-800/40 dark:text-emerald-200'
          }`}
        >
          {/* Result Header & Model Badge */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-3 border-b border-emerald-200/60 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600 dark:text-yellow-400 shrink-0" />
              <strong className="text-xs font-bold uppercase tracking-wider">
                Gemini Vision Output
              </strong>
            </div>

            <div className="flex items-center gap-2 text-[11px]">
              <span className="font-mono px-2 py-0.5 rounded-md bg-white dark:bg-black/60 border border-emerald-200 dark:border-zinc-700">
                Model: {lastResult.model} {lastResult.isFallback && '(fallback)'}
              </span>
              <span className="font-mono opacity-70">
                {lastResult.latencyMs}ms
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            {/* Captured Image Thumbnail */}
            {lastCapturedImage && (
              <div className="shrink-0 w-24 sm:w-28">
                <img
                  src={lastCapturedImage}
                  alt="Captured frame sent to Gemini"
                  className="w-full h-auto rounded-xl border border-black/10 dark:border-white/10 object-cover aspect-video"
                />
                <span className="block text-[10px] text-center opacity-60 mt-1">
                  Sent Frame
                </span>
              </div>
            )}

            {/* Answer Text */}
            <div className="flex-1 space-y-3">
              <p className="text-xs sm:text-sm font-medium leading-relaxed whitespace-pre-wrap">
                {lastResult.text}
              </p>

              {/* Action Buttons: Read aloud */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => speechQueue.speak(lastResult.text, SpeechPriority.STATUS)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition shadow-sm"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Read Aloud</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
