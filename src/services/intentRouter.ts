/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppStore } from '../store/appStore';
import { useStatsStore } from '../store/statsStore';
import { speechQueue, SpeechPriority } from './speechQueue';
import { describeSurroundings, readTextFromImage, formatSpecificError, GeminiVoiceResponse } from './gemini';
import { searchDestination, reverseGeocode } from './geocode';
import { getWalkingRoute } from './routing';
import { formatDistance } from '../utils/haversine';

// Snapshot provider registered by the camera component
let cameraSnapshotGetter: (() => string | null) | null = null;
let micStopHandler: (() => void) | null = null;

export function registerCameraSnapshotProvider(getter: () => string | null): () => void {
  cameraSnapshotGetter = getter;
  return () => {
    if (cameraSnapshotGetter === getter) {
      cameraSnapshotGetter = null;
    }
  };
}

export function registerMicStopHandler(handler: () => void): () => void {
  micStopHandler = handler;
  return () => {
    if (micStopHandler === handler) {
      micStopHandler = null;
    }
  };
}

export async function executeVoiceIntent(response: GeminiVoiceResponse): Promise<void> {
  const app = useAppStore.getState();
  const stats = useStatsStore.getState();

  const transcript = (response.transcript || '').trim();
  const intent = response.intent;
  const reply = response.spoken_reply;
  const destinationParam = response.parameters?.destination;

  // 1. Handle confirmation flow for "stop_listening"
  if (app.isPendingStopListening) {
    const lower = transcript.toLowerCase();
    if (lower.includes('yes') || lower.includes('confirm') || lower.includes('sure') || lower.includes('stop')) {
      app.setIsPendingStopListening(false);
      speechQueue.speak('Microphone turned off.', SpeechPriority.STATUS, {
        onEnd: () => {
          if (micStopHandler) micStopHandler();
          app.setMicStatus('paused');
        },
      });
      stats.recordVoiceCommandSuccess(transcript || 'stop listening', 'User confirmed turning mic off');
      return;
    } else {
      app.setIsPendingStopListening(false);
      speechQueue.speak('Keeping microphone on.', SpeechPriority.STATUS);
      return;
    }
  }

  // 2. Handle pending destination follow-up
  if (app.isPendingDestination) {
    app.setIsPendingDestination(false);
    if (transcript.length > 0) {
      await handleNavigateIntent(transcript, transcript);
      return;
    }
  }

  // 3. Process primary intents
  switch (intent) {
    case 'start_detection': {
      app.setDetectionActive(true);
      const confirmText = reply || 'Starting object detection';
      speechQueue.speak(confirmText, SpeechPriority.STATUS);
      stats.recordVoiceCommandSuccess(transcript || 'start detection', 'Turned on camera detection');
      break;
    }

    case 'stop_detection': {
      app.setDetectionActive(false);
      stats.updateLiveDetections([]);
      const confirmText = 'Detection stopped';
      speechQueue.speak(confirmText, SpeechPriority.STATUS);
      stats.recordVoiceCommandSuccess(transcript || 'stop detection', 'Turned off camera detection');
      break;
    }

    case 'describe_surroundings': {
      let imageBase64: string | null = null;
      if (cameraSnapshotGetter) {
        imageBase64 = cameraSnapshotGetter();
      }

      if (!imageBase64) {
        speechQueue.speak('Camera is not ready. Please enable detection or point your camera.', SpeechPriority.ASSISTANT_REPLY);
        return;
      }

      speechQueue.speak('Analyzing surroundings...', SpeechPriority.STATUS);
      try {
        const description = await describeSurroundings(imageBase64);
        app.setLastSceneDescription(description);
        speechQueue.speak(description, SpeechPriority.ASSISTANT_REPLY);
        stats.recordVoiceCommandSuccess(transcript || 'describe surroundings', description);
        stats.addActivity({
          type: 'detection',
          title: 'Scene Described',
          detail: description,
          status: 'Completed',
        });
      } catch (err: any) {
        console.error('Scene description error:', err);
        const { spoken, debug } = formatSpecificError(err);
        speechQueue.speak(spoken, SpeechPriority.ASSISTANT_REPLY);
      }
      break;
    }

    case 'read_text': {
      let imageBase64: string | null = null;
      if (cameraSnapshotGetter) {
        imageBase64 = cameraSnapshotGetter();
      }

      if (!imageBase64) {
        speechQueue.speak('Camera is not ready to read text.', SpeechPriority.ASSISTANT_REPLY);
        return;
      }

      speechQueue.speak('Reading text in front of you...', SpeechPriority.STATUS);
      try {
        const textFound = await readTextFromImage(imageBase64);
        app.setLastOcrText(textFound);
        speechQueue.speak(textFound, SpeechPriority.ASSISTANT_REPLY);
        stats.recordVoiceCommandSuccess(transcript || 'read text', textFound);
        stats.addActivity({
          type: 'detection',
          title: 'Text Read',
          detail: textFound,
          status: 'Completed',
        });
      } catch (err: any) {
        console.error('Read text error:', err);
        const { spoken, debug } = formatSpecificError(err);
        speechQueue.speak(spoken, SpeechPriority.ASSISTANT_REPLY);
      }
      break;
    }

    case 'navigate': {
      const target = destinationParam || '';
      if (!target || target.trim().length === 0) {
        app.setIsPendingDestination(true);
        speechQueue.speak(reply || 'Where would you like to go?', SpeechPriority.ASSISTANT_REPLY);
      } else {
        await handleNavigateIntent(target, transcript);
      }
      break;
    }

    case 'stop_navigation': {
      app.stopNavigation();
      speechQueue.speak('Navigation stopped.', SpeechPriority.STATUS);
      stats.recordVoiceCommandSuccess('stop_navigation', 'Stopped turn-by-turn guidance');
      stats.addActivity({
        type: 'navigation',
        title: 'Navigation Stopped',
        detail: 'Guidance cancelled by user',
        status: 'Completed',
      });
      break;
    }

    case 'where_am_i': {
      const loc = app.currentLocation;
      if (loc.lat != null && loc.lng != null) {
        speechQueue.speak('Finding your current location...', SpeechPriority.STATUS);
        const address = await reverseGeocode(loc.lat, loc.lng);
        app.setCurrentLocation({ address });
        speechQueue.speak(`You are near ${address}`, SpeechPriority.ASSISTANT_REPLY);
        stats.recordVoiceCommandSuccess('where_am_i', `Near ${address}`);
      } else {
        speechQueue.speak('Still acquiring GPS signal. Please allow location access.', SpeechPriority.ASSISTANT_REPLY);
      }
      break;
    }

    case 'emergency': {
      handleEmergencySos();
      break;
    }

    case 'volume_up': {
      const newVol = Math.min(1.0, (app.speechVolume || 1.0) + 0.15);
      app.setSpeechVolume(newVol);
      speechQueue.speak('Volume increased.', SpeechPriority.STATUS);
      stats.recordVoiceCommandSuccess('volume_up', `Volume set to ${Math.round(newVol * 100)}%`);
      break;
    }

    case 'volume_down': {
      const newVol = Math.max(0.2, (app.speechVolume || 1.0) - 0.15);
      app.setSpeechVolume(newVol);
      speechQueue.speak('Volume decreased.', SpeechPriority.STATUS);
      stats.recordVoiceCommandSuccess('volume_down', `Volume set to ${Math.round(newVol * 100)}%`);
      break;
    }

    case 'speech_slower': {
      const newRate = Math.max(0.7, (app.speechRate || 1.0) - 0.15);
      app.setSpeechRate(newRate);
      speechQueue.speak('Speaking slower.', SpeechPriority.STATUS);
      stats.recordVoiceCommandSuccess('speech_slower', `Rate set to ${newRate.toFixed(2)}x`);
      break;
    }

    case 'speech_faster': {
      const newRate = Math.min(1.5, (app.speechRate || 1.0) + 0.15);
      app.setSpeechRate(newRate);
      speechQueue.speak('Speaking faster.', SpeechPriority.STATUS);
      stats.recordVoiceCommandSuccess('speech_faster', `Rate set to ${newRate.toFixed(2)}x`);
      break;
    }

    case 'repeat': {
      const lastReply = app.lastReply;
      if (lastReply) {
        speechQueue.speak(lastReply, SpeechPriority.ASSISTANT_REPLY);
      } else {
        speechQueue.speak('Nothing to repeat yet.', SpeechPriority.ASSISTANT_REPLY);
      }
      stats.recordVoiceCommandSuccess('repeat', 'Repeated last message');
      break;
    }

    case 'stop_listening': {
      app.setIsPendingStopListening(true);
      speechQueue.speak('Turning the microphone off. Say yes to confirm.', SpeechPriority.STATUS);
      break;
    }

    case 'help': {
      const helpText =
        'You can say: start detection, stop detection, describe surroundings, read text, navigate to a place, where am I, emergency, volume up, or speak faster.';
      speechQueue.speak(helpText, SpeechPriority.ASSISTANT_REPLY);
      stats.recordVoiceCommandSuccess('help', 'Spoke list of commands');
      break;
    }

    case 'general_question': {
      if (reply && reply.trim().length > 0) {
        speechQueue.speak(reply, SpeechPriority.ASSISTANT_REPLY);
        stats.recordVoiceCommandSuccess('general_question', reply);
      }
      break;
    }

    case 'unknown':
    default: {
      // If transcript was empty or silence, ignore silently per Section 3.5
      if (!transcript || transcript.trim().length === 0) {
        return;
      }
      // If intent is unknown with real transcript, ask specific question
      speechQueue.speak(
        'Do you want me to detect objects, navigate somewhere, or answer a question?',
        SpeechPriority.ASSISTANT_REPLY
      );
      break;
    }
  }
}

