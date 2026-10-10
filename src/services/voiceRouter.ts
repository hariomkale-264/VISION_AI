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
import { openGoogleMaps, handleTravelModeAnswer } from './navigationService';

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
      en: ['open navigation', 'show navigation', 'navigation tab', 'navigation screen', 'open map', 'show map', 'map tab', 'view map', 'navigation', 'map'],
      hi: ['नेविगेशन खोलें', 'रास्ता दिखाओ', 'नेविगेशन'],
      mr: ['नकाशा उघडा', 'मार्ग दाखवा', 'नकाशा'],
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

export interface NavigationIntentParse {
  isNavIntent: boolean;
  destination: string;
  origin?: string;
  travelmode: 'walking' | 'driving' | 'transit' | 'bicycling';
  isEmpty: boolean;
}

/**
 * FIX 1: Strips tab/screen/page/section/window words and checks if speech matches a tab keyword.
 * Requirement:
 * - Before checking for navigation, remove the words "tab", "screen", "page", "section", "window",
 *   and the Hindi/Marathi equivalents (टैब, स्क्रीन, पेज, विभाग) from the sentence.
 * - Then check whether the remaining text matches a tab keyword
 *   (dashboard, detection, navigation, voice, emergency, settings and their Hindi/Marathi versions).
 * - If yes, switch the tab. Only treat the sentence as a destination if it does NOT match any tab.
 * - "go to the voice tab", "open settings page", "show the detection screen" must switch tabs and never open Google Maps.
 */
export function matchTabFromSpeech(rawText: string): { isTab: boolean; tab?: ActiveTab; confirmation?: string } {
  if (!rawText) return { isTab: false };

  // 1. Remove words: "tab", "screen", "page", "section", "window", and Hindi/Marathi equivalents (टैब, स्क्रीन, पेज, विभाग)
  const tabFilterRegex = /\b(tab|tabs|screen|screens|page|pages|section|sections|window|windows)\b|टैब|स्क्रीन|पेज|विभाग/gi;
  const filtered = rawText.replace(tabFilterRegex, ' ').replace(/\s+/g, ' ').trim();

  // Normalize
  const cleanedFiltered = cleanSpokenText(filtered);
  if (!cleanedFiltered) return { isTab: false };

  // Guard against explicit action commands like "start detection" or "stop navigation"
  const isStartStopAction =
    cleanedFiltered.startsWith('start ') ||
    cleanedFiltered.startsWith('stop ') ||
    cleanedFiltered.startsWith('turn on') ||
    cleanedFiltered.startsWith('turn off') ||
    cleanedFiltered.includes('start detection') ||
    cleanedFiltered.includes('stop detection') ||
    cleanedFiltered.includes('start navigation') ||
    cleanedFiltered.includes('stop navigation') ||
    cleanedFiltered.includes('start listening') ||
    cleanedFiltered.includes('stop listening');

  if (isStartStopAction) {
    return { isTab: false };
  }

  // 2. Strip leading navigation/action prefixes: "go to the", "go to", "open", "show", "switch to", "take me to", etc.
  const leadingPrefixes =
    /^(?:please\s+|can\s+you\s+|could\s+you\s+|i\s+want\s+to\s+see\s+|open\s+the\s+|open\s+|show\s+the\s+|show\s+|go\s+to\s+the\s+|go\s+to\s+|switch\s+to\s+the\s+|switch\s+to\s+|take\s+me\s+to\s+the\s+|take\s+me\s+to\s+|move\s+to\s+the\s+|move\s+to\s+|view\s+the\s+|view\s+|navigate\s+to\s+the\s+|navigate\s+to\s+|चलो\s+|खोलो\s+|उघड\s+|जा\s+|दाखवा\s+|बघा\s+)/i;
  const stripped = cleanedFiltered.replace(leadingPrefixes, '').trim();

  const app = useAppStore.getState();
  const currentLang = app.language || 'en-US';

  for (const route of TAB_ROUTES) {
    let matchedLang: 'en' | 'hi' | 'mr' | null = null;

    const testMatch = (kw: string) => {
      const cleanKw = cleanSpokenText(kw);
      if (!cleanKw) return false;
      if (stripped === cleanKw || cleanedFiltered === cleanKw) return true;
      const strippedWords = stripped.split(' ');
      if (strippedWords.length <= 2 && strippedWords.includes(cleanKw)) return true;
      return false;
    };

    for (const kw of route.keywords.en) {
      if (testMatch(kw)) {
        matchedLang = 'en';
        break;
      }
    }
    if (!matchedLang) {
      for (const kw of route.keywords.hi) {
        if (testMatch(kw)) {
          matchedLang = 'hi';
          break;
        }
      }
    }
    if (!matchedLang) {
      for (const kw of route.keywords.mr) {
        if (testMatch(kw)) {
          matchedLang = 'mr';
          break;
        }
      }
    }

    if (matchedLang) {
      const confirmation = getLocalizedConfirmation(route.confirmations, matchedLang, currentLang);
      return { isTab: true, tab: route.tab, confirmation };
    }
  }

  return { isTab: false };
}

