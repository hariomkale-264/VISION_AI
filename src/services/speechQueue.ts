/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppStore } from '../store/appStore';

export enum SpeechPriority {
  URGENT_OBSTACLE = 1,
  NAVIGATION = 2,
  ASSISTANT_REPLY = 3,
  STATUS = 4,
}

interface QueuedUtterance {
  id: string;
  text: string;
  priority: SpeechPriority;
  timestamp: number;
  onStart?: () => void;
  onEnd?: () => void;
}

class SpeechQueueService {
  private queue: QueuedUtterance[] = [];
  private isSpeaking = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private resumeMicTimeout: any = null;
  private lastSpokenText = '';
  private lastSpokenTime = 0;
  private onBeforeSpeakingHandler: (() => void) | null = null;
  private onAfterSpeakingHandler: (() => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        // Preload voices
        window.speechSynthesis.getVoices();
      };
    }
  }

  /**
   * Registers coordination callbacks to abort SpeechRecognition before speaking
   * and restart it 500ms after speech finishes.
   */
  public registerSpeechCoordination(
    onBeforeSpeaking: () => void,
    onAfterSpeaking: () => void
  ) {
    this.onBeforeSpeakingHandler = onBeforeSpeaking;
    this.onAfterSpeakingHandler = onAfterSpeaking;
  }

  public speak(
    text: string,
    priority: SpeechPriority = SpeechPriority.ASSISTANT_REPLY,
    options?: { onStart?: () => void; onEnd?: () => void; allowDuplicate?: boolean }
  ): void {
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    const cleanText = text.trim();
    const now = Date.now();

    // Prevent immediate repeated duplicate announcements within 2.5 seconds (unless explicitly allowed)
    if (!options?.allowDuplicate && cleanText === this.lastSpokenText && now - this.lastSpokenTime < 2500) {
      return;
    }

    const item: QueuedUtterance = {
      id: `speech-${now}-${Math.random().toString(36).substring(2, 6)}`,
      text: cleanText,
      priority,
      timestamp: now,
      onStart: options?.onStart,
      onEnd: options?.onEnd,
    };

    // If URGENT_OBSTACLE and currently speaking a lower priority, cancel current and speak immediately
    if (priority === SpeechPriority.URGENT_OBSTACLE && this.isSpeaking) {
      window.speechSynthesis.cancel();
      this.isSpeaking = false;
      this.queue.unshift(item);
      this.processNext();
      return;
    }

    // Insert sorted by priority (1 is highest)
    const insertIdx = this.queue.findIndex((q) => q.priority > priority);
    if (insertIdx === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(insertIdx, 0, item);
    }

    // Keep queue length manageable (never queue more than 4 items)
    if (this.queue.length > 4) {
      this.queue = this.queue.slice(0, 4);
    }

    if (!this.isSpeaking) {
      this.processNext();
    }
  }

  private processNext(): void {
    if (this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift()!;
    this.isSpeaking = true;
    this.lastSpokenText = item.text;
    this.lastSpokenTime = Date.now();

    const { speechRate, speechVolume, language, setIsSpeaking, announceAria } = useAppStore.getState();

    // Clear any pending mic resume
    if (this.resumeMicTimeout) {
      clearTimeout(this.resumeMicTimeout);
      this.resumeMicTimeout = null;
    }

    // Requirement 4: Before speaking: recognition.abort() and set isSpeaking = true
    this.isSpeaking = true;
    setIsSpeaking(true);
    this.onBeforeSpeakingHandler?.();
    announceAria(item.text);

    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.rate = speechRate || 1.0;
    utterance.volume = speechVolume !== undefined ? speechVolume : 1.0;
    utterance.lang = language || 'en-US';

    // Try to pick matching voice
    const voices = window.speechSynthesis.getVoices();
    const matchedVoice = voices.find((v) => v.lang.startsWith(utterance.lang.slice(0, 2)));
    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }

    utterance.onstart = () => {
      item.onStart?.();
    };

    // Safety watchdog: Chrome SpeechSynthesis can silently stall or drop onend
    const maxDuration = Math.max(4500, item.text.length * 120);
    const watchdogTimeout = setTimeout(() => {
      console.warn('[SpeechQueue] Watchdog timeout triggered, forcing finish');
      handleFinished();
    }, maxDuration);

    const handleFinished = () => {
      clearTimeout(watchdogTimeout);
      item.onEnd?.();
      this.currentUtterance = null;

      // Check if more items in queue
      if (this.queue.length > 0) {
        this.processNext();
      } else {
        // Requirement 4: After utterance.onend: wait 500 ms, then restart recognition
        this.resumeMicTimeout = setTimeout(() => {
          this.isSpeaking = false;
          setIsSpeaking(false);
          this.onAfterSpeakingHandler?.();
        }, 500);
      }
    };

    utterance.onend = handleFinished;
    utterance.onerror = (e) => {
      console.warn('SpeechSynthesis error:', e);
      handleFinished();
    };

    this.currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  public cancelAll(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.queue = [];
    this.currentUtterance = null;
    if (this.resumeMicTimeout) {
      clearTimeout(this.resumeMicTimeout);
      this.resumeMicTimeout = null;
    }
    this.resumeMicTimeout = setTimeout(() => {
      this.isSpeaking = false;
      useAppStore.getState().setIsSpeaking(false);
      this.onAfterSpeakingHandler?.();
    }, 500);
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}

export const speechQueue = new SpeechQueueService();
