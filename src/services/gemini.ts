/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppStore } from '../store/appStore';
import {
  getApiKey,
  notifyApiKeyMissing,
  GEMINI_DEFAULT_MODEL,
  GEMINI_FALLBACK_MODEL,
} from './apiKey';

export interface GeminiVoiceResponse {
  transcript: string;
  language: string;
  intent:
    | 'start_detection'
    | 'stop_detection'
    | 'describe_surroundings'
    | 'read_text'
    | 'navigate'
    | 'stop_navigation'
    | 'where_am_i'
    | 'emergency'
    | 'volume_up'
    | 'volume_down'
    | 'speech_slower'
    | 'speech_faster'
    | 'repeat'
    | 'stop_listening'
    | 'help'
    | 'general_question'
    | 'unknown';
  parameters?: {
    destination?: string;
    query?: string;
  };
  spoken_reply: string;
}

export interface AppContextPayload {
  detectionOn: boolean;
  navigationActive: boolean;
  destination: string;
  currentLocation: {
    lat: number | null;
    lng: number | null;
    address: string;
  };
  lastDetectedObjects: Array<{
    class: string;
    direction: string;
    distance: string;
  }>;
  deviceTime: string;
  recentTurns: Array<{ role: 'user' | 'assistant'; text: string }>;
}

const SYSTEM_INSTRUCTION = `You are the voice controller of VISION_AI, an app for blind users. Understand natural speech in English, Hindi, Marathi or a mix, including paraphrases, accents and small speech errors. First transcribe the audio exactly, then infer the intent. Return ONLY valid JSON.
Rules:
- 'start detection', 'detect objects', 'turn on the camera' -> start_detection
- 'stop detection', 'stop detecting', 'turn off the camera' -> stop_detection
- 'what is in front of me', 'describe what you see', 'is anything ahead' -> describe_surroundings (one-time description)
- 'read this', 'what does it say' -> read_text
- 'navigate me to X', 'take me to X', 'guide me to X', 'directions to X' -> navigate with destination = X
- 'navigate me' with no destination -> navigate with an empty destination and spoken_reply 'Where would you like to go?'
- 'stop navigation', 'cancel route' -> stop_navigation
- 'where am I' -> where_am_i
- 'help me', 'emergency', 'I need help' -> emergency
- Volume or speech speed requests -> the matching intent: 'volume_up' | 'volume_down' | 'speech_slower' | 'speech_faster'
- Questions about facts, time, people, places, definitions or advice -> general_question, with a clear answer of at most 3 sentences in spoken_reply. Use the deviceTime in the app state for time questions.
- Health or safety questions: give brief, careful general information and suggest contacting a doctor or emergency services when appropriate. Never give a diagnosis.
- If the audio is only background noise, a TV, or speech clearly not directed at the assistant, return intent 'unknown' with an empty spoken_reply.
- If the request is unclear but plausible, make your best guess instead of refusing. Never apologize for not understanding.
Keep spoken_reply to one or two short, plain sentences in the same language the user spoke.`;

// -------------------------------------------------------------
// Rate Limiting Queue & Cache (At most 1 call every 4 seconds)
// -------------------------------------------------------------
let lastCallTimestamp = 0;
const callQueue: Array<() => Promise<any>> = [];
let isQueueProcessing = false;

const requestCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 60000; // 60 seconds cache for identical requests

async function processQueue() {
  if (isQueueProcessing || callQueue.length === 0) return;
  isQueueProcessing = true;

  while (callQueue.length > 0) {
    const task = callQueue.shift()!;
    const now = Date.now();
    const timeSinceLast = now - lastCallTimestamp;
    if (timeSinceLast < 4000) {
      await new Promise((res) => setTimeout(res, 4000 - timeSinceLast));
    }
    lastCallTimestamp = Date.now();

    try {
      await task();
    } catch (_) {
      // Handled inside task
    }
  }

  isQueueProcessing = false;
}

