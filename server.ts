import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
let aiClient: GoogleGenAI | null = null;
if (apiKey) {
  aiClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Single source of truth for the model name (VITE_GEMINI_MODEL in .env, default gemini-3.7-flash)
const DEFAULT_MODEL = process.env.VITE_GEMINI_MODEL || 'gemini-3.7-flash';
const FALLBACK_MODEL = 'gemini-3.5-flash-lite';

/**
 * Executes a Gemini request with automatic 404 fallback to gemini-3.5-flash-lite.
 */
async function generateWithModelFallback(
  client: GoogleGenAI,
  params: {
    contents: any;
    config?: any;
  }
): Promise<any> {
  try {
    const res: any = await client.models.generateContent({
      model: DEFAULT_MODEL,
      ...params,
    });
    res.usedModel = DEFAULT_MODEL;
    res.isFallback = false;
    return res;
  } catch (err: any) {
    const is404 =
      err?.status === 404 ||
      String(err?.message || '').includes('404') ||
      String(err?.message || '').toLowerCase().includes('not found') ||
      String(err?.message || '').includes('Requested entity was not found');

    if (is404) {
      console.warn(
        `[Gemini Server] Primary model "${DEFAULT_MODEL}" returned 404. Retrying with fallback model "${FALLBACK_MODEL}"...`
      );
      try {
        const fallbackRes: any = await client.models.generateContent({
          model: FALLBACK_MODEL,
          ...params,
        });
        fallbackRes.usedModel = FALLBACK_MODEL;
        fallbackRes.isFallback = true;
        return fallbackRes;
      } catch (fallbackErr: any) {
        console.error(`[Gemini Server] Fallback model "${FALLBACK_MODEL}" also failed:`, fallbackErr);
        const customErr: any = new Error(
          `AI model "${DEFAULT_MODEL}" was not found (404), and fallback model "${FALLBACK_MODEL}" failed: ${
            fallbackErr?.message || fallbackErr
          }`
        );
        customErr.status = 404;
        throw customErr;
      }
    }
    throw err;
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Large limit for base64 audio and camera snapshots
  app.use(express.json({ limit: '30mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', hasGeminiKey: !!apiKey, app: 'VISION_AI', model: DEFAULT_MODEL });
  });

  // Utterance analysis endpoint (Voice Assistant)
  app.post('/api/gemini/analyze-utterance', async (req, res) => {
    try {
      const { audioBase64, mimeType = 'audio/wav', context = {} } = req.body;
      if (!audioBase64) {
        return res.status(400).json({ error: 'audioBase64 is required' });
      }

      const client = aiClient || (req.headers['x-gemini-key'] ? new GoogleGenAI({
        apiKey: String(req.headers['x-gemini-key']),
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      }) : null);

      if (!client) {
        return res.status(503).json({
          error: 'Gemini API key is missing. Please configure GEMINI_API_KEY in your environment or Settings.',
          missingKey: true,
          offline: true,
        });
      }

      const systemInstruction = `You are the voice controller of VISION_AI, an app for blind users. Understand natural speech in English, Hindi, Marathi or a mix, including paraphrases, accents and small speech errors. First transcribe the audio exactly, then infer the intent. Return ONLY valid JSON.
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
- Questions about facts, time, people, places, definitions or advice -> general_question, with a clear answer of at most 3 sentences in spoken_reply. Use the deviceTime in the app state for time questions. You do not have live weather or news unless search grounding is enabled; if you cannot check, say so briefly.
- Health or safety questions: give brief, careful general information and suggest contacting a doctor or emergency services when appropriate. Never give a diagnosis.
- If the audio is only background noise, a TV, or speech clearly not directed at the assistant, return intent 'unknown' with an empty spoken_reply.
- If the request is unclear but plausible, make your best guess instead of refusing. Never apologize for not understanding.
Keep spoken_reply to one or two short, plain sentences in the same language the user spoke.`;

      const promptText = `Analyze this audio clip from the blind user. Current app context: ${JSON.stringify(context)}.
Respond ONLY with a JSON object adhering to this schema:
{
  "transcript": string,
  "language": string,
  "intent": "start_detection" | "stop_detection" | "describe_surroundings" | "read_text" | "navigate" | "stop_navigation" | "where_am_i" | "emergency" | "volume_up" | "volume_down" | "speech_slower" | "speech_faster" | "repeat" | "stop_listening" | "help" | "general_question" | "unknown",
  "parameters": { "destination": string, "query": string },
  "spoken_reply": string
}`;

      const audioPart = {
        inlineData: {
          mimeType,
          data: audioBase64,
        },
      };

      const result = await generateWithModelFallback(client, {
        contents: [
          { role: 'user', parts: [audioPart, { text: promptText }] },
        ],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      const responseText = result.text || '{}';
      try {
        const parsed = JSON.parse(responseText);
        res.json(parsed);
      } catch (jsonErr) {
        // Retry extraction if wrapped in markdown
        const match = responseText.match(/\{[\s\S]*\}/);
        if (match) {
          res.json(JSON.parse(match[0]));
        } else {
          throw jsonErr;
        }
      }
    } catch (err: any) {
      console.error('Server error in /api/gemini/analyze-utterance:', err);
      const is404 =
        err?.status === 404 ||
        String(err?.message || '').includes('404') ||
        String(err?.message || '').toLowerCase().includes('not found');
      const statusCode = is404 ? 404 : (err.status || 500);
      const errorMessage = is404
        ? `Model not found: The requested AI model (${DEFAULT_MODEL}) is unavailable. Please verify model configuration.`
        : (err.message || 'Error processing audio');
      res.status(statusCode).json({ error: errorMessage });
    }
  });

  // Scene description endpoint
  app.post('/api/gemini/describe-scene', async (req, res) => {
    try {
      const { imageBase64, mimeType = 'image/jpeg' } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: 'imageBase64 is required' });
      }

      const client = aiClient || (req.headers['x-gemini-key'] ? new GoogleGenAI({
        apiKey: String(req.headers['x-gemini-key']),
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      }) : null);

      if (!client) {
        return res.status(503).json({
          error: 'Gemini API key is missing. Please configure GEMINI_API_KEY in your environment or Settings.',
          missingKey: true,
        });
      }

      const prompt = 'You are helping a blind person walk safely. In 2 short sentences, describe the obstacles and hazards in front of them with direction (left, ahead, right) and approximate distance. Mention stairs, poles, walls, doors, vehicles, people and ground hazards.';

      const result = await generateWithModelFallback(client, {
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: imageBase64 } },
              { text: prompt },
            ],
          },
        ],
      });

      res.json({ description: result.text || 'Path appears clear.' });
    } catch (err: any) {
      console.error('Server error in /api/gemini/describe-scene:', err);
      const is404 =
        err?.status === 404 ||
        String(err?.message || '').includes('404') ||
        String(err?.message || '').toLowerCase().includes('not found');
      const statusCode = is404 ? 404 : (err.status || 500);
      const errorMessage = is404
        ? `Model not found: The requested AI model (${DEFAULT_MODEL}) is unavailable. Please verify model configuration.`
        : (err.message || 'Error describing scene');
      res.status(statusCode).json({ error: errorMessage });
    }
  });

  // OCR / Read text endpoint
  app.post('/api/gemini/read-text', async (req, res) => {
    try {
      const { imageBase64, mimeType = 'image/jpeg' } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: 'imageBase64 is required' });
      }

      const client = aiClient || (req.headers['x-gemini-key'] ? new GoogleGenAI({
        apiKey: String(req.headers['x-gemini-key']),
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      }) : null);

      if (!client) {
        return res.status(503).json({
          error: 'Gemini API key is missing. Please configure GEMINI_API_KEY in your environment or Settings.',
          missingKey: true,
        });
      }

      const prompt = 'Read all visible text in this image clearly and concisely for a blind person. If no text is readable, say "No readable text found". Do not describe anything other than the text itself.';

      const result = await generateWithModelFallback(client, {
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: imageBase64 } },
              { text: prompt },
            ],
          },
        ],
      });

      res.json({ text: result.text || 'No readable text found.' });
    } catch (err: any) {
      console.error('Server error in /api/gemini/read-text:', err);
      const is404 =
        err?.status === 404 ||
        String(err?.message || '').includes('404') ||
        String(err?.message || '').toLowerCase().includes('not found');
      const statusCode = is404 ? 404 : (err.status || 500);
      const errorMessage = is404
        ? `Model not found: The requested AI model (${DEFAULT_MODEL}) is unavailable. Please verify model configuration.`
        : (err.message || 'Error reading text');
      res.status(statusCode).json({ error: errorMessage });
    }
  });

  // Camera test frame analysis endpoint with custom task prompt
  app.post('/api/gemini/analyze-frame', async (req, res) => {
    try {
      const { imageBase64, mimeType = 'image/jpeg', prompt = 'Identify the object and describe it' } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: 'imageBase64 is required' });
      }

      const client = aiClient || (req.headers['x-gemini-key'] ? new GoogleGenAI({
        apiKey: String(req.headers['x-gemini-key']),
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      }) : null);

      if (!client) {
        return res.status(503).json({
          error: 'Gemini API key is missing. Please configure GEMINI_API_KEY in your environment or Settings.',
          missingKey: true,
        });
      }

      const systemInstruction =
        'You are an intelligent vision assistant for the VISION_AI application. Answer the user prompt directly, concisely, and factually based on the provided camera image. In 2 to 4 sentences, describe the key objects, actions, text, or scene elements.';

      const result = await generateWithModelFallback(client, {
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: imageBase64 } },
              { text: prompt },
            ],
          },
        ],
        config: {
          systemInstruction,
          temperature: 0.3,
        },
      });

      res.json({
        result: result.text || 'No description generated.',
        model: result.usedModel || DEFAULT_MODEL,
        isFallback: result.isFallback || false,
      });
    } catch (err: any) {
      console.error('Server error in /api/gemini/analyze-frame:', err);
      const is404 =
        err?.status === 404 ||
        String(err?.message || '').includes('404') ||
        String(err?.message || '').toLowerCase().includes('not found');
      const statusCode = is404 ? 404 : (err.status || (String(err.message).includes('429') ? 429 : 500));
      const errorMessage = is404
        ? `Model not found: The requested AI model (${DEFAULT_MODEL}) is unavailable. Please verify model configuration.`
        : (err.message || 'Error analyzing camera frame');
      res.status(statusCode).json({ error: errorMessage });
    }
  });

  // General question endpoint for when local router doesn't match
  app.post('/api/gemini/general-question', async (req, res) => {
    try {
      const { question, context = {} } = req.body;
      if (!question) {
        return res.status(400).json({ error: 'question is required' });
      }

      const client = aiClient || (req.headers['x-gemini-key'] ? new GoogleGenAI({
        apiKey: String(req.headers['x-gemini-key']),
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      }) : null);

      if (!client) {
        return res.status(503).json({
          error: 'Gemini API key is missing. Please configure GEMINI_API_KEY in your environment or Settings.',
          missingKey: true,
        });
      }

      const systemInstruction = 'You are VISION_AI, a concise voice assistant for a blind person. Give clear answers in at most 2 sentences in the same language the user spoke. Current device time: ' + (context.deviceTime || new Date().toISOString());

      const result = await generateWithModelFallback(client, {
        contents: question,
        config: {
          systemInstruction,
          temperature: 0.3,
        },
      });

      res.json({ reply: result.text || 'I am ready to help.' });
    } catch (err: any) {
      console.error('Server error in /api/gemini/general-question:', err);
      const is404 =
        err?.status === 404 ||
        String(err?.message || '').includes('404') ||
        String(err?.message || '').toLowerCase().includes('not found');
      const statusCode = is404 ? 404 : (err.status || (String(err.message).includes('429') ? 429 : 500));
      const errorMessage = is404
        ? `Model not found: The requested AI model (${DEFAULT_MODEL}) is unavailable. Please verify model configuration.`
        : (err.message || 'Error answering question');
      res.status(statusCode).json({ error: errorMessage });
    }
  });

  const server = http.createServer(app);

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    // Graceful WebSocket handler for Vite client in dev mode
    // Prevents "WebSocket closed without opened" errors when HMR is disabled in iframe environments
    const wss = new WebSocketServer({ server });
    wss.on('error', () => {});
    wss.on('connection', (ws: any) => {
      ws.on('error', () => {});
      if (ws.protocol === 'vite-ping') {
        // ping requests open and immediately close from client side
        return;
      }
      try {
        ws.send(JSON.stringify({ type: 'connected' }));
      } catch {
        // ignore write errors if socket closed early
      }
    });

    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`VISION_AI server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
