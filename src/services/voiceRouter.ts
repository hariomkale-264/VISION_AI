/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppStore, ActiveTab } from '../store/appStore';
import { useStatsStore } from '../store/statsStore';
import { speechQueue, SpeechPriority } from './speechQueue';
import { handleEmergencySos } from './intentRouter';
import { describeSurroundings, readTextFromImage } from './gemini';
import { getApiKey, notifyApiKeyMissing } from './apiKey';

// Snapshot getter and mic controllers registered by components
let snapshotProvider: (() => string | null) | null = null;
let stopMicTrigger: (() => void) | null = null;
let startMicTrigger: (() => void) | null = null;

export function registerVoiceRouterProviders(
  snapshotGetter: () => string | null,
  stopMic: () => void,
  startMic: () => void
) {
  snapshotProvider = snapshotGetter;
  stopMicTrigger = stopMic;
  startMicTrigger = startMic;
}

export interface TabRouteDefinition {
  tab: ActiveTab;
  label: string;
  confirmations: {
    en: string;
    hi: string;
    mr: string;
  };
  keywords: {
    en: string[];
    hi: string[];
    mr: string[];
  };
}

/**
 * Extensible Tab Routing Table for English, Hindi, and Marathi.
 * Each tab defines forgiving keywords and localized spoken confirmations.
 */
export const TAB_ROUTES: TabRouteDefinition[] = [
  {
    tab: 'dashboard',
    label: 'Dashboard',
    confirmations: {
      en: 'Opening Dashboard',
      hi: 'डैशबोर्ड खोल रहा हूँ',
      mr: 'डॅशबोर्ड उघडत आहे',
    },
    keywords: {
      en: ['dashboard', 'home', 'main screen', 'main page'],
      hi: ['डैशबोर्ड', 'होम', 'मुख्य पृष्ठ', 'मुख्य स्क्रीन'],
      mr: ['डॅशबोर्ड', 'होम', 'मुख्य पृष्ठ', 'मुख्य स्क्रीन'],
    },
  },
  {
    tab: 'detection',
    label: 'Detection',
    confirmations: {
      en: 'Opening Detection',
      hi: 'डिटेक्शन खोल रहा हूँ',
      mr: 'डिटेक्शन उघडत आहे',
    },
    keywords: {
      en: ['detection', 'camera', 'vision', 'obstacle', 'live camera'],
      hi: ['डिटेक्शन', 'कैमरा', 'कॅमेरा', 'दृष्टी'],
      mr: ['डिटेक्शन', 'कॅमेरा', 'दृष्टी'],
    },
  },
  {
    tab: 'navigation',
    label: 'Navigation',
    confirmations: {
      en: 'Opening Navigation',
      hi: 'नेविगेशन खोल रहा हूँ',
      mr: 'नेव्हिगेशन उघडत आहे',
    },
    keywords: {
      en: ['navigation', 'navigate', 'map', 'route', 'directions'],
      hi: ['नेविगेशन', 'रास्ता'],
      mr: ['नकाशा', 'मार्ग'],
    },
  },
  {
    tab: 'voice',
    label: 'Voice',
    confirmations: {
      en: 'Opening Voice Assistant',
      hi: 'वॉइस असिस्टेंट खोल रहा हूँ',
      mr: 'व्हॉइस असिस्टंट उघडत आहे',
    },
    keywords: {
      en: ['voice', 'voice assistant', 'assistant'],
      hi: ['वॉइस', 'आवाज', 'असिस्टंट'],
      mr: ['वॉइस', 'आवाज', 'असिस्टंट'],
    },
  },
  {
    tab: 'emergency',
    label: 'Emergency',
    confirmations: {
      en: 'Opening Emergency SOS',
      hi: 'आपातकालीन सहायता खोल रहा हूँ',
      mr: 'आपत्कालीन मदत उघडत आहे',
    },
    keywords: {
      en: ['emergency', 'sos', 'help me'],
      hi: ['इमरजेंसी', 'आपातकाल', 'मदद'],
      mr: ['आणीबाणी', 'मदत'],
    },
  },
  {
    tab: 'settings',
    label: 'Settings',
    confirmations: {
      en: 'Opening Settings',
      hi: 'सेटिंग खोल रहा हूँ',
      mr: 'सेटिंग्ज उघडत आहे',
    },
    keywords: {
      en: ['settings', 'setting', 'preferences', 'api key', 'language', 'volume'],
      hi: ['सेटिंग', 'भाषा', 'आवाज़ सेटिंग'],
      mr: ['सेटिंग्ज', 'भाषा', 'आवाज सेटिंग'],
    },
  },
];

