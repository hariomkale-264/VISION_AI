/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Mic, Eye, MapPin, CheckCircle, ShieldAlert, ArrowRight } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { speechQueue, SpeechPriority } from '../services/speechQueue';

interface OnboardingModalProps {
  onComplete: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ onComplete }) => {
  const [step, setStep] = useState<number>(0);
  const [micGranted, setMicGranted] = useState(false);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);

  const highContrast = useAppStore((s) => s.highContrast);
  const setOnboardingComplete = useAppStore((s) => s.setOnboardingComplete);

  // Spoken introduction on mount
  useEffect(() => {
    speechQueue.speak(
      'Welcome to VISION AI, your voice first assistive companion. We will now set up your microphone, camera, and location permissions.',
      SpeechPriority.ASSISTANT_REPLY
    );
  }, []);

  const requestMic = async () => {
    speechQueue.speak('Requesting microphone access for hands free voice commands.', SpeechPriority.STATUS);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicGranted(true);
      speechQueue.speak('Microphone access granted.', SpeechPriority.STATUS);
      setStep(1);
    } catch (err) {
      console.warn('Mic permission error:', err);
      speechQueue.speak(
        'Microphone was denied. Please allow microphone access in your browser settings so you can speak to VISION AI.',
        SpeechPriority.ASSISTANT_REPLY
      );
    }
  };

  const requestCamera = async () => {
    speechQueue.speak('Requesting camera access to detect obstacles and describe your surroundings.', SpeechPriority.STATUS);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      stream.getTracks().forEach((t) => t.stop());
      setCameraGranted(true);
      speechQueue.speak('Camera access granted.', SpeechPriority.STATUS);
      setStep(2);
    } catch (err) {
      console.warn('Camera permission error:', err);
      speechQueue.speak(
        'Camera access was denied. Please allow camera permissions in your browser settings to enable obstacle detection.',
        SpeechPriority.ASSISTANT_REPLY
      );
    }
  };

  const requestLocation = async () => {
    speechQueue.speak('Requesting location access to guide you with turn by turn walking directions.', SpeechPriority.STATUS);
    if (!('geolocation' in navigator)) {
      speechQueue.speak('Location is not supported on this device.', SpeechPriority.STATUS);
      finishOnboarding();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      () => {
        setLocationGranted(true);
        speechQueue.speak('Location access granted. Setup complete.', SpeechPriority.STATUS);
        setStep(3);
      },
      () => {
        speechQueue.speak(
          'Location access was denied. You can still use obstacle detection and voice features.',
          SpeechPriority.ASSISTANT_REPLY
        );
        setStep(3);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const finishOnboarding = () => {
    setOnboardingComplete(true);
    speechQueue.speak(
      'VISION AI is ready. You can say start detection, navigate me to a place, or what is in front of me.',
      SpeechPriority.ASSISTANT_REPLY
    );
    onComplete();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
    >
      <div
        className={`w-full max-w-lg rounded-[32px] p-6 sm:p-8 shadow-2xl transition-all ${
          highContrast
            ? 'bg-black border-2 border-yellow-400 text-yellow-400'
            : 'bg-white text-gray-900 border border-gray-100'
        }`}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-[#14141C] flex items-center justify-center text-white">
            <Eye className="w-6 h-6 text-sky-400" />
          </div>
          <div>
            <h2 id="onboarding-title" className="text-xl font-extrabold tracking-tight">
              Welcome to VISION_AI
            </h2>
            <p className="text-xs font-semibold opacity-75">Voice-First Assistive Assistant</p>
          </div>
        </div>

        {/* Mandatory Safety Disclaimer */}
        <div
          className={`flex items-start gap-3 p-3.5 rounded-2xl mb-6 text-xs leading-relaxed ${
            highContrast
              ? 'bg-zinc-900 border border-yellow-400/80 text-yellow-300'
              : 'bg-amber-50 border border-amber-200 text-amber-900'
          }`}
        >
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="font-semibold">
            VISION_AI is an assistive tool and does not replace a white cane or guide dog.
          </p>
        </div>

        {/* Permission Steps */}
        <div className="space-y-4 mb-6">
          {/* Step 0: Mic */}
          <div
            className={`p-4 rounded-2xl border flex items-center justify-between transition-all ${
              micGranted
                ? 'bg-emerald-50/50 border-emerald-300 text-emerald-900'
                : step === 0
                ? 'bg-indigo-50/50 border-indigo-400'
                : 'opacity-60 border-gray-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <Mic className="w-5 h-5" />
              <div>
                <h3 className="text-sm font-bold">1. Microphone Access</h3>
                <p className="text-xs opacity-75">Always-on voice commands & questions</p>
              </div>
            </div>
            {micGranted ? (
              <CheckCircle className="w-5 h-5 text-emerald-600" />
            ) : (
              <button
                onClick={requestMic}
                aria-label="Allow microphone access"
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 transition"
              >
                Allow Mic
              </button>
            )}
          </div>

          {/* Step 1: Camera */}
          <div
            className={`p-4 rounded-2xl border flex items-center justify-between transition-all ${
              cameraGranted
                ? 'bg-emerald-50/50 border-emerald-300 text-emerald-900'
                : step === 1
                ? 'bg-indigo-50/50 border-indigo-400'
                : 'opacity-60 border-gray-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <Eye className="w-5 h-5" />
              <div>
                <h3 className="text-sm font-bold">2. Camera Access</h3>
                <p className="text-xs opacity-75">Detect 80+ obstacles & read text</p>
              </div>
            </div>
            {cameraGranted ? (
              <CheckCircle className="w-5 h-5 text-emerald-600" />
            ) : (
              <button
                onClick={requestCamera}
                disabled={step < 1}
                aria-label="Allow camera access"
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 disabled:opacity-40 transition"
              >
                Allow Camera
              </button>
            )}
          </div>

          {/* Step 2: Location */}
          <div
            className={`p-4 rounded-2xl border flex items-center justify-between transition-all ${
              locationGranted
                ? 'bg-emerald-50/50 border-emerald-300 text-emerald-900'
                : step === 2
                ? 'bg-indigo-50/50 border-indigo-400'
                : 'opacity-60 border-gray-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <MapPin className="w-5 h-5" />
              <div>
                <h3 className="text-sm font-bold">3. Location Access</h3>
                <p className="text-xs opacity-75">Spoken turn-by-turn walking routes</p>
              </div>
            </div>
            {locationGranted ? (
              <CheckCircle className="w-5 h-5 text-emerald-600" />
            ) : (
              <button
                onClick={requestLocation}
                disabled={step < 2}
                aria-label="Allow location access"
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-700 disabled:opacity-40 transition"
              >
                Allow GPS
              </button>
            )}
          </div>
        </div>

        {/* Bottom finish action */}
        <button
          onClick={finishOnboarding}
          className={`w-full py-3.5 rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg transition-all min-h-[56px] ${
            highContrast
              ? 'bg-yellow-400 text-black hover:bg-yellow-300'
              : 'bg-[#14141C] text-white hover:bg-gray-800'
          }`}
        >
          <span>Enter VISION_AI</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
