/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface VadConfig {
  sampleRate: number;
  energyThreshold?: number; // RMS threshold to trigger speech (default ~0.02)
  silenceDurationMs?: number; // Silence duration before utterance ends (~1200 ms)
  preRollMs?: number; // Pre-roll buffer length (~300 ms)
  minClipMs?: number; // Minimum clip length (~400 ms)
  maxClipMs?: number; // Maximum clip length (~15000 ms)
  onSpeechStart?: () => void;
  onSpeechEnd?: (audioBuffer: Float32Array, durationMs: number) => void;
  onAudioLevel?: (level: number) => void;
}

export class VoiceActivityDetector {
  private config: Required<VadConfig>;
  private preRollSamples: number;
  private preRollQueue: Float32Array[] = [];
  private preRollQueueSamples = 0;

  private isSpeaking = false;
  private speechSamples: Float32Array[] = [];
  private totalSpeechSamples = 0;
  private silenceSamplesCount = 0;
  private silenceSamplesLimit: number;
  private minSamplesRequired: number;
  private maxSamplesLimit: number;

  constructor(config: VadConfig) {
    this.config = {
      sampleRate: config.sampleRate,
      energyThreshold: config.energyThreshold ?? 0.022,
      silenceDurationMs: config.silenceDurationMs ?? 1200,
      preRollMs: config.preRollMs ?? 300,
      minClipMs: config.minClipMs ?? 400,
      maxClipMs: config.maxClipMs ?? 15000,
      onSpeechStart: config.onSpeechStart ?? (() => {}),
      onSpeechEnd: config.onSpeechEnd ?? (() => {}),
      onAudioLevel: config.onAudioLevel ?? (() => {}),
    };

    this.preRollSamples = Math.floor((this.config.sampleRate * this.config.preRollMs) / 1000);
    this.silenceSamplesLimit = Math.floor((this.config.sampleRate * this.config.silenceDurationMs) / 1000);
    this.minSamplesRequired = Math.floor((this.config.sampleRate * this.config.minClipMs) / 1000);
    this.maxSamplesLimit = Math.floor((this.config.sampleRate * this.config.maxClipMs) / 1000);
  }

  public processChunk(chunk: Float32Array): void {
    // Calculate RMS
    let sumSquares = 0;
    for (let i = 0; i < chunk.length; i++) {
      sumSquares += chunk[i] * chunk[i];
    }
    const rms = Math.sqrt(sumSquares / chunk.length);

    // Normalize level for UI (0 - 1)
    const level = Math.min(1, rms * 8);
    this.config.onAudioLevel(level);

    const isSpeechFrame = rms >= this.config.energyThreshold;

    if (!this.isSpeaking) {
      // Maintain pre-roll circular queue
      this.preRollQueue.push(new Float32Array(chunk));
      this.preRollQueueSamples += chunk.length;

      while (this.preRollQueueSamples > this.preRollSamples && this.preRollQueue.length > 1) {
        const removed = this.preRollQueue.shift()!;
        this.preRollQueueSamples -= removed.length;
      }

      if (isSpeechFrame) {
        this.isSpeaking = true;
        this.silenceSamplesCount = 0;
        this.config.onSpeechStart();

        // Copy pre-roll buffer into speech buffer
        this.speechSamples = [...this.preRollQueue.map((b) => new Float32Array(b))];
        this.totalSpeechSamples = this.preRollQueueSamples;

        // Append current chunk
        this.speechSamples.push(new Float32Array(chunk));
        this.totalSpeechSamples += chunk.length;
      }
    } else {
      // Already speaking
      this.speechSamples.push(new Float32Array(chunk));
      this.totalSpeechSamples += chunk.length;

      if (isSpeechFrame) {
        this.silenceSamplesCount = 0;
      } else {
        this.silenceSamplesCount += chunk.length;
      }

      const reachedSilence = this.silenceSamplesCount >= this.silenceSamplesLimit;
      const reachedMaxDuration = this.totalSpeechSamples >= this.maxSamplesLimit;

      if (reachedSilence || reachedMaxDuration) {
        this.finalizeUtterance();
      }
    }
  }

  private finalizeUtterance(): void {
    this.isSpeaking = false;
    const durationMs = (this.totalSpeechSamples / this.config.sampleRate) * 1000;

    if (this.totalSpeechSamples >= this.minSamplesRequired) {
      // Merge chunks into single Float32Array
      const merged = new Float32Array(this.totalSpeechSamples);
      let offset = 0;
      for (const buffer of this.speechSamples) {
        merged.set(buffer, offset);
        offset += buffer.length;
      }
      this.config.onSpeechEnd(merged, durationMs);
    }

    // Reset speech state
    this.speechSamples = [];
    this.totalSpeechSamples = 0;
    this.silenceSamplesCount = 0;
    this.preRollQueue = [];
    this.preRollQueueSamples = 0;
  }

  public reset(): void {
    this.isSpeaking = false;
    this.speechSamples = [];
    this.totalSpeechSamples = 0;
    this.silenceSamplesCount = 0;
    this.preRollQueue = [];
    this.preRollQueueSamples = 0;
  }
}