function scheduleRateLimitedCall<T>(callFn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    callQueue.push(async () => {
      try {
        const result = await callFn();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
    processQueue();
  });
}

/**
 * Categorizes an error according to user specification and records debug line.
 * Never prints or leaks API keys.
 */
export function formatSpecificError(err: any): { spoken: string; debug: string } {
  const msg = String(err?.message || err);

  // Check offline first
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const res = { spoken: 'You are offline.', debug: 'Offline: navigator.onLine === false' };
    useAppStore.getState().setLastErrorDebug(res.debug);
    return res;
  }

  // Missing API key
  if (msg.includes('missing') || msg.includes('No Gemini API key') || !getApiKey()) {
    const res = {
      spoken: 'Gemini API key is missing. Please add it in Settings.',
      debug: 'Gemini API key is missing. Please add it in Settings.',
    };
    useAppStore.getState().setLastErrorDebug(res.debug);
    useAppStore.getState().setKeyMissingAlert(true);
    return res;
  }

  // 429 Rate limiting
  if (msg.includes('429') || err?.status === 429) {
    const res = {
      spoken: 'Too many requests, please wait a few seconds.',
      debug: 'HTTP 429 Too Many Requests (Rate limit reached)',
    };
    useAppStore.getState().setLastErrorDebug(res.debug);
    return res;
  }

  // 401/403 Authentication problem
  if (msg.includes('401') || msg.includes('403') || err?.status === 401 || err?.status === 403) {
    const res = { spoken: 'API key problem.', debug: 'HTTP 401/403 API key authentication failure' };
    useAppStore.getState().setLastErrorDebug(res.debug);
    return res;
  }

  // 404 Model not found
  if (
    msg.includes('404') ||
    msg.toLowerCase().includes('not found') ||
    msg.includes('Requested entity was not found') ||
    err?.status === 404
  ) {
    const res = {
      spoken: 'The requested AI model is currently not available. Please check your settings.',
      debug: `HTTP 404: Model not found. Attempted ${GEMINI_DEFAULT_MODEL} with fallback ${GEMINI_FALLBACK_MODEL}.`,
    };
    useAppStore.getState().setLastErrorDebug(res.debug);
    return res;
  }

  const res = {
    spoken: 'Speech service is not reachable. Please use Chrome and allow the microphone.',
    debug: msg.slice(0, 100),
  };
  useAppStore.getState().setLastErrorDebug(res.debug);
  return res;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/**
 * Executes a direct Gemini REST request with automatic 404 fallback to gemini-3.5-flash-lite.
 */
async function callGeminiDirectWithFallback(apiKey: string, body: any, timeoutMs = 8000): Promise<any> {
  const primaryUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DEFAULT_MODEL}:generateContent?key=${apiKey}`;
  const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FALLBACK_MODEL}:generateContent?key=${apiKey}`;

  let res = await fetchWithTimeout(
    primaryUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs
  );

  if (res.status === 404) {
    console.warn(
      `[Gemini Direct] Model ${GEMINI_DEFAULT_MODEL} returned 404. Retrying with fallback model ${GEMINI_FALLBACK_MODEL}...`
    );
    try {
      const fallbackRes = await fetchWithTimeout(
        fallbackUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        timeoutMs
      );
      if (fallbackRes.ok) {
        const json = await fallbackRes.json();
        json._usedFallback = true;
        return json;
      }
      res = fallbackRes;
    } catch (_) {
      // Continue to error check below
    }
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        `404: Requested model ${GEMINI_DEFAULT_MODEL} was not found, and fallback ${GEMINI_FALLBACK_MODEL} was also unavailable.`
      );
    }
    throw new Error(`Gemini direct API error: ${res.status}`);
  }

  return await res.json();
}

/**
 * Direct REST fallback to Google GenAI API when server proxy is unavailable.
 */
async function callDirectGemini(
  audioBase64: string,
  mimeType: string,
  context: AppContextPayload
): Promise<GeminiVoiceResponse> {
  const apiKey = getApiKey();
  if (!apiKey) {
    notifyApiKeyMissing();
    throw new Error('401: Gemini API key is missing. Please add it in Settings.');
  }

  const promptText = `Analyze this audio clip from the blind user. Current app context: ${JSON.stringify(context)}.
Respond ONLY with a JSON object adhering to this schema:
{
  "transcript": string,
  "language": string,
  "intent": "start_detection" | "stop_detection" | "describe_surroundings" | "read_text" | "navigate" | "stop_navigation" | "where_am_i" | "emergency" | "volume_up" | "volume_down" | "speech_slower" | "speech_faster" | "repeat" | "stop_listening" | "help" | "general_question" | "unknown",
  "parameters": { "destination": string, "query": string },
  "spoken_reply": string
}`;

  const body = {
    system_instruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: mimeType, data: audioBase64 } },
          { text: promptText },
        ],
      },
    ],
    generation_config: {
      response_mime_type: 'application/json',
      temperature: 0.2,
    },
  };

  const json = await callGeminiDirectWithFallback(apiKey, body, 8000);
  const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  return JSON.parse(rawText);
}

/**
 * Sends an audio clip to Gemini with 4-second rate limiting and caching.
 */
