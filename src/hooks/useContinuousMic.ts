/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { useStatsStore } from '../store/statsStore';
import { routeVoiceCommand, registerVoiceRouterProviders } from '../services/voiceRouter';
import { askGeneralQuestion, formatSpecificError, AppContextPayload } from '../services/gemini';
import { getApiKey, notifyApiKeyMissing } from '../services/apiKey';
import { audioFeedback } from '../services/audioFeedback';
import { speechQueue, SpeechPriority } from '../services/speechQueue';

// Cross-browser SpeechRecognition constructor
const SpeechRecognitionAPI =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

export function useContinuousMic() {
  const micStatus = useAppStore((s) => s.micStatus);
  const setMicStatus = useAppStore((s) => s.setMicStatus);
  const setMicLevel = useAppStore((s) => s.setMicLevel);
  const setIsProcessingAudio = useAppStore((s) => s.setIsProcessingAudio);
  const setLastTranscript = useAppStore((s) => s.setLastTranscript);
  const setLastUtteranceResult = useAppStore((s) => s.setLastUtteranceResult);
  const setLastErrorDebug = useAppStore((s) => s.setLastErrorDebug);
  const setKeyMissingAlert = useAppStore((s) => s.setKeyMissingAlert);
  const announceAria = useAppStore((s) => s.announceAria);
  const language = useAppStore((s) => s.language);

  // Requirement 3: ONE SpeechRecognition instance only, kept in a ref
  const recognitionRef = useRef<any>(null);

  // Requirement 3: State flags: isListening, isSpeaking, isStarting
  const isListeningRef = useRef<boolean>(false);
  const isSpeakingRef = useRef<boolean>(false);
  const isStartingRef = useRef<boolean>(false);
  const isExplicitlyStoppedRef = useRef<boolean>(false);

  // Error tracking & backoff
  const consecutiveErrorCountRef = useRef<number>(0);
  const restartTimerRef = useRef<any>(null);
  const animFrameRef = useRef<number | null>(null);

  // User gesture state for prompt and recovery button
  const [needsUserGesture, setNeedsUserGesture] = useState<boolean>(() => {
    // If not previously granted or gestured in this session
    return typeof window !== 'undefined' && !sessionStorage.getItem('vision_ai_mic_gestured');
  });

  /**
   * Dispatches speech transcript to Local Command Router first,
   * then falls back to Gemini general query if no local command matches.
   */
  const handleRecognizedSpeech = useCallback(
    async (rawTranscript: string) => {
      const transcript = rawTranscript.trim();
      if (!transcript) return;

      console.log('[VISION_AI Speech Heard]', transcript);
      setLastTranscript(transcript);
      setLastErrorDebug(null);

      // Never process speech if assistant is speaking
      if (useAppStore.getState().isSpeaking || isSpeakingRef.current) {
        return;
      }

      // 1. Try Local Command Router first (works completely offline with 0 API keys)
      try {
        const localResult = await routeVoiceCommand(transcript);
        if (localResult.matched) {
          setLastUtteranceResult(
            transcript,
            localResult.commandName || 'local_command',
            localResult.spokenReply || ''
          );
          setLastErrorDebug(null);
          return;
        }
      } catch (localErr) {
        console.error('Local command error:', localErr);
      }

      // 2. Check internet connectivity
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const offlineMsg = 'You are offline.';
        console.warn('Network offline: navigator.onLine is false');
        setLastErrorDebug('You are offline.');
        speechQueue.speak(offlineMsg, SpeechPriority.ASSISTANT_REPLY);
        return;
      }

      // 3. Check if active AI key exists
      const apiKey = getApiKey();
      if (!apiKey) {
        const fallbackMsg = 'I did not understand. Say open settings to add your API key.';
        setLastUtteranceResult(transcript, 'unknown', fallbackMsg);
        setLastErrorDebug('AI API key is missing. Please add it in Settings.');
        setKeyMissingAlert(true);
        speechQueue.speak(fallbackMsg, SpeechPriority.ASSISTANT_REPLY);
        return;
      }

      // 4. Send to Gemini as a general query
      setIsProcessingAudio(true);
      try {
        const app = useAppStore.getState();
        const stats = useStatsStore.getState();

        const lastObjects = stats.liveDetections.slice(0, 5).map((d) => ({
          class: d.className,
          direction: d.direction,
          distance: d.distanceLabel,
        }));

        const context: AppContextPayload = {
          detectionOn: app.detectionActive,
          navigationActive: app.navigationActive,
          destination: app.destination,
          currentLocation: {
            lat: app.currentLocation.lat,
            lng: app.currentLocation.lng,
            address: app.currentLocation.address,
          },
          lastDetectedObjects: lastObjects,
          deviceTime: new Date().toISOString(),
          recentTurns: app.conversationHistory.slice(-5),
        };

        const reply = await askGeneralQuestion(transcript, context);
        setLastUtteranceResult(transcript, 'general_question', reply);
        speechQueue.speak(reply, SpeechPriority.ASSISTANT_REPLY);
        stats.recordVoiceCommandSuccess(transcript.trim() || 'general_question', reply);
        setLastErrorDebug(null);
      } catch (geminiErr: any) {
        const { spoken } = formatSpecificError(geminiErr);
        speechQueue.speak(spoken, SpeechPriority.ASSISTANT_REPLY);
      } finally {
        setIsProcessingAudio(false);
      }
    },
    [setLastTranscript, setLastUtteranceResult, setLastErrorDebug, setKeyMissingAlert, setIsProcessingAudio]
  );

  /**
   * Requirement 3: Safe start on the single SpeechRecognition instance
   */
  const safeStartRecognition = useCallback(() => {
    if (!SpeechRecognitionAPI) {
      const err = 'Speech recognition not supported in this browser. Please use Google Chrome.';
      console.warn(err);
      setLastErrorDebug(err);
      setMicStatus('error');
      return;
    }

    if (isExplicitlyStoppedRef.current) {
      console.log('[Mic] Not starting: explicitly stopped by user');
      return;
    }

    if (isSpeakingRef.current || useAppStore.getState().isSpeaking) {
      console.log('[Mic] Not starting: app is speaking');
      return;
    }

    if (isListeningRef.current || isStartingRef.current) {
      return;
    }

    const rec = recognitionRef.current;
    if (!rec) return;

    isStartingRef.current = true;
    try {
      rec.start();
      console.log('[Mic] recognition.start() called');
    } catch (err: any) {
      isStartingRef.current = false;
      // Requirement 3: wrap in try/catch and ignore "InvalidStateError"
      if (err?.name === 'InvalidStateError' || String(err?.message || err).includes('InvalidStateError')) {
        console.log('[Mic] Ignored InvalidStateError: recognition already running or starting');
      } else {
        console.warn('[Mic] Unexpected start error:', err);
      }
    }
  }, [setLastErrorDebug, setMicStatus]);

  /**
   * Requirement 2: Request mic permission first on user gesture
   */
  const requestMicPermissionAndStart = useCallback(async () => {
    try {
      console.log('[Mic] Requesting getUserMedia permission with audio: true...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      console.log('[Mic] Microphone permission confirmed via user gesture.');

      if (typeof window !== 'undefined') {
        sessionStorage.setItem('vision_ai_mic_gestured', 'true');
      }
      setNeedsUserGesture(false);
      isExplicitlyStoppedRef.current = false;
      consecutiveErrorCountRef.current = 0;
      setLastErrorDebug(null);

      audioFeedback.playMicStart();
      safeStartRecognition();
    } catch (err: any) {
      console.error('[Mic] getUserMedia permission error:', err);
      setMicStatus('error');
      setNeedsUserGesture(true);
      const isIframe = typeof window !== 'undefined' && window.self !== window.top;
      if (isIframe) {
        const msg = 'Microphone access failed. In preview mode, voice control may not work inside an iframe. Open in a new tab or tap to try again.';
        setLastErrorDebug('In iframe: Microphone permission restricted. Open in a new tab.');
        speechQueue.speak(msg, SpeechPriority.URGENT_OBSTACLE);
      } else {
        const msg = 'Microphone permission is blocked. Please allow microphone access in browser settings.';
        setLastErrorDebug(msg);
        speechQueue.speak(msg, SpeechPriority.URGENT_OBSTACLE);
      }
    }
  }, [safeStartRecognition, setLastErrorDebug, setMicStatus]);

  /**
   * Requirement 3: Build the single SpeechRecognition instance once
   */
  useEffect(() => {
    if (!SpeechRecognitionAPI) {
      setLastErrorDebug('Speech recognition not supported in this browser. Please use Chrome.');
      setMicStatus('error');
      return;
    }

    if (recognitionRef.current) {
      return; // Already initialized single instance
    }

    const recognition = new SpeechRecognitionAPI();

    // Requirement 3 settings:
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-IN';
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      console.log('[Mic] recognition onstart event fired');
      isStartingRef.current = false;
      isListeningRef.current = true;
      setMicStatus('listening');
      announceAria('Microphone listening');
    };

    // Requirement 3: Reset error counter on successful result
    recognition.onresult = (event: any) => {
      consecutiveErrorCountRef.current = 0;
      const lastIndex = event.results.length - 1;
      if (lastIndex >= 0) {
        const result = event.results[lastIndex];
        if (result && result[0]) {
          const transcript = result[0].transcript;
          handleRecognizedSpeech(transcript);
        }
      }
    };

    // Requirement 1: Handle recognition.onerror with real error value and announcements
    recognition.onerror = (event: any) => {
      const err = String(event?.error || '').toLowerCase().trim();

      // no-speech / aborted: routine SpeechRecognition lifecycle events, NOT failures.
      // - 'no-speech' occurs during periods of silence and is expected in continuous listening.
      // - 'aborted' occurs when recognition is intentionally stopped (e.g. before TTS speaks or on pause).
      if (!err || err === 'no-speech' || err === 'aborted' || err.includes('no-speech') || err.includes('aborted')) {
        return;
      }

      console.warn('[Mic] Recognition error event:', err);
      setLastErrorDebug(`event.error: ${err}`);

      // Count real error
      consecutiveErrorCountRef.current += 1;

      const isIframe = typeof window !== 'undefined' && window.self !== window.top;

      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setMicStatus('error');
        setNeedsUserGesture(true);
        if (isIframe) {
          setLastErrorDebug('In iframe: Microphone permission restricted. Open in a new tab.');
          speechQueue.speak(
            'Microphone permission is restricted in preview mode. Open in a new tab or tap to retry.',
            SpeechPriority.URGENT_OBSTACLE
          );
        } else {
          speechQueue.speak(
            'Microphone permission is blocked. Please allow microphone access in browser settings.',
            SpeechPriority.URGENT_OBSTACLE
          );
        }
      } else if (err === 'audio-capture') {
        setMicStatus('error');
        setNeedsUserGesture(true);
        speechQueue.speak(
          "I can't access the microphone. Please close other apps using it.",
          SpeechPriority.URGENT_OBSTACLE
        );
      } else if (err === 'network') {
        setMicStatus('error');
        speechQueue.speak('Speech recognition needs internet.', SpeechPriority.URGENT_OBSTACLE);
      }
    };

    // Requirement 3: in onend, restart after 800-1000 ms using setTimeout (never instantly)
    recognition.onend = () => {
      console.log('[Mic] recognition onend event fired');
      isStartingRef.current = false;
      isListeningRef.current = false;

      if (isExplicitlyStoppedRef.current) {
        setMicStatus('paused');
        return;
      }

      // Never run recognition and speechSynthesis at the same time
      if (isSpeakingRef.current || useAppStore.getState().isSpeaking) {
        return;
      }

      // Requirement 3: Do NOT give up permanently after 3 quick stops!
      // Show a big "Tap to enable voice" button and speak "Tap the screen to restart voice control" instead.
      if (consecutiveErrorCountRef.current >= 3) {
        setMicStatus('error');
        setNeedsUserGesture(true);
        const isIframe = typeof window !== 'undefined' && window.self !== window.top;
        if (isIframe) {
          setLastErrorDebug('In iframe: Voice control interrupted in preview mode. Open in a new tab.');
          speechQueue.speak(
            'Voice control was interrupted in preview mode. Tap open in a new tab or tap to restart.',
            SpeechPriority.ASSISTANT_REPLY
          );
        } else {
          speechQueue.speak('Tap the screen to restart voice control', SpeechPriority.ASSISTANT_REPLY);
        }
        return;
      }

      // Exponential backoff on real errors (1s, 2s, 4s)
      let delay = 900; // default 800-1000 ms
      if (consecutiveErrorCountRef.current > 0) {
        delay = Math.min(4000, 1000 * Math.pow(2, consecutiveErrorCountRef.current - 1));
      }

      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (!isExplicitlyStoppedRef.current && !isSpeakingRef.current) {
          safeStartRecognition();
        }
      }, delay);
    };

    recognitionRef.current = recognition;

    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      try {
        recognition.abort();
      } catch (_) {}
      recognitionRef.current = null;
    };
  }, [handleRecognizedSpeech, safeStartRecognition, announceAria, setLastErrorDebug, setMicStatus]);

  /**
   * Requirement 4: Avoid conflicts with text-to-speech
   * - Before speaking: recognition.abort() and set isSpeaking = true
   * - After utterance.onend: wait 500 ms, then restart recognition
   * - Never run recognition and speechSynthesis at the same time
   */
  useEffect(() => {
    speechQueue.registerSpeechCoordination(
      // onBeforeSpeaking
      () => {
        isSpeakingRef.current = true;
        if (restartTimerRef.current) {
          clearTimeout(restartTimerRef.current);
          restartTimerRef.current = null;
        }
        if (recognitionRef.current && isListeningRef.current) {
          try {
            recognitionRef.current.abort();
          } catch (_) {}
        }
        isListeningRef.current = false;
        isStartingRef.current = false;
      },
      // onAfterSpeaking (already runs after 500ms delay in speechQueue)
      () => {
        isSpeakingRef.current = false;
        if (!isExplicitlyStoppedRef.current && !needsUserGesture) {
          safeStartRecognition();
        }
      }
    );
  }, [safeStartRecognition, needsUserGesture]);

  /**
   * Requirement 6: Resume handling
   * When the app becomes visible again (e.g. after returning from Google Maps),
   * restart recognition after 1 second.
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        console.log('[Mic] App became visible again, checking recognition...');
        if (!isExplicitlyStoppedRef.current && !needsUserGesture) {
          setTimeout(() => {
            if (!isSpeakingRef.current && !isListeningRef.current && !needsUserGesture) {
              safeStartRecognition();
            }
          }, 1000);
        }
      }
    };

    const handleWindowFocus = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        !isExplicitlyStoppedRef.current &&
        !isListeningRef.current &&
        !isSpeakingRef.current &&
        !needsUserGesture
      ) {
        setTimeout(() => {
          if (!needsUserGesture) {
            safeStartRecognition();
          }
        }, 1000);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [safeStartRecognition, needsUserGesture]);

  /**
   * Waveform monitor level simulation for smooth visualizer without audio hardware locking
   */
  useEffect(() => {
    const updateLevel = () => {
      if (isListeningRef.current && !isSpeakingRef.current) {
        // Subtle active breathing waveform
        const pulse = 0.35 + 0.3 * Math.sin(Date.now() / 250);
        setMicLevel(pulse);
      } else {
        setMicLevel(0);
      }
      animFrameRef.current = requestAnimationFrame(updateLevel);
    };

    animFrameRef.current = requestAnimationFrame(updateLevel);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [setMicLevel]);

  const startMicrophone = useCallback(() => {
    isExplicitlyStoppedRef.current = false;
    consecutiveErrorCountRef.current = 0;
    setLastErrorDebug(null);

    // Requirement 3: Ensure all getUserMedia and SpeechRecognition happen after user gesture tap
    if (needsUserGesture) {
      console.log('[Mic] Waiting for user gesture tap on overlay before starting microphone');
      return;
    }

    audioFeedback.playMicStart();
    safeStartRecognition();
  }, [needsUserGesture, safeStartRecognition, setLastErrorDebug]);

  const stopMicrophone = useCallback(() => {
    isExplicitlyStoppedRef.current = true;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (_) {}
    }

    isListeningRef.current = false;
    isStartingRef.current = false;

    setMicLevel(0);
    setMicStatus('paused');
    announceAria('Microphone paused');
    audioFeedback.playMicStop();
  }, [setMicLevel, setMicStatus, announceAria]);

  // Register with voice command router
  useEffect(() => {
    registerVoiceRouterProviders(
      () => null,
      stopMicrophone,
      startMicrophone
    );
  }, [stopMicrophone, startMicrophone]);

  return {
    micStatus,
    startMicrophone,
    stopMicrophone,
    requestMicPermissionAndStart,
    needsUserGesture,
    setNeedsUserGesture,
  };
}