async function handleNavigateIntent(destinationQuery: string, userSpeech?: string): Promise<void> {
  const app = useAppStore.getState();
  const stats = useStatsStore.getState();

  const userLoc = app.currentLocation;
  if (userLoc.lat == null || userLoc.lng == null) {
    speechQueue.speak('Waiting for GPS location before calculating route.', SpeechPriority.ASSISTANT_REPLY);
    return;
  }

  speechQueue.speak(`Searching for ${destinationQuery}...`, SpeechPriority.STATUS);

  try {
    const matches = await searchDestination(destinationQuery, userLoc.lat, userLoc.lng);
    if (matches.length === 0) {
      speechQueue.speak(`Could not find ${destinationQuery}. Please try a different place name.`, SpeechPriority.ASSISTANT_REPLY);
      return;
    }

    const bestMatch = matches[0];
    const distText = bestMatch.distanceMeters ? `about ${formatDistance(bestMatch.distanceMeters)} away` : '';
    const announceName = bestMatch.name || destinationQuery;

    speechQueue.speak(`Found ${announceName}, ${distText}. Calculating walking route.`, SpeechPriority.STATUS);

    const route = await getWalkingRoute(userLoc.lat, userLoc.lng, bestMatch.lat, bestMatch.lng);

    app.startNavigation(
      announceName,
      [bestMatch.lat, bestMatch.lng],
      route.coordinates,
      route.steps,
      route.distanceMeters,
      route.durationSeconds
    );

    // Speak initial step
    const firstStep = route.steps[0]?.instruction || `Proceed toward ${announceName}`;
    speechQueue.speak(`Starting navigation to ${announceName}. ${firstStep}.`, SpeechPriority.NAVIGATION);

    const commandText = userSpeech?.trim() || `navigate to ${destinationQuery}`;
    stats.recordVoiceCommandSuccess(commandText, `Started route to ${announceName} (${formatDistance(route.distanceMeters)})`);
    stats.addActivity({
      type: 'navigation',
      title: `Route to ${announceName}`,
      detail: `${formatDistance(route.distanceMeters)}, ~${Math.ceil(route.durationSeconds / 60)} min walk`,
      status: 'Completed',
    });
  } catch (err: any) {
    console.error('Navigation error:', err);
    speechQueue.speak('Unable to calculate walking route to that location.', SpeechPriority.ASSISTANT_REPLY);
  }
}