export async function analyzeUtterance(
  audioBase64: string,
  mimeType: string,
  durationMs: number,
  context: AppContextPayload
): Promise<{ result: GeminiVoiceResponse; latencyMs: number }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    notifyApiKeyMissing();
    throw new Error('401: Gemini API key is missing. Please add it in Settings.');
  }

  // Check cache for identical audio
  const cacheKey = `audio_${audioBase64.slice(0, 100)}_${audioBase64.length}`;
  const cached = requestCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { result: cached.data, latencyMs: 10 };
  }

  const startTime = Date.now();

  const executeCall = async () => {
    const doAttempt = async (): Promise<GeminiVoiceResponse> => {
      // 1. Try server endpoint
      try {
        const serverRes = await fetchWithTimeout(
          '/api/gemini/analyze-utterance',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-gemini-key': apiKey,
            },
            body: JSON.stringify({ audioBase64, mimeType, context }),
          },
          8000
        );

        if (serverRes.ok) {
          return await serverRes.json();
        }
        if (serverRes.status === 429) {
          throw new Error('429: Too many requests');
        }
        if (serverRes.status === 401 || serverRes.status === 403) {
          throw new Error(`${serverRes.status}: API key problem`);
        }
      } catch (e: any) {
        if (e.message?.includes('429') || e.message?.includes('401') || e.message?.includes('403')) {
          throw e;
        }
      }

      // 2. Direct REST fallback
      return await callDirectGemini(audioBase64, mimeType, context);
    };

    let responseData: GeminiVoiceResponse | null = null;
    try {
      responseData = await doAttempt();
    } catch (firstErr) {
      responseData = await doAttempt();
    }

    // Cache successful response
    requestCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
    return responseData;
  };

  const responseData = await scheduleRateLimitedCall(executeCall);
  const latencyMs = Date.now() - startTime;

  return { result: responseData, latencyMs };
}

/**
 * Submits a text question to Gemini (for when local command router doesn't match).
 * Rate-limited to 1 request per 4 seconds with 60-second caching.
 */
export async function askGeneralQuestion(
  questionText: string,
  context: AppContextPayload
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    notifyApiKeyMissing();
    throw new Error('401: Gemini API key is missing. Please add it in Settings.');
  }

  const cacheKey = `query_${questionText.trim().toLowerCase()}`;
  const cached = requestCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const executeCall = async () => {
    // Try server endpoint first
    try {
      const serverRes = await fetchWithTimeout(
        '/api/gemini/general-question',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-gemini-key': apiKey,
          },
          body: JSON.stringify({ question: questionText, context }),
        },
        8000
      );

      if (serverRes.ok) {
        const json = await serverRes.json();
        const reply = json.reply || 'I am ready to help.';
        requestCache.set(cacheKey, { data: reply, timestamp: Date.now() });
        return reply;
      }
      if (serverRes.status === 429) throw new Error('429: Too many requests');
      if (serverRes.status === 401 || serverRes.status === 403) throw new Error(`${serverRes.status}: API key problem`);
      if (serverRes.status === 404) throw new Error('404: Model not found');
    } catch (err: any) {
      if (err.message?.includes('429') || err.message?.includes('401') || err.message?.includes('403')) {
        throw err;
      }
    }

    // Direct fallback
    const promptBody = {
      system_instruction: {
        parts: [
          {
            text:
              'You are VISION_AI, an assistive voice assistant for blind users. Answer in at most 2 plain, short sentences in the language the user spoke. Current device time: ' +
              context.deviceTime,
          },
        ],
      },
      contents: [{ role: 'user', parts: [{ text: questionText }] }],
    };

    const json = await callGeminiDirectWithFallback(apiKey, promptBody, 8000);
    const reply = json.candidates?.[0]?.content?.parts?.[0]?.text || 'I am here to assist you.';
    requestCache.set(cacheKey, { data: reply, timestamp: Date.now() });
    return reply;
  };

  return await scheduleRateLimitedCall(executeCall);
}

/**
 * Captures surroundings description with Gemini Vision.
 * Rate limited to one request every 4 seconds.
 */
