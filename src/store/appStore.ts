/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ActiveTab = 'dashboard' | 'detection' | 'navigation' | 'voice' | 'emergency' | 'settings';
export type MicStatus = 'listening' | 'paused' | 'reconnecting' | 'error';

export interface RouteStep {
  instruction: string;
  distance: number; // in meters
  location: [number, number]; // [lat, lng]
  maneuverType?: string;
  modifier?: string;
}

export interface GoogleMapsNavState {
  destination: string;
  geocodedName?: string;
  url: string;
  travelmode: 'walking' | 'driving' | 'transit' | 'bicycling';
  heardTranscript: string;
  popupBlocked?: boolean;
  lat?: number;
  lng?: number;
  distanceKm?: number;
  status?: 'active' | 'completed';
  redirectMethod?: string;
}

export interface NavDebugInfo {
  heardText: string;
  extractedDest: string;
  geocodedPlace: string;
  finalUrl: string;
  redirectMethod: string;
  timestamp?: number;
}

export interface TapOverlayState {
  active: boolean;
  url: string;
  destination: string;
}

export interface VoiceDebugLog {
  timestamp: string;
  durationMs: number;
  mimeType: string;
  transcript: string;
  intent: string;
  reply: string;
  latencyMs: number;
  rawJson?: any;
}

interface AppState {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;

  // Microphone state
  micStatus: MicStatus;
  setMicStatus: (status: MicStatus) => void;
  micLevel: number;
  setMicLevel: (level: number) => void;
  isProcessingAudio: boolean;
  setIsProcessingAudio: (val: boolean) => void;
  isSpeaking: boolean;
  setIsSpeaking: (val: boolean) => void;

  // Confirmation flags
  isPendingStopListening: boolean;
  setIsPendingStopListening: (val: boolean) => void;
  isPendingDestination: boolean;
  setIsPendingDestination: (val: boolean) => void;

