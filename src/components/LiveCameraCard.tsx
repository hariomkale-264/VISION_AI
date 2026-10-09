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

  const liveDetections = useStatsStore((s) => s.liveDetections);
  const addActivity = useStatsStore((s) => s.addActivity);

  const [showSettings, setShowSettings] = useState(false);
  const [isDescribing, setIsDescribing] = useState(false);
  const [isReadingText, setIsReadingText] = useState(false);

  const handleDescribeClick = async () => {
    const base64 = captureSnapshot();
    if (!base64) {
      speechQueue.speak('Please turn on the camera first to describe the scene.', SpeechPriority.STATUS);
      return;
    }

    setIsDescribing(true);
    speechQueue.speak('Analyzing surroundings...', SpeechPriority.STATUS);

    try {
      const desc = await describeSurroundings(base64);
      setLastSceneDescription(desc);
      speechQueue.speak(desc, SpeechPriority.ASSISTANT_REPLY);
      addActivity({
        type: 'detection',
        title: 'Scene Described',
        detail: desc,
        status: 'Completed',
      });
    } catch (err) {
      console.error('Scene description error:', err);
      const { spoken } = formatSpecificError(err);
      speechQueue.speak(spoken, SpeechPriority.ASSISTANT_REPLY);
    } finally {
      setIsDescribing(false);
    }
  };

  const handleReadTextClick = async () => {
    const base64 = captureSnapshot();
    if (!base64) {
      speechQueue.speak('Please turn on the camera first to read text.', SpeechPriority.STATUS);
      return;
    }

    setIsReadingText(true);
    speechQueue.speak('Reading text in front of you...', SpeechPriority.STATUS);

    try {
      const text = await readTextFromImage(base64);
      setLastOcrText(text);
      speechQueue.speak(text, SpeechPriority.ASSISTANT_REPLY);
      addActivity({
        type: 'detection',
        title: 'Text Read',
        detail: text,
        status: 'Completed',
      });
    } catch (err) {
      console.error('Read text error:', err);
      const { spoken } = formatSpecificError(err);
      speechQueue.speak(spoken, SpeechPriority.ASSISTANT_REPLY);
    } finally {
      setIsReadingText(false);
    }
  };

  return (
    <div
      className={`rounded-[24px] p-5 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.05),0_8px_10px_-6px_rgba(0,0,0,0.01)] transition-all ${
        highContrast
          ? 'bg-black border-2 border-yellow-400 text-yellow-400'
          : 'bg-white border border-gray-100 text-gray-900'
      }`}
    >
      {/* Header with status & action triggers */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
              highContrast ? 'bg-yellow-400 text-black' : 'bg-[#14141C] text-white shadow-sm'
            }`}
          >
            <Camera className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-extrabold text-base tracking-tight">Live Camera & Obstacle Vision</h3>
            <p className="text-xs font-semibold opacity-70">
              {detectionActive
                ? `Active Detection · ${liveDetections.length} objects visible`
                : 'Camera Standby'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Describe Scene Button */}
          <button
            onClick={handleDescribeClick}
            disabled={isDescribing}
            aria-label="Describe surroundings"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 transition shadow-sm min-h-[44px]"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isDescribing ? 'Analyzing...' : 'Describe Scene'}</span>
          </button>

          {/* Read Text Button */}
          <button
            onClick={handleReadTextClick}
            disabled={isReadingText}
            aria-label="Read text in view"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 text-gray-800 font-bold text-xs hover:bg-gray-200 transition min-h-[44px]"
          >
            <Type className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isReadingText ? 'Reading...' : 'Read Text'}</span>
          </button>

          {/* Detection Settings Cog */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            aria-label="Toggle detection settings"
            className="p-2.5 rounded-xl border border-gray-200 hover:bg-gray-100 transition min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <Sliders className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Detection Settings Panel */}
      {showSettings && (
        <div
          className={`p-4 rounded-2xl mb-4 border text-xs space-y-3 transition-colors ${
            highContrast
              ? 'bg-zinc-900 border-yellow-400 text-yellow-300'
              : 'bg-gray-50 border-gray-200 text-gray-800'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="font-bold block">Confidence Threshold: {Math.round(confidenceThreshold * 100)}%</span>
              <span className="text-[10px] opacity-75">Min score to alert (0.2 - 0.8)</span>
            </div>
            <input
              type="range"
              min="0.2"
              max="0.8"
              step="0.05"
              value={confidenceThreshold}
              onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
              aria-label="Confidence threshold"
              className="w-36 accent-indigo-600 cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between border-t pt-2 border-gray-200/50">
            <div>
              <span className="font-bold block">Speak Far Objects</span>
              <span className="text-[10px] opacity-75">Announce distant objects even when closer ones are absent</span>
            </div>
            <input
              type="checkbox"
              checked={speakFarObjects}
              onChange={(e) => setSpeakFarObjects(e.target.checked)}
              aria-label="Speak far objects"
              className="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between border-t pt-2 border-gray-200/50">
            <div>
              <span className="font-bold block">Vision Model Profile</span>
              <span className="text-[10px] opacity-75">Accurate (MobileNet V2) vs Fast (Lite MobileNet)</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setModelType('mobilenet_v2')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                  modelType === 'mobilenet_v2'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 text-gray-700'
                }`}
              >
                Accurate
              </button>
              <button
                onClick={() => setModelType('lite_mobilenet_v2')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                  modelType === 'lite_mobilenet_v2'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-200 text-gray-700'
                }`}
              >
                Fast
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-2 border-gray-200/50">
            <div>
              <span className="font-bold block">Debug Telemetry Overlay</span>
              <span className="text-[10px] opacity-75">Display FPS, resolution, and class scores on screen</span>
            </div>
            <input
              type="checkbox"
              checked={showDetectionDebug}
              onChange={(e) => setShowDetectionDebug(e.target.checked)}
              aria-label="Debug telemetry overlay"
              className="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* Camera Video and Canvas Stage */}
      <div className="relative w-full aspect-video sm:aspect-[16/10] bg-[#14141C] rounded-2xl overflow-hidden shadow-inner flex items-center justify-center">
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
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />

        {/* Model Loading State */}
        {isModelLoading && (
          <div className="absolute inset-0 z-20 bg-black/75 flex flex-col items-center justify-center gap-3 text-white p-4 text-center">
            <RefreshCw className="w-8 h-8 text-sky-400 animate-spin" />
            <p className="font-extrabold text-sm tracking-wide">Loading vision model...</p>
            <p className="text-xs opacity-75 max-w-xs">
              Initializing COCO-SSD neural network weights for offline in-browser detection
            </p>
          </div>
        )}

        {/* Standby State when Detection is Inactive */}
        {!detectionActive && !isModelLoading && (
          <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center gap-3 text-white p-4 text-center">
            <EyeOff className="w-10 h-10 text-gray-400" />
            <div>
              <h4 className="font-bold text-base">Object Detection Off</h4>
              <p className="text-xs opacity-70 mt-1 max-w-xs">
                Say &ldquo;start detection&rdquo; or click below to start real-time obstacle tracking.
              </p>
            </div>
            <button
              onClick={onStartDetection}
              aria-label="Start object detection"
              className="mt-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-extrabold text-xs hover:bg-indigo-700 transition shadow-lg min-h-[48px]"
            >
              Start Detection
            </button>
          </div>
        )}

        {/* Camera Error Message */}
        {cameraError && (
          <div className="absolute inset-0 z-30 bg-red-950/90 flex flex-col items-center justify-center gap-2 text-white p-4 text-center">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="font-bold text-sm">Camera Permission Denied</p>
            <p className="text-xs opacity-80 max-w-sm">{cameraError}</p>
          </div>
        )}

        {/* Debug Overlay */}
        {showDetectionDebug && detectionActive && (
          <div className="absolute top-3 left-3 z-20 bg-black/80 backdrop-blur-sm text-emerald-400 text-[10px] font-mono p-2.5 rounded-xl border border-emerald-500/30 space-y-1 pointer-events-none">
            <div>FPS: {fps} (target ~8-10)</div>
            <div>
              Resolution: {videoResolution.width}x{videoResolution.height}
            </div>
            <div>Visible Objects: {liveDetections.length}</div>
            <div>Model: {modelType}</div>
          </div>
        )}

        {/* Running Status Badge */}
        {detectionActive && (
          <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/90 text-white font-bold text-xs backdrop-blur-sm shadow-md">
            <span className="w-2 h-2 rounded-full bg-white animate-ping" />
            <span>Scanning 80 classes</span>
          </div>
        )}
      </div>

      {/* Last Scene Description Card */}
      {lastSceneDescription && (
        <div
          className={`mt-4 p-3.5 rounded-2xl border text-xs leading-relaxed transition-colors ${
            highContrast
              ? 'bg-zinc-900 border-yellow-400 text-yellow-300'
              : 'bg-sky-50/70 border-sky-100 text-sky-950'
          }`}
        >
          <div className="font-bold flex items-center gap-1.5 mb-1 text-indigo-600">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Latest Scene Understanding</span>
          </div>
          <p className="font-medium">{lastSceneDescription}</p>
        </div>
      )}

      {/* Last OCR Card */}
      {lastOcrText && (
        <div
          className={`mt-3 p-3.5 rounded-2xl border text-xs leading-relaxed transition-colors ${
            highContrast
              ? 'bg-zinc-900 border-yellow-400 text-yellow-300'
              : 'bg-indigo-50/70 border-indigo-100 text-indigo-950'
          }`}
        >
          <div className="font-bold flex items-center gap-1.5 mb-1 text-indigo-600">
            <Type className="w-3.5 h-3.5" />
            <span>Read Text</span>
          </div>
          <p className="font-medium">{lastOcrText}</p>
        </div>
      )}

      {/* Bottom control bar with Large Backup Stop Button */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-gray-100">
        <span className="text-xs font-semibold opacity-70">
          Obstacle warnings prioritize nearest obstacles with 3D directional cues.
        </span>

        {detectionActive && (
          <button
            onClick={onStopDetection}
            aria-label="Stop detection"
            className="px-5 py-3 rounded-xl bg-gray-900 text-white font-extrabold text-xs hover:bg-black transition shadow min-h-[56px] flex items-center gap-2"
          >
            <EyeOff className="w-4 h-4" />
            <span>Stop Detection</span>
          </button>
        )}
      </div>
    </div>
  );
};