let lastDescribeTime = 0;
export async function describeSurroundings(imageBase64: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    notifyApiKeyMissing();
    throw new Error('401: Gemini API key is missing. Please add it in Settings.');
  }

  const now = Date.now();
  if (now - lastDescribeTime < 4000) {
    return 'Please wait a moment before requesting another description.';
  }
  lastDescribeTime = now;

  const prompt =
    'You are helping a blind person walk safely. In 2 short sentences, describe the obstacles and hazards in front of them with direction (left, ahead, right) and approximate distance. Mention stairs, poles, walls, doors, vehicles, people and ground hazards.';

  const executeCall = async () => {
    try {
      const res = await fetchWithTimeout(
        '/api/gemini/describe-scene',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-gemini-key': apiKey,
          },
          body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg' }),
        },
        8000
      );

      if (res.ok) {
        const json = await res.json();
        return json.description || 'Path appears clear.';
      }
      if (res.status === 429) throw new Error('429: Too many requests');
      if (res.status === 401 || res.status === 403) throw new Error(`${res.status}: API key problem`);
    } catch (e: any) {
      if (e.message?.includes('429') || e.message?.includes('401')) throw e;
    }

    // Direct fallback
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
            { text: prompt },
          ],
        },
      ],
    };

    const json = await callGeminiDirectWithFallback(apiKey, body, 8000);
    return json.candidates?.[0]?.content?.parts?.[0]?.text || 'Path appears clear.';
  };

  return await scheduleRateLimitedCall(executeCall);
}

/**
 * Reads all visible text in an image (OCR).
 */
export async function readTextFromImage(imageBase64: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    notifyApiKeyMissing();
    throw new Error('401: Gemini API key is missing. Please add it in Settings.');
  }

  const prompt =
    'Read all visible text in this image clearly and concisely for a blind person. If no text is readable, say "No readable text found". Do not describe anything other than the text itself.';

  const executeCall = async () => {
    try {
      const res = await fetchWithTimeout(
        '/api/gemini/read-text',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-gemini-key': apiKey,
          },
          body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg' }),
        },
        8000
      );

      if (res.ok) {
        const json = await res.json();
        return json.text || 'No readable text found.';
      }
      if (res.status === 429) throw new Error('429: Too many requests');
      if (res.status === 401 || res.status === 403) throw new Error(`${res.status}: API key problem`);
    } catch (e: any) {
      if (e.message?.includes('429') || e.message?.includes('401')) throw e;
    }

    // Direct fallback
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
            { text: prompt },
          ],
        },
      ],
    };

    const json = await callGeminiDirectWithFallback(apiKey, body, 8000);
    return json.candidates?.[0]?.content?.parts?.[0]?.text || 'No readable text found.';
  };

  return await scheduleRateLimitedCall(executeCall);
}

export interface FrameAnalysisResult {
  text: string;
  model: string;
  isFallback: boolean;
  latencyMs: number;
}

/**
 * Analyzes a camera test video frame with Gemini for custom tasks.
 */
export async function analyzeFrameWithGemini(
  imageBase64: string,
  prompt: string = 'Identify the object and describe it'
): Promise<FrameAnalysisResult> {
  const startTime = Date.now();
  const apiKey = getApiKey();
  if (!apiKey) {
    notifyApiKeyMissing();
    throw new Error('401: Gemini API key is missing. Please add it in Settings.');
  }

  const executeCall = async (): Promise<FrameAnalysisResult> => {
    // 1. Try server endpoint first
    try {
      const res = await fetchWithTimeout(
        '/api/gemini/analyze-frame',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-gemini-key': apiKey,
          },
          body: JSON.stringify({ imageBase64, mimeType: 'image/jpeg', prompt }),
        },
        12000
      );

      if (res.ok) {
        const json = await res.json();
        return {
          text: json.result || 'No description returned.',
          model: json.model || GEMINI_DEFAULT_MODEL,
          isFallback: json.isFallback || false,
          latencyMs: Date.now() - startTime,
        };
      }
      if (res.status === 429) throw new Error('429: Too many requests');
      if (res.status === 401 || res.status === 403) throw new Error(`${res.status}: API key problem`);
      if (res.status === 404) throw new Error('404: Model not found');
    } catch (e: any) {
      if (e.message?.includes('429') || e.message?.includes('401') || e.message?.includes('403')) {
        throw e;
      }
    }

    // 2. Direct client fallback with automatic 404 fallback handling
    const body = {
      system_instruction: {
        parts: [
          {
            text:
              'You are an intelligent vision assistant for the VISION_AI application. Answer the user prompt directly, concisely, and factually based on the camera image. In 2 to 4 sentences, describe the key objects, actions, text, or scene elements.',
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
            { text: prompt },
          ],
        },
      ],
    };

    const json = await callGeminiDirectWithFallback(apiKey, body, 12000);
    const text =
      json.candidates?.[0]?.content?.parts?.[0]?.text || 'No description returned.';
    return {
      text,
      model: json._usedFallback ? GEMINI_FALLBACK_MODEL : GEMINI_DEFAULT_MODEL,
      isFallback: !!json._usedFallback,
      latencyMs: Date.now() - startTime,
    };
  };

  return await scheduleRateLimitedCall(executeCall);
}

