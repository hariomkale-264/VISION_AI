/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

class AudioFeedbackService {
  private ctx: AudioContext | null = null;
  private lastProximityBeepTime = 0;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Pleasant rising chime played when microphone starts listening.
   */
  public playMicStart(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(1050, now + 0.12);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.18);

      this.vibrate([30, 40, 40]);
    } catch (e) {
      console.warn('Audio feedback error:', e);
    }
  }

  /**
   * Gentle falling tone played when microphone stops listening.
   */
  public playMicStop(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(750, now);
      osc.frequency.exponentialRampToValueAtTime(380, now + 0.15);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.18);

      this.vibrate([60]);
    } catch (e) {
      console.warn('Audio feedback error:', e);
    }
  }

  /**
   * Obstacle proximity alert that pulses and speeds up as obstacle gets closer.
   * @param proximity 'very close' | 'close' | 'far'
   */
  public playProximityAlert(proximity: 'very close' | 'close' | 'far'): void {
    const now = Date.now();
    // Throttle beeps depending on closeness
    const interval = proximity === 'very close' ? 350 : proximity === 'close' ? 800 : 1800;
    if (now - this.lastProximityBeepTime < interval) {
      return;
    }
    this.lastProximityBeepTime = now;

    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const freq = proximity === 'very close' ? 980 : proximity === 'close' ? 680 : 440;
      const duration = proximity === 'very close' ? 0.08 : 0.12;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + duration);

      if (proximity === 'very close') {
        this.vibrate([80, 50, 80]);
      } else if (proximity === 'close') {
        this.vibrate([60]);
      }
    } catch (e) {
      console.warn('Proximity beep error:', e);
    }
  }

  /**
   * Device haptic vibration helper.
   */
  public vibrate(pattern: number | number[]): void {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (_) {}
    }
  }
}

export const audioFeedback = new AudioFeedbackService();
