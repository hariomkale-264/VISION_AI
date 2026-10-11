/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppStore, ActiveTab } from '../store/appStore';
import { speechQueue, SpeechPriority } from './speechQueue';
import { handleEmergencySos } from './intentRouter';

export const VALID_TABS: ActiveTab[] = [
  'dashboard',
  'detection',
  'navigation',
  'voice',
  'emergency',
  'settings',
];

export interface TabInfo {
  id: ActiveTab;
  label: string;
  spokenName: string;
  confirmations: {
    en: string;
    hi: string;
    mr: string;
  };
  alreadyOpenNotices: {
    en: string;
    hi: string;
    mr: string;
  };
}

export const TAB_INFO_MAP: Record<ActiveTab, TabInfo> = {
  dashboard: {
    id: 'dashboard',
    label: 'Dashboard',
    spokenName: 'Dashboard',
    confirmations: {
      en: 'Opening Dashboard',
      hi: 'डैशबोर्ड खोल रहा हूँ',
      mr: 'डॅशबोर्ड उघडत आहे',
    },
    alreadyOpenNotices: {
      en: 'Dashboard is already open',
      hi: 'डैशबोर्ड पहले से खुला है',
      mr: 'डॅशबोर्ड आधीच उघडे आहे',
    },
  },
  detection: {
    id: 'detection',
    label: 'Detection',
    spokenName: 'Detection',
    confirmations: {
      en: 'Opening Detection',
      hi: 'डिटेक्शन खोल रहा हूँ',
      mr: 'डिटेक्शन उघडत आहे',
    },
    alreadyOpenNotices: {
      en: 'Detection is already open',
      hi: 'डिटेक्शन पहले से खुला है',
      mr: 'डिटेक्शन आधीच उघडे आहे',
    },
  },
  navigation: {
    id: 'navigation',
    label: 'Navigation',
    spokenName: 'Navigation',
    confirmations: {
      en: 'Opening Navigation',
      hi: 'नेविगेशन खोल रहा हूँ',
      mr: 'नेव्हिगेशन उघडत आहे',
    },
    alreadyOpenNotices: {
      en: 'Navigation is already open',
      hi: 'नेविगेशन पहले से खुला है',
      mr: 'नेव्हिगेशन आधीच उघडे आहे',
    },
  },
  voice: {
    id: 'voice',
    label: 'Voice',
    spokenName: 'Voice Assistant',
    confirmations: {
      en: 'Opening Voice Assistant',
      hi: 'वॉइस असिस्टेंट खोल रहा हूँ',
      mr: 'व्हॉइस असिस्टंट उघडत आहे',
    },
    alreadyOpenNotices: {
      en: 'Voice is already open',
      hi: 'वॉइस असिस्टेंट पहले से खुला है',
      mr: 'व्हॉइस असिस्टंट आधीच उघडे आहे',
    },
  },
  emergency: {
    id: 'emergency',
    label: 'Emergency',
    spokenName: 'Emergency SOS',
    confirmations: {
      en: 'Opening Emergency SOS',
      hi: 'आपातकालीन सहायता खोल रहा हूँ',
      mr: 'आपत्कालीन मदत उघडत आहे',
    },
    alreadyOpenNotices: {
      en: 'Emergency is already open',
      hi: 'आपातकालीन सहायता पहले से खुली है',
      mr: 'आपत्कालीन मदत आधीच उघडी आहे',
    },
  },
  settings: {
    id: 'settings',
    label: 'Settings',
    spokenName: 'Settings',
    confirmations: {
      en: 'Opening Settings',
      hi: 'सेटिंग खोल रहा हूँ',
      mr: 'सेटिंग्ज उघडत आहे',
    },
    alreadyOpenNotices: {
      en: 'Settings is already open',
      hi: 'सेटिंग पहले से खुली है',
      mr: 'सेटिंग्ज आधीच उघडी आहे',
    },
  },
};

/** Monotonically increasing sequence ID to protect against asynchronous race conditions */
let navSequence = 0;

export interface SwitchTabOptions {
  source?: 'sidebar' | 'voice' | 'link' | 'system';
  spokenNotice?: boolean;
}

export interface SwitchTabResult {
  success: boolean;
  tab: ActiveTab;
  alreadyActive: boolean;
  message: string;
}

/**
 * Master shared tab navigation action.
 * Used by both sidebar clicks, internal navigation links, and voice commands.
 */