/**
 * Extracts destination, origin, and travelmode from user speech.
 * Detects phrases like: "navigate to X", "take me to X", "go to X", "I want to go to X",
 * "directions to X", "from A to B", "drive to X", "by bus to X", etc.
 */
export function parseNavigationIntent(rawText: string): NavigationIntentParse {
  const text = (rawText || '').trim();
  if (!text) return { isNavIntent: false, destination: '', travelmode: 'walking', isEmpty: false };

  // Normalized lowercase text without punctuation
  const lower = text
    .toLowerCase()
    .replace(/[.,?!;:()"'“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Detect spoken travelmode
  let travelmode: 'walking' | 'driving' | 'transit' | 'bicycling' = 'walking';
  if (/\b(drive|driving|by car|in a car|cab|taxi)\b/i.test(lower)) {
    travelmode = 'driving';
  } else if (/\b(transit|bus|by bus|train|by train|metro|by metro|public transport|subway)\b/i.test(lower)) {
    travelmode = 'transit';
  } else if (/\b(bicycle|bicycling|by bicycle|bike|by bike|cycle|by cycle)\b/i.test(lower)) {
    travelmode = 'bicycling';
  } else if (/\b(walk|walking|by foot|on foot)\b/i.test(lower)) {
    travelmode = 'walking';
  }

  // Check explicit origin "from A to B"
  let origin: string | undefined;
  const fromToMatch = lower.match(/(?:from)\s+(.+?)\s+(?:to)\s+(.+)$/i);
  if (fromToMatch) {
    origin = fromToMatch[1].trim();
    let dest = fromToMatch[2].trim();
    dest = dest.replace(/^(?:please|the|nearest|a|an)\s+/i, '').trim();
    return {
      isNavIntent: true,
      origin,
      destination: dest,
      travelmode,
      isEmpty: !dest,
    };
  }

  // List of triggers in descending priority
  const triggerPatterns: RegExp[] = [
    /^(?:please\s+)?(?:i\s+want\s+to\s+go\s+to|i\s+need\s+to\s+go\s+to|i\s+wanna\s+go\s+to|want\s+to\s+go\s+to)\s*(.*)$/i,
    /^(?:please\s+)?(?:how\s+do\s+i\s+get\s+to|how\s+to\s+get\s+to|how\s+can\s+i\s+reach|how\s+do\s+i\s+reach)\s*(.*)$/i,
    /^(?:please\s+)?(?:take\s+me\s+to|take\s+us\s+to|bring\s+me\s+to)\s*(.*)$/i,
    /^(?:please\s+)?(?:navigate\s+to|navigation\s+to)\s*(.*)$/i,
    /^(?:please\s+)?(?:directions\s+to|direction\s+to)\s*(.*)$/i,
    /^(?:please\s+)?(?:route\s+to|routes\s+to)\s*(.*)$/i,
    /^(?:please\s+)?(?:drive\s+to|drive\s+me\s+to)\s*(.*)$/i,
    /^(?:please\s+)?(?:walk\s+to|walk\s+me\s+to)\s*(.*)$/i,
    /^(?:please\s+)?(?:by\s+bus\s+to|by\s+train\s+to|by\s+car\s+to|by\s+bike\s+to|by\s+cycle\s+to)\s*(.*)$/i,
    /^(?:please\s+)?(?:go\s+to|head\s+to|travel\s+to)\s*(.*)$/i,
    // Hindi/Marathi patterns
    /^(?:कृपया\s+)?(?:मुझे\s+)?(.+?)\s*(?:ले\s+चलो|जाना\s+है|का\s+रास्ता|का\s+मार्ग)$/i,
    /^(?:कृपया\s+)?(?:मला\s+)?(.+?)\s*(?:ला\s+जायचं\s+आहे|कडे\s+जा|चा\s+मार्ग)$/i,
  ];

  let isMatch = false;
  let rawDest = '';

  for (const pattern of triggerPatterns) {
    const match = lower.match(pattern);
    if (match) {
      isMatch = true;
      rawDest = match[1] || '';
      break;
    }
  }

  // Check standalone trigger without destination
  if (!isMatch) {
    if (
      /^(?:please\s+)?(?:navigate|directions|take me|i want to go|how do i get there)$/i.test(lower)
    ) {
      return { isNavIntent: true, destination: '', travelmode, isEmpty: true };
    }
    return { isNavIntent: false, destination: '', travelmode: 'walking', isEmpty: false };
  }

  // Strip trailing mode phrases if spoken at the end (e.g. "central park by bus" -> "central park")
  let cleaned = rawDest
    .replace(/\s*(?:by\s+bus|by\s+train|by\s+car|by\s+walking|on\s+foot|by\s+bike|by\s+cycle|by\s+metro|driving|walking)\s*$/i, '')
    .trim();

  // Strip filler words: "please", "the", "nearest", "a", "an" ONLY when they are LEADING words
  let changed = true;
  while (changed) {
    const prev = cleaned;
    cleaned = cleaned.replace(/^(?:please|the|nearest|a|an)\s+/i, '').trim();
    changed = prev !== cleaned;
  }

  cleaned = cleaned.replace(/[.,?!]+$/, '').trim();

  if (!cleaned) {
    return { isNavIntent: true, destination: '', travelmode, isEmpty: true };
  }

  return {
    isNavIntent: true,
    destination: cleaned,
    origin,
    travelmode,
    isEmpty: false,
  };
}

/**
 * Builds standard Google Maps turn-by-turn navigation URL with origin defaulted to user's current GPS.
 */
export function buildGoogleMapsUrl(destination: string, travelmode: string = 'walking'): string {
  const encDest = encodeURIComponent(destination.trim());
  return `https://www.google.com/maps/dir/?api=1&destination=${encDest}&travelmode=${travelmode}`;
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
  // 0. TRAVEL MODE ANSWER (If user was prompted "Say walk, drive, or transit")
  // -----------------------------------------------------------------
  if (app.isWaitingForTravelMode) {
    const answered = handleTravelModeAnswer(rawText);
    if (answered) {
      return {
        matched: true,
        commandName: 'travel_mode_answer',
        spokenReply: 'Travel mode selected',
      };
    }
  }

  // -----------------------------------------------------------------
  // 1. TAB SWITCHING (FIX 1: Checked BEFORE Navigation!)
  // Requirement:
  // - Before checking for navigation, remove the words "tab", "screen", "page",
  //   "section", "window", and the Hindi/Marathi equivalents (टैब, स्क्रीन, पेज, विभाग) from the sentence.
  // - Then check whether the remaining text matches a tab keyword
  //   (dashboard, detection, navigation, voice, emergency, settings and their Hindi/Marathi versions).
  // - If yes, switch the tab. Only treat the sentence as a destination if it does NOT match any tab.
  // - "go to the voice tab", "open settings page", "show the detection screen" must switch tabs and never open Google Maps.
  // -----------------------------------------------------------------
  const tabCheck = matchTabFromSpeech(rawText);
  if (tabCheck.isTab && tabCheck.tab) {
    app.setActiveTab(tabCheck.tab);
    if (tabCheck.confirmation) {
      if (tabCheck.tab === 'emergency') {
        handleEmergencySos();
        speechQueue.speak(tabCheck.confirmation, SpeechPriority.URGENT_OBSTACLE);
      } else {
        speechQueue.speak(tabCheck.confirmation, SpeechPriority.NAVIGATION);
      }
    }
    app.setLastTranscript(rawText.trim());
    stats.recordVoiceCommandSuccess(`switch to ${tabCheck.tab}`, tabCheck.confirmation || `Switched to ${tabCheck.tab}`);
    return {
      matched: true,
      commandName: `switch_to_${tabCheck.tab}`,
      spokenReply: tabCheck.confirmation,
    };
  }

  // Also check standard TAB_ROUTES for direct keyword matches
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
  // 2. NAVIGATION DESTINATION INTENT (Only treated as destination if it does NOT match any tab!)
  // -----------------------------------------------------------------

  // If user was previously asked "Where do you want to go?"
  if (app.isPendingDestination) {
    app.setIsPendingDestination(false);
    let pendingDest = cleanSpokenText(rawText);
    let changed = true;
    while (changed) {
      const prev = pendingDest;
      pendingDest = pendingDest.replace(/^(?:please|the|nearest|a|an)\s+/i, '').trim();
      changed = prev !== pendingDest;
    }
    pendingDest = pendingDest.replace(/[.,?!]+$/, '').trim();

    if (pendingDest.length > 0) {
      await openGoogleMaps(pendingDest, { heardText: rawText.trim() });
      return {
        matched: true,
        commandName: 'navigate_destination',
        spokenReply: `Opening Google Maps to ${pendingDest}`,
      };
    }
  }

  // Parse navigation intent from current transcript
  const navParsed = parseNavigationIntent(rawText);
  if (navParsed.isNavIntent) {
    if (navParsed.isEmpty || !navParsed.destination) {
      app.setIsPendingDestination(true);
      const askText = 'Where do you want to go?';
      speechQueue.speak(askText, SpeechPriority.ASSISTANT_REPLY);
      app.setLastTranscript(rawText.trim());
      stats.recordVoiceCommandSuccess(rawText.trim() || 'navigate', askText);
      return {
        matched: true,
        commandName: 'navigate_ask',
        spokenReply: askText,
      };
    }

    const dest = navParsed.destination;
    const travelmode = navParsed.travelmode;

    // Use openGoogleMaps everywhere (never window.open)
    await openGoogleMaps(dest, {
      explicitMode: travelmode,
      origin: navParsed.origin,
      heardText: rawText.trim(),
    });

    return {
      matched: true,
      commandName: 'navigate_destination',
      spokenReply: `Opening Google Maps to ${dest}`,
    };
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
