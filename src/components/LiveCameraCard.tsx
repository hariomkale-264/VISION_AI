/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Camera,
  Eye,
  EyeOff,
  Sparkles,
  Type,
  Sliders,
  RefreshCw,
  AlertCircle,
  Volume2,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useStatsStore } from '../store/statsStore';
import { describeSurroundings, readTextFromImage, formatSpecificError } from '../services/gemini';
import { speechQueue, SpeechPriority } from '../services/speechQueue';

interface LiveCameraCardProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isCameraReady: boolean;
  cameraError: string | null;
  onStartDetection: () => void;
  onStopDetection: () => void;
  captureSnapshot: () => string | null;
}

export const LiveCameraCard: React.FC<LiveCameraCardProps> = ({
  videoRef,
  canvasRef,
  isCameraReady,
  cameraError,
  onStartDetection,
  onStopDetection,
  captureSnapshot,
}) => {
  const detectionActive = useAppStore((s) => s.detectionActive);
  const isModelLoading = useAppStore((s) => s.isModelLoading);
  const fps = useAppStore((s) => s.fps);
  const videoResolution = useAppStore((s) => s.videoResolution);
  const modelType = useAppStore((s) => s.modelType);
  const setModelType = useAppStore((s) => s.setModelType);
  const confidenceThreshold = useAppStore((s) => s.confidenceThreshold);
  const setConfidenceThreshold = useAppStore((s) => s.setConfidenceThreshold);
  const speakFarObjects = useAppStore((s) => s.speakFarObjects);
  const setSpeakFarObjects = useAppStore((s) => s.setSpeakFarObjects);
  const showDetectionDebug = useAppStore((s) => s.showDetectionDebug);
  const setShowDetectionDebug = useAppStore((s) => s.setShowDetectionDebug);
  const lastSceneDescription = useAppStore((s) => s.lastSceneDescription);
  const setLastSceneDescription = useAppStore((s) => s.setLastSceneDescription);
  const lastOcrText = useAppStore((s) => s.lastOcrText);
  const setLastOcrText = useAppStore((s) => s.setLastOcrText);
  const highContrast = useAppStore((s) => s.highContrast);
  const largeText = useAppStore((s) => s.largeText);
  const setLargeText = useAppStore((s) => s.setLargeText);

  const liveDetections = useStatsStore((s) => s.liveDetections);
  const addActivity = useStatsStore((s) => s.addActivity);
  const modelLoadError = useAppStore((s) => s.modelLoadError);
  const setModelLoadError = useAppStore((s) => s.setModelLoadError);

  const [showSettings, setShowSettings] = useState(false);
  const [isDescribing, setIsDescribing] = useState(false);
  const [isReadingText, setIsReadingText] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const handleDescribeClick = async () => {
    setApiError(null);
    const base64 = captureSnapshot();
    if (!base64) {
      const msg = 'Please turn on the camera first to describe the scene.';
      speechQueue.speak(msg, SpeechPriority.STATUS);
      setApiError(msg);
      return;
    }

    setIsDescribing(true);
    speechQueue.speak('Analyzing surroundings...', SpeechPriority.STATUS);

    try {
      const desc = await describeSurroundings(base64);
      setLastSceneDescription(desc);
      setApiError(null);
      speechQueue.speak(desc, SpeechPriority.ASSISTANT_REPLY);
      addActivity({
        type: 'detection',
        title: 'Scene Described',
        detail: desc,
        status: 'Completed',
      });
    } catch (err: any) {
      console.error('Scene description error:', err);
      const { spoken } = formatSpecificError(err);
      setApiError(spoken || 'Failed to describe scene.');
      speechQueue.speak(spoken, SpeechPriority.ASSISTANT_REPLY);
    } finally {
      setIsDescribing(false);
    }
  };

  const handleReadTextClick = async () => {
    setApiError(null);
    const base64 = captureSnapshot();
    if (!base64) {
      const msg = 'Please turn on the camera first to read text.';
      speechQueue.speak(msg, SpeechPriority.STATUS);
      setApiError(msg);
      return;
    }

    setIsReadingText(true);
    speechQueue.speak('Reading text in front of you...', SpeechPriority.STATUS);

    try {
      const text = await readTextFromImage(base64);
      setLastOcrText(text);
      setApiError(null);
      speechQueue.speak(text, SpeechPriority.ASSISTANT_REPLY);
      addActivity({
        type: 'detection',
        title: 'Text Read',
        detail: text,
        status: 'Completed',
      });
    } catch (err: any) {
      console.error('Read text error:', err);
      const { spoken } = formatSpecificError(err);
      setApiError(spoken || 'Failed to read text.');
      speechQueue.speak(spoken, SpeechPriority.ASSISTANT_REPLY);
    } finally {
      setIsReadingText(false);
    }
  };

  const handleToggleTextSize = () => {
    const next = !largeText;
    setLargeText(next);
    speechQueue.speak(
      next ? 'Large text enabled' : 'Standard text enabled',
      SpeechPriority.STATUS
    );
  };

  return (
    <div
      className={`w-full max-w-[1400px] mx-auto rounded-[24px] sm:rounded-[32px] p-4 sm:p-6 lg:p-7 shadow-[0_12px_40px_-5px_rgba(0,0,0,0.06),0_6px_16px_-6px_rgba(0,0,0,0.02)] transition-all ${
        highContrast
          ? 'bg-black border-2 border-yellow-400 text-yellow-400'
          : 'bg-white border border-gray-100/90 text-gray-900'
      }`}
    >
      {/* Header with Title, Camera Status, and Enriched Large Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 sm:mb-6">
        {/* Left: Camera icon & Live Status */}
        <div className="flex items-center gap-3 sm:gap-3.5">
          <div
            className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shrink-0 ${
              highContrast ? 'bg-yellow-400 text-black' : 'bg-[#14141C] text-white shadow-md'
            }`}
          >
            <Camera className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <div>
            <h3 className="font-black text-lg sm:text-xl lg:text-2xl tracking-tight leading-snug">
              Live Camera & Obstacle Vision
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              {detectionActive ? (
                <span className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-emerald-600 dark:text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Active Detection · {liveDetections.length} objects visible
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold opacity-70">
                  <span className="w-2 h-2 rounded-full bg-gray-400" />
                  Camera Standby
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Accessible Control Toolbar with large touch targets (min 48px) */}
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {/* Describe Scene Button */}
          <button
            onClick={handleDescribeClick}
            disabled={isDescribing}
            aria-label="Describe surroundings with Gemini Vision"
            className="flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white font-extrabold text-xs sm:text-sm transition-all shadow-md hover:shadow-purple-500/25 active:scale-[0.98] min-h-[48px] sm:min-h-[50px] disabled:opacity-50 cursor-pointer"
          >
            <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
            <span>{isDescribing ? 'Analyzing...' : 'Describe Scene'}</span>
          </button>

          {/* Read Text Button */}
          <button
            onClick={handleReadTextClick}
            disabled={isReadingText}
            aria-label="Read text in view"
            className="flex items-center gap-2 px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-800 font-bold text-xs sm:text-sm transition min-h-[48px] sm:min-h-[50px] disabled:opacity-50 cursor-pointer"
          >
            <Type className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
            <span>{isReadingText ? 'Reading...' : 'Read Text'}</span>
          </button>

          {/* Text-Size Accessibility Control */}
          <button
            onClick={handleToggleTextSize}
            aria-label={largeText ? 'Switch to standard text size' : 'Switch to large text size'}
            title={largeText ? 'Switch to standard text size' : 'Switch to large text size'}
            className={`min-h-[48px] px-3.5 py-2 rounded-xl sm:rounded-2xl border font-bold text-xs sm:text-sm flex items-center gap-1.5 transition cursor-pointer ${
              largeText
                ? 'bg-purple-50 text-purple-700 border-purple-300 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800'
                : 'bg-white hover:bg-gray-100 text-gray-700 border-gray-200 dark:bg-zinc-800 dark:text-gray-200 dark:border-zinc-700'
            }`}
          >
            <Type className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
            <span className="font-extrabold">{largeText ? 'Lg' : 'A+'}</span>
          </button>

          {/* Detection Settings Cog */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            aria-label="Toggle detection settings"
            title="Detection settings"
            className={`min-h-[48px] min-w-[48px] p-2.5 rounded-xl sm:rounded-2xl border transition flex items-center justify-center cursor-pointer ${
              showSettings
                ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                : 'border-gray-200 hover:bg-gray-100 text-gray-700 dark:border-zinc-700 dark:text-gray-300'
            }`}
          >
            <Sliders className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>

          {/* Quick Stop in Header if Detection is Running */}
          {detectionActive && (
            <button
              onClick={onStopDetection}
              aria-label="Stop detection"
              className="flex items-center gap-1.5 px-3.5 sm:px-4 py-2.5 rounded-xl sm:rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs sm:text-sm shadow-md transition active:scale-[0.98] min-h-[48px] cursor-pointer"
            >
              <EyeOff className="w-4 h-4 shrink-0" />
              <span>Stop</span>
            </button>
          )}
        </div>
      </div>

      {/* Detection Settings Panel */}
      {showSettings && (
        <div
          className={`p-4 sm:p-5 rounded-2xl sm:rounded-3xl mb-5 border text-xs sm:text-sm space-y-4 transition-colors ${
            highContrast
              ? 'bg-zinc-900 border-yellow-400 text-yellow-300'
              : 'bg-gray-50 border-gray-200 text-gray-800'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="font-bold block text-sm sm:text-base">
                Confidence Threshold: {Math.round(confidenceThreshold * 100)}%
              </span>
              <span className="text-xs opacity-75">Minimum confidence score to alert (20% – 80%)</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="0.8"
              step="0.05"
              value={confidenceThreshold}
              onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
              aria-label="Confidence threshold"
              className="w-44 accent-purple-600 cursor-pointer h-2 bg-gray-200 rounded-lg"
            />
          </div>

          <div className="flex items-center justify-between border-t pt-3 border-gray-200/60">
            <div>
              <span className="font-bold block text-sm sm:text-base">Speak Far Objects</span>
              <span className="text-xs opacity-75">Announce distant objects even when closer ones are absent</span>
            </div>
            <input
              type="checkbox"
              checked={speakFarObjects}
              onChange={(e) => setSpeakFarObjects(e.target.checked)}
              aria-label="Speak far objects"
              className="w-5 h-5 accent-purple-600 rounded cursor-pointer"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 border-gray-200/60">
            <div>
              <span className="font-bold block text-sm sm:text-base">Vision Model Profile</span>
              <span className="text-xs opacity-75">Accurate (MobileNet V2) vs Fast (Lite MobileNet)</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setModelType('mobilenet_v2')}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition min-h-[40px] cursor-pointer ${
                  modelType === 'mobilenet_v2'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Accurate
              </button>
              <button
                onClick={() => setModelType('lite_mobilenet_v2')}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition min-h-[40px] cursor-pointer ${
                  modelType === 'lite_mobilenet_v2'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                Fast
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-3 border-gray-200/60">
            <div>
              <span className="font-bold block text-sm sm:text-base">Debug Telemetry Overlay</span>
              <span className="text-xs opacity-75">Display FPS, resolution, and class scores on screen</span>
            </div>
            <input
              type="checkbox"
              checked={showDetectionDebug}
              onChange={(e) => setShowDetectionDebug(e.target.checked)}
              aria-label="Debug telemetry overlay"
              className="w-5 h-5 accent-purple-600 rounded cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* Enlarged Live Camera & Canvas Stage - Responsive Enormous Preview */}
      <div className="relative w-full aspect-[4/3] sm:aspect-video min-h-[320px] sm:min-h-[440px] md:min-h-[500px] lg:min-h-[580px] xl:min-h-[640px] bg-[#14141C] rounded-2xl sm:rounded-3xl overflow-hidden shadow-inner flex items-center justify-center">
        {/* Rear Camera Video Element */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Real-time Bounding Box Canvas Overlay */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />

        {/* Model Loading State */}
        {isModelLoading && (
          <div className="absolute inset-0 z-20 bg-black/80 flex flex-col items-center justify-center gap-3 text-white p-6 text-center">
            <RefreshCw className="w-10 h-10 text-sky-400 animate-spin" />
            <p className="font-extrabold text-base sm:text-lg tracking-wide">Loading vision model...</p>
            <p className="text-xs sm:text-sm opacity-75 max-w-sm">
              Initializing COCO-SSD neural network weights for offline in-browser detection
            </p>
          </div>
        )}

        {/* Model Load Error State */}
        {modelLoadError && !isModelLoading && (
          <div className="absolute inset-0 z-25 bg-amber-950/90 flex flex-col items-center justify-center gap-3 text-white p-6 text-center">
            <AlertCircle className="w-10 h-10 text-amber-400" />
            <p className="font-bold text-base sm:text-lg">Vision Model Load Issue</p>
            <p className="text-xs sm:text-sm opacity-85 max-w-md">{modelLoadError}</p>
            <button
              onClick={() => {
                setModelLoadError(null);
                onStartDetection();
              }}
              className="mt-2 px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 font-bold text-xs sm:text-sm cursor-pointer shadow-md"
            >
              Retry Loading Model
            </button>
          </div>
        )}

        {/* Standby State when Detection is Inactive */}
        {!detectionActive && !isModelLoading && !modelLoadError && (
          <div className="absolute inset-0 z-10 bg-black/70 backdrop-blur-[3px] flex flex-col items-center justify-center gap-4 text-white p-6 sm:p-10 text-center select-none">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/10 flex items-center justify-center shadow-lg backdrop-blur-sm border border-white/20">
              <EyeOff className="w-8 h-8 sm:w-10 sm:h-10 text-gray-200" />
            </div>
            <div className="space-y-1.5 max-w-lg">
              <h4 className="font-black text-xl sm:text-2xl md:text-3xl tracking-tight text-white">
                Object Detection Off
              </h4>
              <p className="text-xs sm:text-sm md:text-base text-gray-200 opacity-90 leading-relaxed font-medium">
                Say &ldquo;start detection&rdquo; or click below to start real-time obstacle tracking with 3D audio guidance.
              </p>
            </div>
            <button
              onClick={onStartDetection}
              aria-label="Start object detection"
              className="mt-2 px-8 sm:px-12 py-3.5 sm:py-4 rounded-2xl bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white font-black text-base sm:text-lg shadow-2xl hover:shadow-purple-500/30 flex items-center gap-3 transition-all transform hover:scale-[1.02] active:scale-[0.98] min-h-[56px] sm:min-h-[60px] cursor-pointer"
            >
              <Eye className="w-6 h-6" />
              <span>Start Detection</span>
            </button>
          </div>
        )}

        {/* Camera Error Message */}
        {cameraError && (
          <div className="absolute inset-0 z-30 bg-red-950/90 flex flex-col items-center justify-center gap-3 text-white p-6 text-center">
            <AlertCircle className="w-10 h-10 text-red-400" />
            <p className="font-bold text-base sm:text-lg">
              {cameraError.includes('denied')
                ? 'Camera Permission Denied'
                : cameraError.includes('busy') || cameraError.includes('in use')
                ? 'Camera In Use'
                : cameraError.includes('No camera')
                ? 'No Camera Found'
                : 'Camera Unavailable'}
            </p>
            <p className="text-xs sm:text-sm opacity-80 max-w-md">{cameraError}</p>
          </div>
        )}

        {/* Debug Overlay */}
        {showDetectionDebug && detectionActive && (
          <div className="absolute top-4 left-4 z-20 bg-black/85 backdrop-blur-md text-emerald-400 text-xs font-mono p-3 rounded-2xl border border-emerald-500/30 space-y-1 pointer-events-none shadow-lg">
            <div>FPS: {fps} (target ~8-10)</div>
            <div>
              Resolution: {videoResolution.width}x{videoResolution.height}
            </div>
            <div>Visible Objects: {liveDetections.length}</div>
            <div>Model: {modelType}</div>
          </div>
        )}

        {/* Active Scanning Status Badge */}
        {detectionActive && (
          <div className="absolute top-4 right-4 z-20 flex items-center gap-2 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-full bg-emerald-600/90 text-white font-extrabold text-xs sm:text-sm backdrop-blur-md shadow-lg border border-emerald-400/30">
            <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping" />
            <span>Scanning 80 classes</span>
          </div>
        )}

        {/* Top-Left Live Objects Count Badge when Active */}
        {detectionActive && !showDetectionDebug && (
          <div className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-full bg-black/75 text-white font-extrabold text-xs sm:text-sm backdrop-blur-md shadow-lg border border-white/15">
            <Eye className="w-4 h-4 text-sky-400" />
            <span>{liveDetections.length} {liveDetections.length === 1 ? 'Object' : 'Objects'} Detected</span>
          </div>
        )}
      </div>

      {/* API / Vision Error Alert */}
      {apiError && (
        <div
          className={`mt-4 p-4 rounded-2xl sm:rounded-3xl border flex items-start gap-3 text-xs sm:text-sm ${
            highContrast
              ? 'bg-zinc-900 border-red-500 text-red-300'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-bold block">Vision Processing Alert</span>
            <p className="mt-0.5 opacity-90">{apiError}</p>
          </div>
          <button
            onClick={() => setApiError(null)}
            className="text-xs font-bold underline opacity-70 hover:opacity-100 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Last Scene Description Card */}
      {lastSceneDescription && (
        <div
          className={`mt-4 sm:mt-5 p-4 sm:p-5 rounded-2xl sm:rounded-3xl border text-xs sm:text-sm leading-relaxed transition-colors ${
            highContrast
              ? 'bg-zinc-900 border-yellow-400 text-yellow-300'
              : 'bg-purple-50/70 border-purple-100 text-purple-950'
          }`}
        >
          <div className="font-extrabold flex items-center gap-2 mb-1.5 text-purple-700 dark:text-purple-300 text-sm sm:text-base">
            <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600" />
            <span>Latest Scene Understanding</span>
          </div>
          <p className="font-medium text-xs sm:text-sm leading-relaxed">{lastSceneDescription}</p>
        </div>
      )}

      {/* Last OCR Card */}
      {lastOcrText && (
        <div
          className={`mt-3 sm:mt-4 p-4 sm:p-5 rounded-2xl sm:rounded-3xl border text-xs sm:text-sm leading-relaxed transition-colors ${
            highContrast
              ? 'bg-zinc-900 border-yellow-400 text-yellow-300'
              : 'bg-indigo-50/70 border-indigo-100 text-indigo-950'
          }`}
        >
          <div className="font-extrabold flex items-center gap-2 mb-1.5 text-indigo-700 dark:text-indigo-300 text-sm sm:text-base">
            <Type className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600" />
            <span>Read Text</span>
          </div>
          <p className="font-medium text-xs sm:text-sm leading-relaxed">{lastOcrText}</p>
        </div>
      )}

      {/* Bottom control bar with Prominent Primary Action Buttons */}
      <div className="mt-5 sm:mt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4 border-t border-gray-100 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold opacity-75">
          <Volume2 className="w-4 h-4 text-purple-600 shrink-0" />
          <span>Obstacle warnings prioritize nearest obstacles with 3D directional audio cues.</span>
        </div>

        <div className="w-full sm:w-auto flex items-center justify-end">
          {detectionActive ? (
            <button
              onClick={onStopDetection}
              aria-label="Stop detection"
              className="w-full sm:w-auto px-7 py-3.5 rounded-2xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-black text-sm sm:text-base hover:shadow-lg transition shadow-md min-h-[54px] sm:min-h-[56px] flex items-center justify-center gap-2.5 active:scale-[0.98] cursor-pointer"
            >
              <EyeOff className="w-5 h-5" />
              <span>Stop Detection</span>
            </button>
          ) : (
            <button
              onClick={onStartDetection}
              aria-label="Start detection"
              className="w-full sm:w-auto px-7 py-3.5 rounded-2xl bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white font-black text-sm sm:text-base hover:shadow-lg transition shadow-md min-h-[54px] sm:min-h-[56px] flex items-center justify-center gap-2.5 active:scale-[0.98] cursor-pointer"
            >
              <Eye className="w-5 h-5" />
              <span>Start Detection</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