export interface VoiceRouteResult {
  matched: boolean;
  commandName?: string;
  spokenReply?: string;
}

/**
 * Normalizes speech text for forgiving matching:
 * lowercase, trimmed, ignores punctuation and common accents.
 */
export function cleanSpokenText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if cleaned text matches a keyword, supporting leading phrases
 * like "go to", "open", "show", "take me to", "switch to", "खोलो", "चलो", "उघड", "जा".
 */
export function matchesForgivingPattern(cleanedText: string, keyword: string): boolean {
  const kw = cleanSpokenText(keyword);
  if (!kw) return false;

  // Exact match
  if (cleanedText === kw) return true;

  // Leading prefix stripped matching
  const prefixRegex =
    /^(please\s+|can you\s+|open\s+|show\s+|go to\s+|switch to\s+|take me to the\s+|take me to\s+|चलो\s+|खोलो\s+|उघड\s+|जा\s+|दाखवा\s+|बघा\s+)/i;
  const stripped = cleanedText.replace(prefixRegex, '').trim();

  if (stripped === kw) return true;

  // Word boundary or substring checks
  const regex = new RegExp(`(^|\\s)${kw}(\\s|$)`, 'i');
  return regex.test(cleanedText) || regex.test(stripped);
}

/**
 * Evaluates whether text matches any keyword in the list
 */
function matchesAnyKeyword(cleanedText: string, keywords: string[]): boolean {
  return keywords.some((kw) => matchesForgivingPattern(cleanedText, kw));
}

/**
 * Selects confirmation language based on current app language setting or script
 */
function getLocalizedConfirmation(
  confirmations: { en: string; hi: string; mr: string },
  matchedLang: 'en' | 'hi' | 'mr',
  userAppLang: string
): string {
  if (matchedLang === 'hi' || userAppLang.startsWith('hi')) return confirmations.hi;
  if (matchedLang === 'mr' || userAppLang.startsWith('mr')) return confirmations.mr;
  return confirmations.en;
}

/**
 * Master Local Voice Command Router
 * Runs BEFORE any Gemini call, completely offline and with zero API keys required.
 */
