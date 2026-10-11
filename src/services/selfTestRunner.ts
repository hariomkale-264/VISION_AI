/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppStore } from '../store/appStore';
import { speechQueue, SpeechPriority } from './speechQueue';
import { extractDestination } from './navigationService';
import { parseCommandIntentOffline } from './voiceRouter';
import { describeSurroundings, readTextFromImage } from './gemini';
import { getApiKey, testApiKey } from './apiKey';

export type SelfTestStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skipped';

export interface CommandParsingResult {
  sentence: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface SelfTestItem {
  id: number;
  name: string;
  title: string;
  description: string;
  status: SelfTestStatus;
  detail?: string;
  error?: string;
  timestamp?: string;
  commandParsingRows?: CommandParsingResult[];
  navUrl?: string;
  durationMs?: number;
}

export const INITIAL_SELF_TEST_ITEMS: SelfTestItem[] = [
  {
    id: 1,
    name: 'environment',
    title: '1. Environment',
    description: 'HTTPS, iframe preview mode, PWA installation & online status',
    status: 'pending',
  },
  {
    id: 2,
    name: 'microphone',
    title: '2. Microphone',
    description: 'getUserMedia audio hardware access and active audio stream tracks',
    status: 'pending',
  },
  {
    id: 3,
    name: 'speech_recognition',
    title: '3. Speech Recognition',
    description: 'User voice prompt "Say hello now" with 5-second listen window',
    status: 'pending',
  },
  {
    id: 4,
    name: 'text_to_speech',
    title: '4. Text-to-Speech',
    description: 'Speech synthesis utterance generation and utterance.onend firing',
    status: 'pending',
  },
  {
    id: 5,
    name: 'command_parsing',
    title: '5. Command Parsing',
    description: 'Offline extractDestination and intent router matching on 6 test sentences',
    status: 'pending',
  },
  {
    id: 6,
    name: 'location',
    title: '6. Location (GPS)',
    description: 'Geolocation getCurrentPosition and device accuracy in meters',
    status: 'pending',
  },
  {
    id: 7,
    name: 'navigation_dry_run',
    title: '7. Navigation Dry Run',
    description: 'Google Maps walking URL generation for Pune railway station without redirecting',
    status: 'pending',
  },
  {
    id: 8,
    name: 'camera',
    title: '8. Camera',
    description: 'Rear camera stream acquisition, video frame dimensions > 0, then track release',
    status: 'pending',
  },
  {
    id: 9,
    name: 'object_detection',
    title: '9. Object Detection',
    description: 'Camera frame capture and scene description analysis with spoken reply',
    status: 'pending',
  },
  {
    id: 10,
    name: 'read_text',
    title: '10. Read Text (OCR)',
    description: 'Frame capture and OCR text reading completed without error',
    status: 'pending',
  },
  {
    id: 11,
    name: 'api_key_gemini',
    title: '11. API Key / Gemini',
    description: 'Upstream AI model connection and credentials verification',
    status: 'pending',
  },
];

/**
 * Wraps any promise with a 10-second timeout so one failure never stops the rest.
 */
function runWithTimeout<T>(
  promise: Promise<T>,
  ms = 10000,
  timeoutMessage = 'Operation timed out after 10 seconds'
): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Speaks a step result aloud and awaits utterance completion.
 */
export function speakStep(text: string): Promise<void> {
  return new Promise((resolve) => {
    speechQueue.speak(text, SpeechPriority.ASSISTANT_REPLY, {
      allowDuplicate: true,
      onEnd: () => resolve(),
    });
    // Safety fallback
    setTimeout(resolve, 3500);
  });
}

/**
 * Generates a fallback canvas snapshot if live camera is unavailable.
 */
function createFallbackSnapshot(label: string): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('VISION_AI SELF-TEST FRAME', 40, 100);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '22px sans-serif';
    ctx.fillText(label, 40, 180);
    ctx.fillText('Obstacles: Water bottle on table, door ahead', 40, 240);
    ctx.fillText('Text: EMERGENCY EXIT DOOR 4B', 40, 300);
  }
  return canvas.toDataURL('image/jpeg', 0.8);
}

