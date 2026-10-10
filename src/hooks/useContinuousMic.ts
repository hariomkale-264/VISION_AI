/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { useStatsStore } from '../store/statsStore';
import { routeVoiceCommand, registerVoiceRouterProviders } from '../services/voiceRouter';
import { askGeneralQuestion, formatSpecificError, AppContextPayload } from '../services/gemini';
import { getApiKey, notifyApiKeyMissing } from '../services/apiKey';
import { audioFeedback } from '../services/audioFeedback';
import { speechQueue, SpeechPriority } from '../services/speechQueue';

// Cross-browser SpeechRecognition
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

  // References
  const recognitionRef = useRef<any>(null);
  const isExplicitlyStoppedRef = useRef(false);
  const restartTimeoutRef = useRef<any>(null);
  const lastStartTimeRef = useRef<number>(0);
  const quickRetriesCountRef = useRef<number>(0);

  // AudioContext for live waveform visualizer
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  /**
   * Dispatches speech transcript to Local Command Router first,
   * and falls back to Gemini general question if no local command matches.
   */
  const handleRecognizedSpeech = useCallback(
    async (rawTranscript: string) => {
      const transcript = rawTranscript.trim();
      if (!transcript) return;

      console.log('[VISION_AI Speech Heard]', transcript);
      setLastTranscript(transcript);
      setLastErrorDebug(null);

      // Don't process while assistant is speaking
      if (useAppStore.getState().isSpeaking) {
        return;
      }

      // 1. Try Local Command Router first (works offline without Gemini and with no key!)
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
        console.error('Network offline: navigator.onLine is false');
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

      // 4. Send to Gemini as a general question
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
        const { spoken, debug } = formatSpecificError(geminiErr);
        speechQueue.speak(spoken, SpeechPriority.ASSISTANT_REPLY);
      } finally {
        setIsProcessingAudio(false);
      }
    },
    [setLastTranscript, setLastUtteranceResult, setLastErrorDebug, setKeyMissingAlert, setIsProcessingAudio]
  );

  /**
   * Initializes or re-initializes SpeechRecognition
   */
  const startSpeechRecognition = useCallback(() => {
    if (!SpeechRecognitionAPI) {
      const err = 'Speech recognition not supported in this browser. Please use Google Chrome.';
      console.error(err);
      setLastErrorDebug(err);
      return;
    }

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (_) {}
        recognitionRef.current = null;
      }

      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = language || 'en-US';

      recognition.onstart = () => {
        lastStartTimeRef.current = Date.now();
        setMicStatus('listening');
        announceAria('Microphone listening');
      };

      recognition.onresult = (event: any) => {
        const lastIndex = event.results.length - 1;
        if (lastIndex >= 0) {
          const result = event.results[lastIndex];
          if (result && result[0]) {
            const transcript = result[0].transcript;
            handleRecognizedSpeech(transcript);
          }
        }
      };

      recognition.onerror = (event: any) => {
        const errType = event.error;
        console.error('[SpeechRecognition Error]', errType, event);

        // Requirement 5: Never show error banner or announce for no-speech in continuous mode
        if (errType === 'no-speech') {
          return;
        }

        let spokenMessage = '';
        let debugLine = `SpeechRecognition error: ${errType}`;

        switch (errType) {
          case 'network':
            spokenMessage = 'Speech service is not reachable. Please use Chrome and allow the microphone.';
            debugLine = 'Speech service is not reachable. Please check network connection.';
            break;
          case 'not-allowed':
            spokenMessage = 'Microphone permission is blocked.';
            debugLine = 'Microphone permission is blocked. Please allow microphone access.';
            break;
          default:
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
              spokenMessage = 'You are offline.';
              debugLine = 'You are offline.';
            } else {
              return;
            }
            break;
        }

        setLastErrorDebug(debugLine);
        speechQueue.speak(spokenMessage, SpeechPriority.ASSISTANT_REPLY);
      };

      recognition.onend = () => {
        if (isExplicitlyStoppedRef.current) {
          setMicStatus('paused');
          return;
        }

        const runDuration = Date.now() - lastStartTimeRef.current;
        if (runDuration < 2000) {
          quickRetriesCountRef.current += 1;
        } else {
          quickRetriesCountRef.current = 0;
        }

        // Limit of 3 quick retries before announcing problem
        if (quickRetriesCountRef.current > 3) {
          const problemMsg = 'Speech service stopped repeatedly. Please check Chrome microphone permissions.';
          console.error(problemMsg);
          setLastErrorDebug('Repeated speech recognition failure (3 quick stops)');
          speechQueue.speak(problemMsg, SpeechPriority.ASSISTANT_REPLY);
          setMicStatus('error');
          return;
        }

        // Auto-restart after 500 ms (continuous listening)
        if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = setTimeout(() => {
          if (!isExplicitlyStoppedRef.current) {
            try {
              recognition.start();
            } catch (_) {
              startSpeechRecognition();
            }
          }
        }, 500);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e: any) {
      console.error('Failed to start speech recognition:', e);
      setLastErrorDebug(String(e.message || e));
      setMicStatus('error');
    }
  }, [language, setMicStatus, announceAria, handleRecognizedSpeech, setLastErrorDebug]);

  /**
   * Initializes audio context and analyser for live waveform level animation
   */
  const startAudioWaveformMonitor = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(1, avg / 80);

        if (useAppStore.getState().isSpeaking) {
          setMicLevel(0);
        } else {
          setMicLevel(normalized);
        }

        animFrameRef.current = requestAnimationFrame(checkLevel);
      };

      checkLevel();
    } catch (err: any) {
      console.warn('Audio level monitor error:', err);
    }
  }, [setMicLevel]);

  const startMicrophone = useCallback(() => {
    isExplicitlyStoppedRef.current = false;
    quickRetriesCountRef.current = 0;
    setLastErrorDebug(null);

    audioFeedback.playMicStart();
    startSpeechRecognition();
    startAudioWaveformMonitor();
  }, [startSpeechRecognition, startAudioWaveformMonitor, setLastErrorDebug]);

  const stopMicrophone = useCallback(() => {
    isExplicitlyStoppedRef.current = true;
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (_) {}
      recognitionRef.current = null;
    }

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    setMicLevel(0);
    setMicStatus('paused');
    announceAria('Microphone paused');
    audioFeedback.playMicStop();
  }, [setMicLevel, setMicStatus, announceAria]);

  // Register with voice command router
  useEffect(() => {
    registerVoiceRouterProviders(
      () => null, // camera getter handled by camera component
      stopMicrophone,
      startMicrophone
    );
  }, [stopMicrophone, startMicrophone]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMicrophone();
    };
  }, [stopMicrophone]);

  return {
    micStatus,
    startMicrophone,
    stopMicrophone,
  };
}