export async function routeVoiceCommand(rawText: string): Promise<VoiceRouteResult> {
  const cleaned = cleanSpokenText(rawText);
  if (!cleaned) return { matched: false };

  const app = useAppStore.getState();
  const stats = useStatsStore.getState();
  const currentLang = app.language || 'en-US';

  // -----------------------------------------------------------------
  // 1. TAB SWITCHING (Priority: match before general actions)
  // -----------------------------------------------------------------
  for (const route of TAB_ROUTES) {
    let matchedLang: 'en' | 'hi' | 'mr' | null = null;

    if (matchesAnyKeyword(cleaned, route.keywords.en)) {
      matchedLang = 'en';
    } else if (matchesAnyKeyword(cleaned, route.keywords.hi)) {
      matchedLang = 'hi';
    } else if (matchesAnyKeyword(cleaned, route.keywords.mr)) {
      matchedLang = 'mr';
    }

    if (matchedLang) {
      // Guard against false positives like "start detection" or "stop navigation"
      const isStartStopAction =
        cleaned.startsWith('start ') ||
        cleaned.startsWith('stop ') ||
        cleaned.includes('start detection') ||
        cleaned.includes('stop detection') ||
        cleaned.includes('start navigation') ||
        cleaned.includes('stop navigation') ||
        cleaned.includes('start listening') ||
        cleaned.includes('stop listening');

      if (!isStartStopAction || route.tab === 'emergency') {
        app.setActiveTab(route.tab);
        const confirmation = getLocalizedConfirmation(route.confirmations, matchedLang, currentLang);

        if (route.tab === 'emergency') {
          handleEmergencySos();
          speechQueue.speak(confirmation, SpeechPriority.URGENT_OBSTACLE);
        } else {
          speechQueue.speak(confirmation, SpeechPriority.STATUS);
        }

        app.setLastTranscript(rawText.trim());
        stats.recordVoiceCommandSuccess(rawText.trim() || `open ${route.tab}`, confirmation);
        return { matched: true, commandName: route.tab, spokenReply: confirmation };
      }
    }
  }

  // -----------------------------------------------------------------
  // 2. LOCAL ACTION COMMANDS
  // -----------------------------------------------------------------

  // Start Detection
  if (
    matchesAnyKeyword(cleaned, [
      'start detection',
      'start detecting',
      'detect objects',
      'turn on detection',
      'turn on camera',
      'start camera',
      'डिटेक्शन शुरू करो',
      'कैमरा चालू करो',
      'डिटेक्शन सुरू करा',
      'कॅमेरा चालू करा',
    ])
  ) {
    app.setDetectionActive(true);
    const reply = currentLang.startsWith('hi')
      ? 'ऑब्जेक्ट डिटेक्शन चालू कर रहे हैं'
      : currentLang.startsWith('mr')
      ? 'ऑब्जेक्ट डिटेक्शन सुरू करत आहे'
      : 'Starting object detection';
    speechQueue.speak(reply, SpeechPriority.STATUS);
    app.setLastTranscript(rawText.trim());
    stats.recordVoiceCommandSuccess(rawText.trim() || 'start detection', reply);
    return { matched: true, commandName: 'start_detection', spokenReply: reply };
  }

  // Stop Detection
  if (
    matchesAnyKeyword(cleaned, [
      'stop detection',
      'stop detecting',
      'turn off detection',
      'turn off camera',
      'stop camera',
      'close camera',
      'डिटेक्शन बंद करो',
      'कैमरा बंद करो',
      'डिटेक्शन थांबवा',
      'कॅमेरा बंद करा',
    ])
  ) {
    app.setDetectionActive(false);
    stats.updateLiveDetections([]);
    const reply = currentLang.startsWith('hi')
      ? 'डिटेक्शन बंद हो गया'
      : currentLang.startsWith('mr')
      ? 'डिटेक्शन थांबवले'
      : 'Detection stopped';
    speechQueue.speak(reply, SpeechPriority.STATUS);
    app.setLastTranscript(rawText.trim());
    stats.recordVoiceCommandSuccess(rawText.trim() || 'stop detection', reply);
    return { matched: true, commandName: 'stop_detection', spokenReply: reply };
  }

  // Start Listening
  if (
    matchesAnyKeyword(cleaned, [
      'start listening',
      'turn on mic',
      'mic on',
      'listen',
      'माइक चालू करो',
      'माइक सुरू करा',
    ])
  ) {
    if (startMicTrigger) startMicTrigger();
    app.setMicStatus('listening');
    const reply = currentLang.startsWith('hi')
      ? 'सुनना चालू है'
      : currentLang.startsWith('mr')
      ? 'ऐकणे सुरू आहे'
      : 'Listening active';
    speechQueue.speak(reply, SpeechPriority.STATUS);
    app.setLastTranscript(rawText.trim());
    stats.recordVoiceCommandSuccess(rawText.trim() || 'start listening', reply);
    return { matched: true, commandName: 'start_listening', spokenReply: reply };
  }

  // Stop Listening
  if (
    matchesAnyKeyword(cleaned, [
      'stop listening',
      'turn off mic',
      'mic off',
      'pause mic',
      'माइक बंद करो',
      'माइक थांबवा',
    ])
  ) {
    const reply = currentLang.startsWith('hi')
      ? 'माइक रोक दिया गया है'
      : currentLang.startsWith('mr')
      ? 'माइक थांबवला आहे'
      : 'Microphone paused.';
    speechQueue.speak(reply, SpeechPriority.STATUS, {
      onEnd: () => {
        if (stopMicTrigger) stopMicTrigger();
        app.setMicStatus('paused');
      },
    });
    app.setLastTranscript(rawText.trim());
    stats.recordVoiceCommandSuccess(rawText.trim() || 'stop listening', reply);
    return { matched: true, commandName: 'stop_listening', spokenReply: reply };
  }

  // Start Navigation
  if (
    matchesAnyKeyword(cleaned, [
      'start navigation',
      'start route',
      'नेविगेशन शुरू करो',
      'नॅव्हिगेशन सुरू करा',
    ])
  ) {
    app.setActiveTab('navigation');
    const reply = app.destination
      ? `Resuming navigation to ${app.destination}`
      : 'Please choose or speak a destination';
    speechQueue.speak(reply, SpeechPriority.STATUS);
    app.setLastTranscript(rawText.trim());
    stats.recordVoiceCommandSuccess(rawText.trim() || 'start navigation', reply);
    return { matched: true, commandName: 'start_navigation', spokenReply: reply };
  }

  // Stop Navigation
  if (
    matchesAnyKeyword(cleaned, [
      'stop navigation',
      'stop route',
      'cancel navigation',
      'cancel route',
      'end route',
      'नेविगेशन बंद करो',
      'नॅव्हिगेशन थांबवा',
      'मार्ग रद्द करा',
    ])
  ) {
    app.stopNavigation();
    const reply = currentLang.startsWith('hi')
      ? 'नेविगेशन बंद हो गया'
      : currentLang.startsWith('mr')
      ? 'नॅव्हिगेशन थांबवले'
      : 'Navigation stopped';
    speechQueue.speak(reply, SpeechPriority.STATUS);
    app.setLastTranscript(rawText.trim());
    stats.recordVoiceCommandSuccess(rawText.trim() || 'stop navigation', reply);
    return { matched: true, commandName: 'stop_navigation', spokenReply: reply };
  }

  // Emergency SOS
  if (
    matchesAnyKeyword(cleaned, [
      'emergency sos',
      'send sos',
      'help me please',
      'आपातकालीन एसओएस',
      'मदत करा एसओएस',
    ])
  ) {
    app.setActiveTab('emergency');
    handleEmergencySos();
    const reply = 'Emergency SOS triggered.';
    speechQueue.speak(reply, SpeechPriority.URGENT_OBSTACLE);
    app.setLastTranscript(rawText.trim());
    stats.recordVoiceCommandSuccess(rawText.trim() || 'emergency sos', reply);
    return { matched: true, commandName: 'emergency_sos', spokenReply: reply };
  }

  // Describe Scene
  if (
    matchesAnyKeyword(cleaned, [
      'describe scene',
      'describe surroundings',
      'what is in front of me',
      'what is ahead',
      'what do you see',
      'describe what you see',
      'सामने क्या है',
      'आगे क्या है',
      'समोर काय आहे',
      'पुढे काय आहे',
    ])
  ) {
    let imageBase64: string | null = null;
    if (snapshotProvider) {
      imageBase64 = snapshotProvider();
    }

    if (!imageBase64) {
      const reply = 'Please enable the camera to describe the scene.';
      speechQueue.speak(reply, SpeechPriority.ASSISTANT_REPLY);
      app.setLastTranscript(rawText.trim());
      return { matched: true, commandName: 'describe_scene', spokenReply: reply };
    }

    // Check API Key
    const key = getApiKey();
    if (!key) {
      notifyApiKeyMissing();
      app.setLastTranscript(rawText.trim());
      return { matched: true, commandName: 'describe_scene', spokenReply: 'Gemini API key is missing. Please add it in Settings.' };
    }

    speechQueue.speak('Analyzing surroundings...', SpeechPriority.STATUS);
    app.setLastTranscript(rawText.trim());
    try {
      const desc = await describeSurroundings(imageBase64);
      app.setLastSceneDescription(desc);
      speechQueue.speak(desc, SpeechPriority.ASSISTANT_REPLY);
      stats.recordVoiceCommandSuccess(rawText.trim() || 'describe scene', desc);
      return { matched: true, commandName: 'describe_scene', spokenReply: desc };
    } catch (err: any) {
      console.error('Scene description error:', err);
      let errMsg = 'Failed to analyze surroundings.';
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        errMsg = 'You are offline.';
      } else if (err?.message?.includes('401') || err?.message?.includes('403')) {
        errMsg = 'API key problem.';
      } else if (err?.message?.includes('429')) {
        errMsg = 'Too many requests, please wait a few seconds.';
      }
      speechQueue.speak(errMsg, SpeechPriority.ASSISTANT_REPLY);
      return { matched: true, commandName: 'describe_scene', spokenReply: errMsg };
    }
  }

  // Read Text (OCR)
  if (
    matchesAnyKeyword(cleaned, [
      'read text',
      'read this',
      'what does it say',
      'read sign',
      'पढ़ो',
      'यह क्या लिखा है',
      'वाचा',
      'काय लिहिले आहे',
    ])
  ) {
    let imageBase64: string | null = null;
    if (snapshotProvider) {
      imageBase64 = snapshotProvider();
    }

    if (!imageBase64) {
      const reply = 'Please point the camera at the text.';
      speechQueue.speak(reply, SpeechPriority.ASSISTANT_REPLY);
      app.setLastTranscript(rawText.trim());
      return { matched: true, commandName: 'read_text', spokenReply: reply };
    }

    // Check API Key
    const key = getApiKey();
    if (!key) {
      notifyApiKeyMissing();
      app.setLastTranscript(rawText.trim());
      return { matched: true, commandName: 'read_text', spokenReply: 'Gemini API key is missing. Please add it in Settings.' };
    }

    speechQueue.speak('Reading text...', SpeechPriority.STATUS);
    app.setLastTranscript(rawText.trim());
    try {
      const textRead = await readTextFromImage(imageBase64);
      app.setLastOcrText(textRead);
      speechQueue.speak(textRead, SpeechPriority.ASSISTANT_REPLY);
      stats.recordVoiceCommandSuccess(rawText.trim() || 'read text', textRead);
      return { matched: true, commandName: 'read_text', spokenReply: textRead };
    } catch (err: any) {
      console.error('Read text error:', err);
      let errMsg = 'Failed to read text.';
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        errMsg = 'You are offline.';
      } else if (err?.message?.includes('401') || err?.message?.includes('403')) {
        errMsg = 'API key problem.';
      } else if (err?.message?.includes('429')) {
        errMsg = 'Too many requests, please wait a few seconds.';
      }
      speechQueue.speak(errMsg, SpeechPriority.ASSISTANT_REPLY);
      return { matched: true, commandName: 'read_text', spokenReply: errMsg };
    }
  }

  // -----------------------------------------------------------------
  // 3. REAL-TIME LOCAL QUERIES (Instant Answers Offline)
  // -----------------------------------------------------------------

  // Time queries
  if (
    matchesAnyKeyword(cleaned, [
      'what time is it',
      'what is the time',
      'tell me the time',
      'current time',
      'time now',
      'time',
      'समय क्या है',
      'कितने बजे हैं',
      'समय बताओ',
      'टाइम क्या है',
      'किती वाजले',
      'वेळ काय आहे',
      'वेळ सांगा',
    ])
  ) {
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const reply = `The time is ${timeString}.`;
    speechQueue.speak(reply, SpeechPriority.ASSISTANT_REPLY);
    app.setLastTranscript(rawText.trim());
    stats.recordVoiceCommandSuccess(rawText.trim() || 'what time is it', reply);
    return { matched: true, commandName: 'time', spokenReply: reply };
  }

  // Date queries
  if (
    matchesAnyKeyword(cleaned, [
      'what is the date',
      'what date is today',
      'whats the date',
      'today date',
      'current date',
      'date today',
      'date',
      'आज की तारीख क्या है',
      'तारीख क्या है',
      'तारीख बताओ',
      'आजची तारीख काय आहे',
      'आज तारीख काय आहे',
      'तारीख सांगा',
    ])
  ) {
    const now = new Date();
    const dateString = now.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    const reply = `Today is ${dateString}.`;
    speechQueue.speak(reply, SpeechPriority.ASSISTANT_REPLY);
    app.setLastTranscript(rawText.trim());
    stats.recordVoiceCommandSuccess(rawText.trim() || 'what is the date', reply);
    return { matched: true, commandName: 'date', spokenReply: reply };
  }

  // Battery level
  if (
    matchesAnyKeyword(cleaned, [
      'battery level',
      'battery status',
      'what is the battery level',
      'how much battery',
      'check battery',
      'battery',
      'बैटरी कितनी है',
      'बैटरी लेवल क्या है',
      'बैटरी बताओ',
      'बॅटरी किती आहे',
      'बॅटरी लेव्हल काय आहे',
      'बॅटरी सांगा',
    ])
  ) {
    const level = app.batteryLevel;
    const isCharging = app.isCharging;
    let reply = 'Battery status is currently not available on this browser.';
    if (level !== null && level !== undefined) {
      reply = `Battery is at ${level} percent${isCharging ? ', charging' : ''}.`;
    }
    speechQueue.speak(reply, SpeechPriority.ASSISTANT_REPLY);
    app.setLastTranscript(rawText.trim());
    stats.recordVoiceCommandSuccess(rawText.trim() || 'battery level', reply);
    return { matched: true, commandName: 'battery', spokenReply: reply };
  }

  // Location queries
  if (
    matchesAnyKeyword(cleaned, [
      'where am i',
      'what is my location',
      'tell me my location',
      'where are we',
      'current location',
      'my address',
      'address',
      'मैं कहाँ हूँ',
      'मेरी लोकेशन क्या है',
      'मेरा पता क्या है',
      'मी कुठे आहे',
      'माझे स्थान काय आहे',
      'माझा पत्ता काय आहे',
    ])
  ) {
    const addr = app.currentLocation.address || 'Locating current GPS coordinates';
    const acc = app.currentLocation.accuracy
      ? ` with GPS accuracy within ${Math.round(app.currentLocation.accuracy)} meters`
      : '';
    const reply = `You are near ${addr}${acc}.`;
    speechQueue.speak(reply, SpeechPriority.ASSISTANT_REPLY);
    app.setLastTranscript(rawText.trim());
    stats.recordVoiceCommandSuccess(rawText.trim() || 'where am i', reply);
    return { matched: true, commandName: 'where_am_i', spokenReply: reply };
  }

  // Obstacles around me
  if (
    matchesAnyKeyword(cleaned, [
      'what is around me',
      'what is near me',
      'what objects are around me',
      'what do you see around me',
      'around me',
      'आसपास क्या है',
      'मेरे आसपास क्या है',
      'माझ्या आजूबाजूला काय आहे',
      'आजूबाजूला काय आहे',
    ])
  ) {
    const liveItems = stats.liveDetections;
    let reply = 'No obstacles detected in the camera view right now.';
    if (liveItems.length > 0) {
      const summaryList = liveItems
        .slice(0, 3)
        .map((item) => `${item.className} ${item.direction} (${item.distanceLabel})`);
      reply = `Around you: ${summaryList.join(', ')}.`;
    }
    speechQueue.speak(reply, SpeechPriority.ASSISTANT_REPLY);
    app.setLastTranscript(rawText.trim());
    stats.recordVoiceCommandSuccess(rawText.trim() || 'what is around me', reply);
    return { matched: true, commandName: 'what_is_around_me', spokenReply: reply };
  }

  // No local command matched
  return { matched: false };
}
