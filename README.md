# VISION_AI - Voice-First Assistive PWA

VISION_AI is a production-quality, voice-first assistive Progressive Web App designed specifically for blind and low-vision individuals. It provides hands-free Gemini voice interaction, real-time in-browser camera obstacle detection across all 80 COCO classes, and turn-by-turn pedestrian GPS navigation.

---

## 1. Key Features

- **Hands-Free, Always-On Voice Assistant (Gemini)**:
  - Continuous microphone with client-side Voice Activity Detection (VAD) via RMS energy tracking.
  - 300 ms pre-roll buffer, automatic 1.2-second silence closure, and 400ms to 15s clip bounds.
  - Automatic silence and noise filtering (no unnecessary network requests).
  - One Gemini call per utterance returning transcript, inferred intent, and natural spoken reply together.
  - Mute-during-speech protection: Mic input is paused while Text-to-Speech is active and resumes 400 ms after speech concludes so the assistant never hears itself.
  - Automatic exponential backoff reconnection if the audio stream drops.
  - Screen Wake Lock to prevent the screen from turning off while listening.
  - Supports English, Hindi, and Marathi natural speech, including colloquialisms and accents.

- **Real-Time On-Device Object Detection (TensorFlow.js + COCO-SSD)**:
  - Full-width rear camera feed (`facingMode: "environment"`).
  - Scans all 80 COCO classes (people, chairs, bottles, vehicles, bicycles, dogs, benches, backpacks, laptops, etc.).
  - 3D directional positioning: &ldquo;on your left&rdquo; / &ldquo;ahead&rdquo; / &ldquo;on your right&rdquo;.
  - Proximity estimates: &ldquo;very close&rdquo; / &ldquo;close&rdquo; / &ldquo;far&rdquo; with dynamic audio proximity beeps that speed up as obstacles get closer.
  - Combined prioritized announcements debounced per class and direction every 4 seconds.
  - Accurate (`mobilenet_v2`) and Fast (`lite_mobilenet_v2`) model toggle.

- **Scene Description & OCR Text Reading (Gemini Vision)**:
  - &ldquo;What is in front of me?&rdquo; captures a 1024px JPEG frame and describes hazards, stairs, walls, doors, poles, and ground hazards.
  - &ldquo;Read this&rdquo; reads aloud all printed signs or document text.

- **Pedestrian GPS Navigation (Leaflet + Nominatim + OSRM)**:
  - High-accuracy geolocation tracking with real Haversine distance accumulation.
  - OpenStreetMap Nominatim geocoding biased to current user coordinates.
  - OSRM walking route calculation with turn-by-turn spoken guidance.
  - Re-announces instructions within 20m of upcoming turns.
  - Automatic rerouting if the user wanders >30m off course.

- **Emergency SOS**:
  - One-tap or spoken &ldquo;emergency&rdquo; trigger.
  - Generates a Google Maps coordinates link and broadcasts to saved emergency contacts via the Web Share API (with clipboard fallback).

- **Strict Real Data & Zero Fake Stats**:
  - Objects detected incremented only when seen across >= 3 consecutive frames and not within 5s at similar positions.
  - Distance walked calculated from real GPS movement (filters accuracy > 25m and speeds > 10m/s).
  - 7-day sparklines and comparisons calculated strictly from stored history.
  - No fake trends or weekly obstacle graphs.

- **Accessibility First**:
  - Spoken onboarding explaining app features and requesting permissions step-by-step.
  - High-Contrast theme (black/yellow WCAG AAA).
  - Large text mode (up to 150%).
  - Minimum 56px touch targets throughout.
  - Safety disclaimer: *&ldquo;VISION_AI is an assistive tool and does not replace a white cane or guide dog.&rdquo;*

---

## 2. Architecture & API Security

### Production Backend Proxy
Production environments should route Gemini calls through the built-in Express server (`server.ts`) on `/api/gemini/analyze-utterance`, `/api/gemini/describe-scene`, and `/api/gemini/read-text`. In this architecture:
- `GEMINI_API_KEY` is kept exclusively on the server (`process.env.GEMINI_API_KEY`).
- The client browser never receives or exposes the API key.
- A client-side fallback (`VITE_GEMINI_API_KEY`) is provided for local static preview environments.

### PWA & Offline Support
- Built with `vite-plugin-pwa` and Workbox.
- Pre-caches application shell, icons, and fonts.
- Runtime caches COCO-SSD model weights from Google Cloud Storage / TFHub and OpenStreetMap map tiles.

---

## 3. Browser & Device Constraints

1. **HTTPS Requirement**: Modern browsers require a secure HTTPS origin (or `localhost`) to access `navigator.mediaDevices.getUserMedia` (microphone and camera) and `navigator.geolocation`.
2. **Background Mic & Screen Locking Limits**: In mobile web browsers (Safari iOS and Chrome Android), media recording and audio context access may be suspended by the OS if the screen is locked or the tab is placed in the background. The app acquires a **Screen Wake Lock** (`navigator.wakeLock`) while listening to keep the screen active.
3. **Audio Autoplay Policy**: Web Speech Synthesis and AudioContext require an initial user gesture (e.g. tap &ldquo;Enter VISION_AI&rdquo; in onboarding) before audio playback can begin.

---

## 4. Setup & Running

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Set GEMINI_API_KEY in .env

# Start full-stack dev server
npm run dev

# Build for production
npm run build
```

---

## 5. Verification & Testing Checklist

- [x] Saying &ldquo;start detection&rdquo; turns on the rear camera and displays bounding boxes on objects.
- [x] Saying &ldquo;stop detection&rdquo; clears the canvas and halts the camera stream immediately.
- [x] Saying &ldquo;navigate me to [destination]&rdquo; plots walking path on Leaflet and starts turn-by-turn speech.
- [x] Stopping detection does not stop navigation; both operate concurrently.
- [x] Saying &ldquo;what is in front of me&rdquo; triggers Gemini Vision scene hazard description.
- [x] Saying &ldquo;what time is it&rdquo; returns the current local time via device time context.
- [x] Microphone stays active without timeouts, ignores ambient silence, and never hears its own spoken reply.
- [x] Natural phrasing (e.g. &ldquo;take me to the station&rdquo;) works through LLM intent classification without regex.
- [x] All 3 stat cards start at 0 and update only upon verified real events.
- [x] No trends graph appears on the dashboard.
- [x] Network failures fail gracefully with &ldquo;I&apos;m having trouble connecting&rdquo; rather than &ldquo;I did not understand&rdquo;.
- [x] Installs as an offline-ready PWA with responsive mobile and desktop layouts.
