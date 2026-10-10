/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { useAppStore } from './store/appStore';
import { useContinuousMic } from './hooks/useContinuousMic';
import { useCamera } from './hooks/useCamera';
import { useObjectDetection } from './hooks/useObjectDetection';
import { useGeolocation } from './hooks/useGeolocation';
import { useNavigation } from './hooks/useNavigation';
import { useWakeLock } from './hooks/useWakeLock';
import { useRealtimeStatus } from './hooks/useRealtimeStatus';
import { registerVoiceRouterProviders } from './services/voiceRouter';
import { registerLocalCommandProviders } from './services/localCommandRouter';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { LiveStatusStrip } from './components/LiveStatusStrip';
import { GoogleMapsNavBanner } from './components/GoogleMapsNavBanner';
import { TapMapsOverlay } from './components/TapMapsOverlay';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OnboardingModal } from './components/OnboardingModal';
import { speechQueue, SpeechPriority } from './services/speechQueue';
import { DashboardPage } from './pages/DashboardPage';
import { DetectionPage } from './pages/DetectionPage';
import { NavigationPage } from './pages/NavigationPage';
import { VoicePage } from './pages/VoicePage';
import { EmergencyPage } from './pages/EmergencyPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  const activeTab = useAppStore((s) => s.activeTab);
  const highContrast = useAppStore((s) => s.highContrast);
  const largeText = useAppStore((s) => s.largeText);
  const onboardingComplete = useAppStore((s) => s.onboardingComplete);
  const setOnboardingComplete = useAppStore((s) => s.setOnboardingComplete);
  const ariaLiveMessage = useAppStore((s) => s.ariaLiveMessage);
  const micStatus = useAppStore((s) => s.micStatus);

  const [showOnboarding, setShowOnboarding] = useState(!onboardingComplete);

  // Core background services & continuous hooks
  const { startMicrophone, stopMicrophone } = useContinuousMic();
  const { videoRef, isCameraReady, cameraError, startCamera, stopCamera, captureSnapshot } = useCamera();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  // Object detection engine
  useObjectDetection(videoRef, canvasRef);

  // Geolocation & Navigation engine
  useGeolocation();
  useNavigation();

  // Real-time Information metrics (clock, battery, offline, cached geocoding)
  useRealtimeStatus();

  // Wire snapshot provider for local commands (describe scene, read text)
  useEffect(() => {
    registerVoiceRouterProviders(captureSnapshot, stopMicrophone, startMicrophone);
    registerLocalCommandProviders(captureSnapshot, stopMicrophone, startMicrophone);
  }, [captureSnapshot, stopMicrophone, startMicrophone]);

  // Screen Wake Lock (holds wake lock while microphone is actively listening)
  useWakeLock(micStatus === 'listening');

  // Trigger camera start when detection is enabled
  const detectionActive = useAppStore((s) => s.detectionActive);
  useEffect(() => {
    if (detectionActive && !isCameraReady) {
      startCamera();
    } else if (!detectionActive && isCameraReady) {
      stopCamera();
    }
  }, [detectionActive, isCameraReady, startCamera, stopCamera]);

  const handleToggleMic = () => {
    if (micStatus === 'listening') {
      stopMicrophone();
    } else {
      startMicrophone();
    }
  };

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    setOnboardingComplete(true);
    // Start continuous listening after onboarding
    startMicrophone();
  };

  // Requirement 6: Keep voice session alive & handle returning from Google Maps
  useEffect(() => {
    const handleReturnFromMaps = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        const hasLeft = localStorage.getItem('vision_ai_has_left_for_maps');
        if (hasLeft === 'true') {
          localStorage.removeItem('vision_ai_has_left_for_maps');

          const lastNavStr = localStorage.getItem('vision_ai_last_maps_nav');
          if (lastNavStr) {
            try {
              const navData = JSON.parse(lastNavStr);
              useAppStore.getState().setGoogleMapsNav({
                ...navData,
                status: 'active',
              });

              if (navData.heardText || navData.destination) {
                useAppStore.getState().setNavDebugInfo({
                  heardText: navData.heardText || navData.destination,
                  extractedDest: navData.destination,
                  geocodedPlace: navData.geocodedName || navData.destination,
                  finalUrl: navData.url,
                  redirectMethod: navData.redirectMethod || 'href / anchor',
                  timestamp: navData.timestamp || Date.now(),
                });
              }
            } catch (e) {
              console.warn('Error restoring navData:', e);
            }
          }

          useAppStore.getState().setActiveTab('navigation');
          useAppStore.getState().setTapOverlay(null);
          speechQueue.speak('Welcome back', SpeechPriority.NAVIGATION);

          // Restart / keep microphone session alive
          startMicrophone();
        }
      }
    };

    document.addEventListener('visibilitychange', handleReturnFromMaps);
    window.addEventListener('focus', handleReturnFromMaps);
    handleReturnFromMaps();

    return () => {
      document.removeEventListener('visibilitychange', handleReturnFromMaps);
      window.removeEventListener('focus', handleReturnFromMaps);
    };
  }, [startMicrophone]);

  const commonPageProps = {
    videoRef,
    canvasRef,
    isCameraReady,
    cameraError,
    onStartDetection: () => useAppStore.getState().setDetectionActive(true),
    onStopDetection: () => useAppStore.getState().setDetectionActive(false),
    onStartMic: startMicrophone,
    onStopMic: stopMicrophone,
    captureSnapshot,
  };

  return (
    <div
      className={`min-h-screen p-1.5 sm:p-4 lg:p-6 flex items-center justify-center font-sans transition-colors duration-200 ${
        highContrast ? 'bg-black text-yellow-400' : 'bg-[#E8EAF3] text-gray-900'
      } ${largeText ? 'text-lg' : 'text-base'}`}
    >
      {/* Screen Reader Aria-Live Announcement Region */}
      <div
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {ariaLiveMessage}
      </div>

      {/* Offline Toast Indicator */}
      <OfflineIndicator />

      {/* Tap Target Overlay for Blocked Redirects Fallback */}
      <TapMapsOverlay />

      {/* First-launch Guided Spoken Onboarding Modal */}
      {showOnboarding && (
        <OnboardingModal onComplete={handleOnboardingComplete} />
      )}

      {/* Main Soft-UI Dashboard Container */}
      <div
        className={`w-full max-w-[1560px] min-h-[94vh] rounded-[24px] sm:rounded-[32px] overflow-hidden flex flex-col lg:flex-row transition-all duration-300 relative ${
          highContrast
            ? 'bg-black border-2 border-yellow-400 shadow-none'
            : 'bg-[#F4F5FB] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.08),0_0_1px_1px_rgba(0,0,0,0.04)] border border-white/60'
        }`}
      >
        {/* Left Sidebar (Desktop) / Bottom Nav (Mobile) */}
        <Sidebar />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden pb-20 lg:pb-0">
          {/* Top Bar with Search Pill, Status, & Actions */}
          <TopBar onToggleMic={handleToggleMic} />

          {/* Live Status Strip */}
          <LiveStatusStrip />

          {/* Turn-by-Turn Google Maps Navigation Banner / Fallback */}
          <GoogleMapsNavBanner />

          {/* Scrollable Viewport Stage */}
          <main className="flex-1 p-2.5 sm:p-5 lg:p-7 overflow-y-auto" role="main">
            {activeTab === 'dashboard' && <DashboardPage {...commonPageProps} />}
            {activeTab === 'detection' && <DetectionPage {...commonPageProps} />}
            {activeTab === 'navigation' && <NavigationPage />}
            {activeTab === 'voice' && (
              <VoicePage onStartMic={startMicrophone} onStopMic={stopMicrophone} />
            )}
            {activeTab === 'emergency' && <EmergencyPage />}
            {activeTab === 'settings' && <SettingsPage />}
          </main>
        </div>
      </div>
    </div>
  );
}