export function switchTab(
  targetTab: ActiveTab,
  options?: SwitchTabOptions
): SwitchTabResult {
  const currentSeq = ++navSequence;
  const app = useAppStore.getState();
  const currentTab = app.activeTab;
  const lang = app.language || 'en-US';
  const langKey: 'en' | 'hi' | 'mr' = lang.startsWith('hi') ? 'hi' : lang.startsWith('mr') ? 'mr' : 'en';

  const tabInfo = TAB_INFO_MAP[targetTab];
  if (!tabInfo) {
    return {
      success: false,
      tab: targetTab,
      alreadyActive: false,
      message: 'Unknown tab',
    };
  }

  // 1. Prevent duplicate navigation if tab is already active
  if (currentTab === targetTab) {
    const alreadyMsg = tabInfo.alreadyOpenNotices[langKey] || tabInfo.alreadyOpenNotices.en;
    if (options?.spokenNotice) {
      speechQueue.speak(alreadyMsg, SpeechPriority.STATUS);
    }
    return {
      success: true,
      tab: targetTab,
      alreadyActive: true,
      message: alreadyMsg,
    };
  }

  // 2. Clear any waiting for destination flags so subsequent voice queries aren't trapped
  if (typeof window !== 'undefined') {
    (window as any).isWaitingForDestination = false;
  }
  app.setIsPendingDestination(false);

  // 3. Update React application navigation state
  app.setActiveTab(targetTab);

  // 4. Synchronize URL hash if available (without reloads)
  if (typeof window !== 'undefined' && window.location) {
    try {
      if (window.location.hash !== `#${targetTab}`) {
        window.history.replaceState(null, '', `#${targetTab}`);
      }
    } catch {
      // Ignore hash update failure in sandbox/iframe environments
    }
  }

  // 5. Accessible screen reader announcement
  const spokenConfirm = tabInfo.confirmations[langKey] || tabInfo.confirmations.en;
  app.announceAria(`${tabInfo.label} screen opened`);

  // 6. Emergency action trigger if entering emergency tab
  if (targetTab === 'emergency') {
    handleEmergencySos();
  }

  // 7. Spoken confirmation
  if (options?.spokenNotice) {
    const priority = targetTab === 'emergency' ? SpeechPriority.URGENT_OBSTACLE : SpeechPriority.NAVIGATION;
    speechQueue.speak(spokenConfirm, priority);
  }

  return {
    success: true,
    tab: targetTab,
    alreadyActive: false,
    message: spokenConfirm,
  };
}

/**
 * Normalizes speech transcript for forgiving intent parsing.
 * Strips common punctuation, excess whitespace, and wakes words.
 */