  // Voice Interaction
  lastTranscript: string;
  lastIntent: string;
  lastReply: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; text: string }>;
  voiceDebugLogs: VoiceDebugLog[];
  setLastUtteranceResult: (transcript: string, intent: string, reply: string, debug?: Omit<VoiceDebugLog, 'timestamp'>) => void;

  // Camera & Object Detection
  detectionActive: boolean;
  setDetectionActive: (active: boolean) => void;
  modelType: 'mobilenet_v2' | 'lite_mobilenet_v2';
  setModelType: (type: 'mobilenet_v2' | 'lite_mobilenet_v2') => void;
  confidenceThreshold: number;
  setConfidenceThreshold: (val: number) => void;
  speakFarObjects: boolean;
  setSpeakFarObjects: (val: boolean) => void;
  showDetectionDebug: boolean;
  setShowDetectionDebug: (val: boolean) => void;
  isModelLoading: boolean;
  setIsModelLoading: (val: boolean) => void;
  modelLoadError: string | null;
  setModelLoadError: (err: string | null) => void;
  fps: number;
  setFps: (fps: number) => void;
  videoResolution: { width: number; height: number };
  setVideoResolution: (res: { width: number; height: number }) => void;
  lastSceneDescription: string;
  setLastSceneDescription: (desc: string) => void;
  lastOcrText: string;
  setLastOcrText: (text: string) => void;

  // Geolocation & Navigation
  currentLocation: {
    lat: number | null;
    lng: number | null;
    accuracy: number | null;
    speed: number | null;
    address: string;
  };
  setCurrentLocation: (loc: Partial<AppState['currentLocation']>) => void;

  navigationActive: boolean;
  destination: string;
  destinationCoords: [number, number] | null;
  routePolyline: Array<[number, number]>;
  routeSteps: RouteStep[];
  currentStepIndex: number;
  distanceRemainingMeters: number;
  durationRemainingSec: number;
  isRerouting: boolean;
  startNavigation: (destination: string, destCoords: [number, number], polyline: Array<[number, number]>, steps: RouteStep[], distance: number, duration: number) => void;
  updateNavigationProgress: (stepIndex: number, distRemaining: number, durationRemaining: number) => void;
  stopNavigation: () => void;
  setIsRerouting: (val: boolean) => void;

  // External Google Maps Navigation state
  googleMapsNav: GoogleMapsNavState | null;
  setGoogleMapsNav: (nav: GoogleMapsNavState | null) => void;
  autoStartTurnByTurn: boolean;
  setAutoStartTurnByTurn: (val: boolean) => void;
  navDebugInfo: NavDebugInfo | null;
  setNavDebugInfo: (info: NavDebugInfo | null) => void;
  tapOverlay: TapOverlayState | null;
  setTapOverlay: (overlay: TapOverlayState | null) => void;
  isWaitingForTravelMode: boolean;
  setIsWaitingForTravelMode: (val: boolean) => void;

  // Real-time Information Bar Metrics
  currentTimeString: string;
  currentDateString: string;
  batteryLevel: number | null;
  isCharging: boolean | null;
  isOnline: boolean;
  setRealtimeMetrics: (metrics: Partial<{
    currentTimeString: string;
    currentDateString: string;
    batteryLevel: number | null;
    isCharging: boolean | null;
    isOnline: boolean;
  }>) => void;

  // Error Debug Line & Key Missing Alert
  lastErrorDebug: string | null;
  setLastErrorDebug: (err: string | null) => void;
  keyMissingAlert: boolean;
  setKeyMissingAlert: (val: boolean) => void;
  setLastTranscript: (text: string) => void;

  // Settings & Accessibility
  highContrast: boolean;
  setHighContrast: (val: boolean) => void;
  largeText: boolean;
  setLargeText: (val: boolean) => void;
  speechRate: number;
  setSpeechRate: (rate: number) => void;
  speechVolume: number;
  setSpeechVolume: (vol: number) => void;
  language: string;
  setLanguage: (lang: string) => void;
  emergencyContact: { name: string; phone: string };
  setEmergencyContact: (contact: { name: string; phone: string }) => void;
  onboardingComplete: boolean;
  setOnboardingComplete: (val: boolean) => void;
  voiceDebugPanel: boolean;
  setVoiceDebugPanel: (val: boolean) => void;
  wakeLockActive: boolean;
  setWakeLockActive: (val: boolean) => void;

  // Aria announcements
  ariaLiveMessage: string;
  announceAria: (msg: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeTab: 'dashboard',
      setActiveTab: (tab) => set({ activeTab: tab }),

      micStatus: 'paused',
      setMicStatus: (status) => set({ micStatus: status }),
      micLevel: 0,
      setMicLevel: (micLevel) => set({ micLevel }),
      isProcessingAudio: false,
      setIsProcessingAudio: (isProcessingAudio) => set({ isProcessingAudio }),
      isSpeaking: false,
      setIsSpeaking: (isSpeaking) => set({ isSpeaking }),

      isPendingStopListening: false,
      setIsPendingStopListening: (isPendingStopListening) => set({ isPendingStopListening }),
      isPendingDestination: false,
      setIsPendingDestination: (isPendingDestination) => set({ isPendingDestination }),

      lastTranscript: '',
      lastIntent: '',
      lastReply: '',
      conversationHistory: [],
      voiceDebugLogs: [],

      setLastUtteranceResult: (transcript, intent, reply, debug) => {
        const state = get();
        const newHistory = [
          ...state.conversationHistory,
          { role: 'user' as const, text: transcript },
          { role: 'assistant' as const, text: reply },
        ].slice(-10); // Keep last 10 turns

        const newLogs = debug
          ? [
              { ...debug, timestamp: new Date().toISOString() },
              ...state.voiceDebugLogs.slice(0, 29),
            ]
          : state.voiceDebugLogs;

        set({
          lastTranscript: transcript,
          lastIntent: intent,
          lastReply: reply,
          conversationHistory: newHistory,
          voiceDebugLogs: newLogs,
        });
      },

      detectionActive: false,
      setDetectionActive: (detectionActive) => set({ detectionActive }),
      modelType: 'mobilenet_v2',
      setModelType: (modelType) => set({ modelType }),
      confidenceThreshold: 0.35,
      setConfidenceThreshold: (confidenceThreshold) => set({ confidenceThreshold }),
      speakFarObjects: false,
      setSpeakFarObjects: (speakFarObjects) => set({ speakFarObjects }),
      showDetectionDebug: false,
      setShowDetectionDebug: (showDetectionDebug) => set({ showDetectionDebug }),
      isModelLoading: false,
      setIsModelLoading: (isModelLoading) => set({ isModelLoading }),
      modelLoadError: null,
      setModelLoadError: (modelLoadError) => set({ modelLoadError }),
      fps: 0,
      setFps: (fps) => set({ fps }),
      videoResolution: { width: 0, height: 0 },
      setVideoResolution: (videoResolution) => set({ videoResolution }),
      lastSceneDescription: '',
      setLastSceneDescription: (lastSceneDescription) => set({ lastSceneDescription }),
      lastOcrText: '',
      setLastOcrText: (lastOcrText) => set({ lastOcrText }),

      currentLocation: {
        lat: null,
        lng: null,
        accuracy: null,
        speed: null,
        address: 'Locating...',
      },
      setCurrentLocation: (loc) =>
        set((state) => ({
          currentLocation: { ...state.currentLocation, ...loc },
        })),

      navigationActive: false,
      destination: '',
      destinationCoords: null,
      routePolyline: [],
      routeSteps: [],
      currentStepIndex: 0,
      distanceRemainingMeters: 0,
      durationRemainingSec: 0,
      isRerouting: false,

      startNavigation: (destination, destCoords, polyline, steps, distance, duration) =>
        set({
          navigationActive: true,
          destination,
          destinationCoords: destCoords,
          routePolyline: polyline,
          routeSteps: steps,
          currentStepIndex: 0,
          distanceRemainingMeters: distance,
          durationRemainingSec: duration,
          isRerouting: false,
        }),

      updateNavigationProgress: (currentStepIndex, distanceRemainingMeters, durationRemainingSec) =>
        set({
          currentStepIndex,
          distanceRemainingMeters,
          durationRemainingSec,
        }),

      stopNavigation: () =>
        set({
          navigationActive: false,
          destination: '',
          destinationCoords: null,
          routePolyline: [],
          routeSteps: [],
          currentStepIndex: 0,
          distanceRemainingMeters: 0,
          durationRemainingSec: 0,
          isRerouting: false,
        }),

      setIsRerouting: (isRerouting) => set({ isRerouting }),

      googleMapsNav: null,
      setGoogleMapsNav: (googleMapsNav) => set({ googleMapsNav }),
      autoStartTurnByTurn: false,
      setAutoStartTurnByTurn: (autoStartTurnByTurn) => set({ autoStartTurnByTurn }),
      navDebugInfo: null,
      setNavDebugInfo: (navDebugInfo) => set({ navDebugInfo }),
      tapOverlay: null,
      setTapOverlay: (tapOverlay) => set({ tapOverlay }),
      isWaitingForTravelMode: false,
      setIsWaitingForTravelMode: (isWaitingForTravelMode) => set({ isWaitingForTravelMode }),

      currentTimeString: '',
      currentDateString: '',
      batteryLevel: null,
      isCharging: null,
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      setRealtimeMetrics: (metrics) => set((state) => ({ ...state, ...metrics })),

      lastErrorDebug: null,
      setLastErrorDebug: (err) => set({ lastErrorDebug: err }),
      keyMissingAlert: false,
      setKeyMissingAlert: (keyMissingAlert) => set({ keyMissingAlert }),
      setLastTranscript: (text) => set({ lastTranscript: text }),

      highContrast: false,
      setHighContrast: (highContrast) => set({ highContrast }),
      largeText: false,
      setLargeText: (largeText) => set({ largeText }),
      speechRate: 1.0,
      setSpeechRate: (speechRate) => set({ speechRate }),
      speechVolume: 1.0,
      setSpeechVolume: (speechVolume) => set({ speechVolume }),
      language: 'en-US',
      setLanguage: (language) => set({ language }),
      emergencyContact: { name: 'Emergency Contact', phone: '' },
      setEmergencyContact: (emergencyContact) => set({ emergencyContact }),
      onboardingComplete: false,
      setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
      voiceDebugPanel: false,
      setVoiceDebugPanel: (voiceDebugPanel) => set({ voiceDebugPanel }),
      wakeLockActive: false,
      setWakeLockActive: (wakeLockActive) => set({ wakeLockActive }),

      ariaLiveMessage: '',
      announceAria: (msg) => set({ ariaLiveMessage: msg }),
    }),
    {
      name: 'vision_ai_app_settings',
      partialize: (state) => ({
        highContrast: state.highContrast,
        largeText: state.largeText,
        speechRate: state.speechRate,
        speechVolume: state.speechVolume,
        language: state.language,
        emergencyContact: state.emergencyContact,
        onboardingComplete: state.onboardingComplete,
        modelType: state.modelType,
        confidenceThreshold: state.confidenceThreshold,
        speakFarObjects: state.speakFarObjects,
        showDetectionDebug: state.showDetectionDebug,
        voiceDebugPanel: state.voiceDebugPanel,
        autoStartTurnByTurn: state.autoStartTurnByTurn,
      }),
    }
  )
);