export function handleEmergencySos(): void {
  const app = useAppStore.getState();
  const stats = useStatsStore.getState();

  speechQueue.speak('Sending your location', SpeechPriority.URGENT_OBSTACLE);

  const loc = app.currentLocation;
  const lat = loc.lat != null ? loc.lat.toFixed(6) : '0';
  const lng = loc.lng != null ? loc.lng.toFixed(6) : '0';
  const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  const emergencyContact = app.emergencyContact;

  const shareText = `EMERGENCY ALERT: I need immediate assistance. My current location is ${loc.address || 'GPS coordinates'}: ${mapsUrl}`;

  if (typeof navigator !== 'undefined' && 'share' in navigator) {
    navigator
      .share({
        title: 'VISION_AI Emergency Alert',
        text: shareText,
        url: mapsUrl,
      })
      .catch((err) => {
        console.warn('Web Share failed, fallback to clipboard:', err);
        fallbackCopyToClipboard(shareText);
      });
  } else {
    fallbackCopyToClipboard(shareText);
  }

  stats.recordVoiceCommandSuccess('emergency', `Sent SOS with coordinates ${lat}, ${lng}`);
  stats.addActivity({
    type: 'emergency',
    title: 'Emergency SOS Triggered',
    detail: `Location shared to ${emergencyContact.name || 'contact'}: ${lat}, ${lng}`,
    status: 'Completed',
  });
}

function fallbackCopyToClipboard(text: string): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      speechQueue.speak('Emergency message and location copied to clipboard.', SpeechPriority.STATUS);
    }).catch(() => {});
  }
}