export function normalizeTranscript(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TabMatchResult {
  isTab: boolean;
  tab?: ActiveTab;
  confirmation?: string;
  alreadyActiveNotice?: string;
  isAlreadyActive?: boolean;
}

/**
 * Explicit tab intent matcher.
 * Matches all required natural-language commands for Dashboard, Detection, Navigation, Voice, Emergency, and Settings.
 * Protects against false positives from general questions (e.g. "What is navigation?").
 */
export function matchTabVoiceIntent(rawSpeech: string): TabMatchResult {
  if (!rawSpeech) return { isTab: false };

  const normalized = normalizeTranscript(rawSpeech);
  if (!normalized) return { isTab: false };

  // 1. Guard against general conversational questions containing tab names
  // e.g. "what is navigation", "how does detection work", "can you explain settings", "where is emergency help"
  const questionPattern =
    /^(?:what|whats|how|hows|why|when|where|wheres|who|is\s+there|are\s+there|can\s+you\s+explain|tell\s+me\s+about|do\s+you\s+have)\b/i;
  // Except when user politely asks "can you open dashboard" or "could you please switch to detection"
  const isPoliteCommand =
    /^(?:can\s+you|could\s+you|please|kindly)\s+(?:please\s+)?(?:open|show|switch\s+to|go\s+to|view|display|return\s+to|back\s+to)\b/i.test(
      normalized
    );

  if (questionPattern.test(normalized) && !isPoliteCommand) {
    return { isTab: false };
  }

  // 2. Strip leading wake phrases & polite request prefixes
  const prefixRegex =
    /^(?:vision\s+ai\s+|vision\s+|hey\s+vision\s+ai\s+|hey\s+vision\s+|ok\s+vision\s+)?(?:please\s+|kindly\s+|can\s+you\s+(?:please\s+)?|could\s+you\s+(?:please\s+)?|i\s+(?:want|would\s+like)\s+to\s+)?/i;
  let body = normalized.replace(prefixRegex, '').trim();

  // 3. Tab definitions and their specific intent patterns
  // Dashboard commands:
  // "Open Dashboard", "Switch to Dashboard", "Go to Dashboard", "Show Dashboard", "Return to Dashboard", etc.
  const dashboardPattern =
    /^(?:(?:open|show|switch\s+to|go\s+to|view|display|return\s+to|back\s+to|take\s+me\s+to)\s+(?:the\s+)?)?(?:dashboard|home|main\s+screen|main\s+page|overview|summary)(?:\s+(?:tab|screen|page|window|section))?$/i;
  const dashboardHindiMarathi =
    /^(?:डैशबोर्ड|डॅशबोर्ड|होम|मुख्य\s+पृष्ठ)(?:\s+(?:खोलो|उघडा|टैब|टॅब|स्क्रीन|पेज))?$/i;

  if (dashboardPattern.test(body) || dashboardHindiMarathi.test(body)) {
    return createResult('dashboard');
  }

  // Detection commands:
  // "Open Detection", "Switch to Detection", "Go to Detection", "Open Object Detection", "Show Detection", etc.
  const detectionPattern =
    /^(?:(?:open|show|switch\s+to|go\s+to|view|display|return\s+to|back\s+to|take\s+me\s+to)\s+(?:the\s+)?)?(?:detection|object\s+detection|detect|camera|camera\s+screen|live\s+camera|obstacles?|vision)(?:\s+(?:tab|screen|page|window|section))?$/i;
  const detectionHindiMarathi =
    /^(?:डिटेक्शन|ऑब्जेक्ट\s+डिटेक्शन|कॅमेरा|कैमरा)(?:\s+(?:खोलो|उघडा|टैब|टॅब|स्क्रीन|पेज))?$/i;

  if (detectionPattern.test(body) || detectionHindiMarathi.test(body)) {
    return createResult('detection');
  }

  // Navigation commands:
  // "Open Navigation", "Switch to Navigation", "Go to Navigation", "Start Navigation", etc.
  // Must NOT match "navigate to [destination]" or "take me to [destination]" which has a destination query.
  const navigationPattern =
    /^(?:(?:open|show|switch\s+to|go\s+to|view|display|return\s+to|back\s+to|take\s+me\s+to|start)\s+(?:the\s+)?)?(?:navigation|map|maps)(?:\s+(?:tab|screen|page|window|section))?$/i;
  const navigationHindiMarathi =
    /^(?:नेविगेशन|नेव्हिगेशन|नक्शा|नकाशा)(?:\s+(?:खोलो|उघडा|टैब|टॅब|स्क्रीन|पेज))?$/i;

  if (navigationPattern.test(body) || navigationHindiMarathi.test(body)) {
    return createResult('navigation');
  }

  // Voice commands:
  // "Open Voice", "Switch to Voice", "Go to Voice", "Open Voice Settings", etc.
  const voicePattern =
    /^(?:(?:open|show|switch\s+to|go\s+to|view|display|return\s+to|back\s+to|take\s+me\s+to)\s+(?:the\s+)?)?(?:voice|voice\s+settings|voice\s+assistant|assistant|mic|microphone)(?:\s+(?:tab|screen|page|window|section))?$/i;
  const voiceHindiMarathi =
    /^(?:वॉइस|व्हॉइस|आवाज|असिस्टंट|माइक)(?:\s+(?:खोलो|उघडा|टैब|टॅब|स्क्रीन|पेज|सेटिंग))?$/i;

  if (voicePattern.test(body) || voiceHindiMarathi.test(body)) {
    return createResult('voice');
  }

  // Emergency commands:
  // "Open Emergency", "Switch to Emergency", "Go to Emergency", "Show Emergency", etc.
  const emergencyPattern =
    /^(?:(?:open|show|switch\s+to|go\s+to|view|display|return\s+to|back\s+to|take\s+me\s+to)\s+(?:the\s+)?)?(?:emergency|sos|emergency\s+sos|help\s+me)(?:\s+(?:tab|screen|page|window|section))?$/i;
  const emergencyHindiMarathi =
    /^(?:इमरजेंसी|आपातकाल|आणीबाणी|मदत)(?:\s+(?:खोलो|उघडा|टैब|टॅब|स्क्रीन|पेज))?$/i;

  if (emergencyPattern.test(body) || emergencyHindiMarathi.test(body)) {
    return createResult('emergency');
  }

  // Settings commands:
  // "Open Settings", "Switch to Settings", "Go to Settings", "Show Settings", etc.
  const settingsPattern =
    /^(?:(?:open|show|switch\s+to|go\s+to|view|display|return\s+to|back\s+to|take\s+me\s+to)\s+(?:the\s+)?)?(?:settings?|preferences|options|app\s+settings)(?:\s+(?:tab|screen|page|window|section))?$/i;
  const settingsHindiMarathi =
    /^(?:सेटिंग|सेटिंग्स|सेटिंग्ज)(?:\s+(?:खोलो|उघडा|टैब|टॅब|स्क्रीन|पेज))?$/i;

  if (settingsPattern.test(body) || settingsHindiMarathi.test(body)) {
    return createResult('settings');
  }

  return { isTab: false };
}

function createResult(tab: ActiveTab): TabMatchResult {
  const app = useAppStore.getState();
  const currentTab = app.activeTab;
  const isAlreadyActive = currentTab === tab;
  const lang = app.language || 'en-US';
  const langKey: 'en' | 'hi' | 'mr' = lang.startsWith('hi') ? 'hi' : lang.startsWith('mr') ? 'mr' : 'en';
  const info = TAB_INFO_MAP[tab];

  return {
    isTab: true,
    tab,
    confirmation: info.confirmations[langKey] || info.confirmations.en,
    alreadyActiveNotice: info.alreadyOpenNotices[langKey] || info.alreadyOpenNotices.en,
    isAlreadyActive,
  };
}