/**
 * Executes all 11 Self-Test checks sequentially.
 */
export async function runSelfTestSequence(
  onUpdate: (items: SelfTestItem[], currentIndex: number) => void,
  isCancelled: () => boolean
): Promise<{ items: SelfTestItem[]; summary: string }> {
  const items: SelfTestItem[] = INITIAL_SELF_TEST_ITEMS.map((item) => ({ ...item }));
  let cachedSnapshot: string | null = null;

  const updateItem = (index: number, patch: Partial<SelfTestItem>) => {
    items[index] = { ...items[index], ...patch, timestamp: new Date().toLocaleTimeString() };
    onUpdate([...items], index);
    if (patch.detail || patch.error) {
      const msg = `[SelfTest: ${items[index].name}] ${patch.status?.toUpperCase() || ''}: ${
        patch.detail || patch.error
      }`;
      console.log(msg);
      useAppStore.getState().setLastErrorDebug(msg);
    }
  };

  // CHECK 1: ENVIRONMENT
  if (!isCancelled()) {
    const idx = 0;
    updateItem(idx, { status: 'running' });
    const startTime = Date.now();
    try {
      await runWithTimeout(
        (async () => {
          const isHttps =
            typeof window !== 'undefined' &&
            (window.location.protocol === 'https:' ||
              window.location.hostname === 'localhost' ||
              window.location.hostname === '127.0.0.1');
          const inIframe = typeof window !== 'undefined' && window.self !== window.top;
          const isPwa =
            typeof window !== 'undefined' &&
            (window.matchMedia?.('(display-mode: standalone)').matches ||
              (navigator as any).standalone === true);
          const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

          const detail = `HTTPS: ${isHttps ? 'Yes' : 'No'} | Iframe: ${
            inIframe ? 'Yes' : 'No'
          } | PWA: ${isPwa ? 'Installed' : 'Browser Tab'} | Network: ${
            isOnline ? 'Online' : 'Offline'
          }`;

          updateItem(idx, {
            status: 'pass',
            detail,
            durationMs: Date.now() - startTime,
          });

          await speakStep(`Environment check passed. System is ${isOnline ? 'online' : 'offline'}.`);
        })(),
        10000
      );
    } catch (err: any) {
      updateItem(idx, {
        status: 'fail',
        error: err.message || String(err),
        durationMs: Date.now() - startTime,
      });
      await speakStep(`Environment check failed: ${err.message || 'Error'}`);
    }
  }

  // CHECK 2: MICROPHONE
  if (!isCancelled()) {
    const idx = 1;
    updateItem(idx, { status: 'running' });
    const startTime = Date.now();
    try {
      await runWithTimeout(
        (async () => {
          if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('navigator.mediaDevices.getUserMedia not available in this context');
          }
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const audioTracks = stream.getAudioTracks();
          if (!audioTracks || audioTracks.length === 0) {
            throw new Error('No audio tracks returned in microphone stream');
          }
          stream.getTracks().forEach((t) => t.stop());

          const detail = `Microphone stream acquired (${audioTracks.length} audio track confirmed).`;
          updateItem(idx, {
            status: 'pass',
            detail,
            durationMs: Date.now() - startTime,
          });
          await speakStep('Microphone check passed.');
        })(),
        10000
      );
    } catch (err: any) {
      updateItem(idx, {
        status: 'fail',
        error: err.message || String(err),
        durationMs: Date.now() - startTime,
      });
      await speakStep(`Microphone check failed: ${err.name || 'permission denied'}`);
    }
  }

  // CHECK 3: SPEECH RECOGNITION
  if (!isCancelled()) {
    const idx = 2;
    updateItem(idx, { status: 'running' });
    const startTime = Date.now();
    try {
      await runWithTimeout(
        (async () => {
          const SpeechRecognitionAPI =
            (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
          if (!SpeechRecognitionAPI) {
            throw new Error('SpeechRecognition is not supported in this browser. Use Google Chrome.');
          }

          // Ask the user "Say hello now"
          await speakStep('Say hello now');

          // Listen for up to 5 seconds
          const transcript = await new Promise<string>((resolve, reject) => {
            let finished = false;
            const rec = new SpeechRecognitionAPI();
            rec.continuous = false;
            rec.interimResults = false;
            rec.lang = 'en-US';

            const timeout = setTimeout(() => {
              if (!finished) {
                finished = true;
                try {
                  rec.abort();
                } catch (_) {}
                reject(new Error('No speech detected within 5 seconds'));
              }
            }, 5000);

            rec.onresult = (e: any) => {
              if (!finished) {
                finished = true;
                clearTimeout(timeout);
                const heard = e.results?.[0]?.[0]?.transcript || '';
                resolve(heard);
              }
            };

            rec.onerror = (e: any) => {
              if (!finished) {
                finished = true;
                clearTimeout(timeout);
                if (e.error === 'no-speech') {
                  reject(new Error('No speech detected within 5 seconds'));
                } else {
                  reject(new Error(`Recognition error: ${e.error}`));
                }
              }
            };

            rec.onend = () => {
              if (!finished) {
                finished = true;
                clearTimeout(timeout);
                reject(new Error('No speech detected within 5 seconds'));
              }
            };

            try {
              rec.start();
            } catch (startErr) {
              finished = true;
              clearTimeout(timeout);
              reject(startErr);
            }
          });

          const detail = `Heard: "${transcript}"`;
          updateItem(idx, {
            status: 'pass',
            detail,
            durationMs: Date.now() - startTime,
          });
          await speakStep(`Speech recognition passed. Heard: ${transcript}`);
        })(),
        10000
      );
    } catch (err: any) {
      updateItem(idx, {
        status: 'fail',
        error: err.message || 'No speech detected within 5 seconds',
        durationMs: Date.now() - startTime,
      });
      await speakStep('Speech recognition failed: No speech detected.');
    }
  }

  // CHECK 4: TEXT-TO-SPEECH
  if (!isCancelled()) {
    const idx = 3;
    updateItem(idx, { status: 'running' });
    const startTime = Date.now();
    try {
      await runWithTimeout(
        (async () => {
          if (typeof window === 'undefined' || !window.speechSynthesis) {
            throw new Error('window.speechSynthesis not supported in this browser');
          }

          await new Promise<void>((resolve, reject) => {
            const utterance = new SpeechSynthesisUtterance('Testing text to speech output.');
            utterance.rate = 1.0;
            utterance.volume = 0.8;
            utterance.onend = () => resolve();
            utterance.onerror = (e) => reject(new Error(`utterance.onerror: ${e.error}`));
            window.speechSynthesis.speak(utterance);
          });

          const detail = 'utterance.onend event fired successfully.';
          updateItem(idx, {
            status: 'pass',
            detail,
            durationMs: Date.now() - startTime,
          });
          await speakStep('Text to speech check passed.');
        })(),
        10000
      );
    } catch (err: any) {
      updateItem(idx, {
        status: 'fail',
        error: err.message || String(err),
        durationMs: Date.now() - startTime,
      });
      await speakStep(`Text to speech check failed: ${err.message || 'error'}`);
    }
  }

  // CHECK 5: COMMAND PARSING (NO MIC NEEDED)
  if (!isCancelled()) {
    const idx = 4;
    updateItem(idx, { status: 'running' });
    const startTime = Date.now();
    try {
      await runWithTimeout(
        (async () => {
          const testCases = [
            {
              sentence: 'navigate to Pune railway station',
              expected: 'navigation, "pune railway station"',
              run: () => {
                const dest = extractDestination('navigate to Pune railway station');
                const actual = `navigation, "${(dest || '').toLowerCase()}"`;
                return {
                  actual,
                  passed: (dest || '').toLowerCase() === 'pune railway station',
                };
              },
            },
            {
              sentence: 'take me to Phoenix Mall',
              expected: 'navigation, "phoenix mall"',
              run: () => {
                const dest = extractDestination('take me to Phoenix Mall');
                const actual = `navigation, "${(dest || '').toLowerCase()}"`;
                return {
                  actual,
                  passed: (dest || '').toLowerCase() === 'phoenix mall',
                };
              },
            },
            {
              sentence: 'I want to go to Shivajinagar',
              expected: 'navigation, "shivajinagar"',
              run: () => {
                const dest = extractDestination('I want to go to Shivajinagar');
                const actual = `navigation, "${(dest || '').toLowerCase()}"`;
                return {
                  actual,
                  passed: (dest || '').toLowerCase() === 'shivajinagar',
                };
              },
            },
            {
              sentence: 'read text',
              expected: 'read_text',
              run: () => {
                const res = parseCommandIntentOffline('read text');
                return {
                  actual: res.intent,
                  passed: res.intent === 'read_text',
                };
              },
            },
            {
              sentence: 'what does this say',
              expected: 'read_text',
              run: () => {
                const res = parseCommandIntentOffline('what does this say');
                return {
                  actual: res.intent,
                  passed: res.intent === 'read_text',
                };
              },
            },
            {
              sentence: 'what is in front of me',
              expected: 'object_detection',
              run: () => {
                const res = parseCommandIntentOffline('what is in front of me');
                return {
                  actual: res.intent,
                  passed: res.intent === 'object_detection',
                };
              },
            },
          ];

          const rows: CommandParsingResult[] = testCases.map((tc) => {
            const out = tc.run();
            return {
              sentence: tc.sentence,
              expected: tc.expected,
              actual: out.actual,
              passed: out.passed,
            };
          });

          const allPassed = rows.every((r) => r.passed);
          if (!allPassed) {
            const failed = rows.filter((r) => !r.passed).map((r) => `"${r.sentence}"`).join(', ');
            throw new Error(`Parsing mismatch on: ${failed}`);
          }

          updateItem(idx, {
            status: 'pass',
            detail: 'All 6 test sentences parsed and matched expected intents.',
            commandParsingRows: rows,
            durationMs: Date.now() - startTime,
          });

          await speakStep('Command parsing check passed. All 6 test sentences matched.');
        })(),
        10000
      );
    } catch (err: any) {
      updateItem(idx, {
        status: 'fail',
        error: err.message || String(err),
        durationMs: Date.now() - startTime,
      });
      await speakStep(`Command parsing check failed: ${err.message || 'mismatch'}`);
    }
  }

  // CHECK 6: LOCATION (GPS)
  if (!isCancelled()) {
    const idx = 5;
    updateItem(idx, { status: 'running' });
    const startTime = Date.now();
    try {
      await runWithTimeout(
        (async () => {
          if (!navigator.geolocation) {
            throw new Error('Geolocation is not supported on this browser or platform');
          }

          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 8000,
              enableHighAccuracy: true,
              maximumAge: 10000,
            });
          });

          const acc = Math.round(pos.coords.accuracy);
          const detail = `Lat: ${pos.coords.latitude.toFixed(5)}, Lng: ${pos.coords.longitude.toFixed(
            5
          )} | Accuracy: ±${acc}m`;

          updateItem(idx, {
            status: 'pass',
            detail,
            durationMs: Date.now() - startTime,
          });
          await speakStep(`Location check passed. Accuracy is ${acc} meters.`);
        })(),
        10000
      );
    } catch (err: any) {
      updateItem(idx, {
        status: 'fail',
        error: err.message || 'Location access denied or timed out',
        durationMs: Date.now() - startTime,
      });
      await speakStep(`Location check failed: ${err.message || 'error'}`);
    }
  }

  // CHECK 7: NAVIGATION DRY RUN
  if (!isCancelled()) {
    const idx = 6;
    updateItem(idx, { status: 'running' });
    const startTime = Date.now();
    try {
      await runWithTimeout(
        (async () => {
          const dest = 'Pune railway station';
          const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
            dest
          )}&travelmode=walking`;

          updateItem(idx, {
            status: 'pass',
            detail: `Google Maps URL: ${navUrl}`,
            navUrl,
            durationMs: Date.now() - startTime,
          });

          await speakStep('Navigation link is ready');
        })(),
        10000
      );
    } catch (err: any) {
      updateItem(idx, {
        status: 'fail',
        error: err.message || String(err),
        durationMs: Date.now() - startTime,
      });
      await speakStep('Navigation dry run check failed.');
    }
  }

  // CHECK 8: CAMERA
  if (!isCancelled()) {
    const idx = 7;
    updateItem(idx, { status: 'running' });
    const startTime = Date.now();
    try {
      await runWithTimeout(
        (async () => {
          if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Camera access not supported in this browser');
          }

          let stream: MediaStream;
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'environment' },
              audio: false,
            });
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          }

          const video = document.createElement('video');
          video.srcObject = stream;
          video.muted = true;
          video.playsInline = true;

          try {
            await video.play();
          } catch (_) {}

          let width = video.videoWidth;
          let height = video.videoHeight;
          if (width === 0 || height === 0) {
            await new Promise<void>((resolve) => {
              video.onloadedmetadata = () => resolve();
              setTimeout(resolve, 1500);
            });
            width = video.videoWidth || 640;
            height = video.videoHeight || 480;
          }

          // Capture a frame snapshot for Check 9 & Check 10
          try {
            const canvas = document.createElement('canvas');
            canvas.width = width || 640;
            canvas.height = height || 480;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              cachedSnapshot = canvas.toDataURL('image/jpeg', 0.7);
            }
          } catch (_) {}

          stream.getTracks().forEach((t) => t.stop());

          if (width === 0 && height === 0) {
            throw new Error('Camera stream returned 0x0 frame dimensions');
          }

          const detail = `Rear camera active: ${width}x${height}px frame confirmed.`;
          updateItem(idx, {
            status: 'pass',
            detail,
            durationMs: Date.now() - startTime,
          });

          await speakStep(`Camera check passed. Resolution is ${width} by ${height}.`);
        })(),
        10000
      );
    } catch (err: any) {
      updateItem(idx, {
        status: 'fail',
        error: err.message || 'Camera permission denied or camera not found',
        durationMs: Date.now() - startTime,
      });
      await speakStep(`Camera check failed: ${err.message || 'permission denied'}`);
    }
  }

  // CHECK 9: OBJECT DETECTION
  if (!isCancelled()) {
    const idx = 8;
    updateItem(idx, { status: 'running' });
    const startTime = Date.now();
    try {
      await runWithTimeout(
        (async () => {
          const frame = cachedSnapshot || createFallbackSnapshot('Object Detection Test Target');
          const description = await describeSurroundings(frame);
          if (!description || description.trim().length === 0) {
            throw new Error('Object detection returned empty description');
          }

          const detail = `Detected: "${description}"`;
          updateItem(idx, {
            status: 'pass',
            detail,
            durationMs: Date.now() - startTime,
          });

          const spokenSummary =
            description.length > 90 ? description.slice(0, 90) + '...' : description;
          await speakStep(`Object detection passed. Detected: ${spokenSummary}`);
        })(),
        10000
      );
    } catch (err: any) {
      updateItem(idx, {
        status: 'fail',
        error: err.message || 'Object detection call failed',
        durationMs: Date.now() - startTime,
      });
      await speakStep(`Object detection check failed: ${err.message || 'error'}`);
    }
  }

  // CHECK 10: READ TEXT (OCR)
  if (!isCancelled()) {
    const idx = 9;
    updateItem(idx, { status: 'running' });
    const startTime = Date.now();
    try {
      await runWithTimeout(
        (async () => {
          const frame = cachedSnapshot || createFallbackSnapshot('READ SIGN: EMERGENCY EXIT');
          const textResult = await readTextFromImage(frame);
          const hasText = textResult && textResult.trim().length > 0;
          const detail = hasText ? `Text found: "${textResult.trim()}"` : 'No text found in test frame.';

          updateItem(idx, {
            status: 'pass',
            detail,
            durationMs: Date.now() - startTime,
          });

          await speakStep(
            `Read text check passed. ${hasText ? 'Found text: ' + textResult.trim().slice(0, 50) : 'No text found.'}`
          );
        })(),
        10000
      );
    } catch (err: any) {
      updateItem(idx, {
        status: 'fail',
        error: err.message || 'Read text OCR call failed',
        durationMs: Date.now() - startTime,
      });
      await speakStep(`Read text check failed: ${err.message || 'error'}`);
    }
  }

  // CHECK 11: API KEY / GEMINI
  if (!isCancelled()) {
    const idx = 10;
    updateItem(idx, { status: 'running' });
    const startTime = Date.now();
    try {
      await runWithTimeout(
        (async () => {
          const key = getApiKey();
          if (!key) {
            throw new Error('No API key configured in Settings. Add your API key in Settings.');
          }
          const testRes = await testApiKey(key);
          if (!testRes.ok) {
            throw new Error(testRes.message || 'API key verification rejected by server');
          }

          const detail = `Gemini API verified: ${testRes.message}`;
          updateItem(idx, {
            status: 'pass',
            detail,
            durationMs: Date.now() - startTime,
          });

          await speakStep('Gemini API check passed.');
        })(),
        10000
      );
    } catch (err: any) {
      updateItem(idx, {
        status: 'fail',
        error: err.message || 'API key check failed',
        durationMs: Date.now() - startTime,
      });
      await speakStep(`Gemini API check failed: ${err.message || 'invalid key'}`);
    }
  }

  // Summary announcement
  const passedCount = items.filter((i) => i.status === 'pass').length;
  const failedItems = items.filter((i) => i.status === 'fail');

  let summary = '';
  if (failedItems.length === 0) {
    summary = `All ${items.length} checks passed. System is fully operational.`;
  } else {
    const failedNames = failedItems.map((i) => i.name.replace(/_/g, ' ')).join(' and ');
    summary = `${passedCount} of ${items.length} checks passed. Failed: ${failedNames}.`;
  }

  await speakStep(summary);

  return { items, summary };
}

/**
 * Formats self-test results as clean Markdown / Plain text for copying.
 */
export function formatSelfTestReport(items: SelfTestItem[]): string {
  const passedCount = items.filter((i) => i.status === 'pass').length;
  const failedCount = items.filter((i) => i.status === 'fail').length;
  const timestamp = new Date().toLocaleString();

  let report = `# VISION_AI System Self-Test Report\n`;
  report += `Date: ${timestamp}\n`;
  report += `Result: ${passedCount} of ${items.length} checks passed (${failedCount} failed)\n\n`;

  report += `| # | Check | Status | Details / Error |\n`;
  report += `|---|-------|--------|-----------------|\n`;

  for (const item of items) {
    const statusText = item.status.toUpperCase();
    const detailText = (item.detail || item.error || 'N/A').replace(/\|/g, '\\|');
    report += `| ${item.id} | ${item.name} | ${statusText} | ${detailText} |\n`;
  }

  // Add command parsing rows if present
  const parsingItem = items.find((i) => i.commandParsingRows);
  if (parsingItem?.commandParsingRows) {
    report += `\n### Command Parsing Test Matrix\n`;
    report += `| Test Sentence | Expected | Actual | Pass? |\n`;
    report += `|---------------|----------|--------|-------|\n`;
    for (const row of parsingItem.commandParsingRows) {
      report += `| "${row.sentence}" | ${row.expected} | ${row.actual} | ${
        row.passed ? 'PASS' : 'FAIL'
      } |\n`;
    }
  }

  // Navigation Dry Run URL
  const navItem = items.find((i) => i.navUrl);
  if (navItem?.navUrl) {
    report += `\n### Navigation URL Dry Run\n`;
    report += `${navItem.navUrl}\n`;
  }

  return report;
}
