import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { SpeechClient } from "@google-cloud/speech";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY || process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE_ID = process.env.ELEVEN_VOICE_ID || process.env.ELEVENLABS_VOICE_ID;

console.log("process.env", process.env);

console.log("GEMINI_API_KEY present?", !!process.env.GEMINI_API_KEY);
console.log("GEMINI_API_KEY length:", process.env.GEMINI_API_KEY?.length || 0);

// Initialize Speech Client with credentials from env or file
let speechClient;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  speechClient = new SpeechClient({ credentials });
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  // Check if it's JSON content or a file path
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS.trim().startsWith('{')) {
    // It's JSON content, parse it
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    speechClient = new SpeechClient({ credentials });
  } else {
    // It's a file path
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS.startsWith('/') 
      ? process.env.GOOGLE_APPLICATION_CREDENTIALS 
      : join(__dirname, process.env.GOOGLE_APPLICATION_CREDENTIALS);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
    speechClient = new SpeechClient();
  }
} else {
  const credentialsPath = join(__dirname, 'service-account.json');
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
  speechClient = new SpeechClient();
}

// Using gemini-flash-latest (gemini-2.5-flash) as required
// Note: This model uses ~149 thinking tokens, so we need higher maxOutputTokens
const GEMINI_MODEL = "gemini-flash-latest";

console.log('🚀 Server starting...');
console.log('✅ Using Gemini model:', GEMINI_MODEL);
console.log('   (Note: This model uses thinking tokens, so maxOutputTokens is set higher)');

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static(join(__dirname, "public")));

app.use(cors());

const chatHistories = new Map();
const MAX_TURNS = 20;
const SESSION_TIMEOUT = 30 * 60 * 1000;

function getOrCreateChatHistory(conversationId) {
  if (!conversationId) {
    conversationId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  if (!chatHistories.has(conversationId)) {
    console.log(`Creating new chat history for session: ${conversationId}`);
    chatHistories.set(conversationId, {
      history: [],
      lastAccess: Date.now()
    });
  } else {
    chatHistories.get(conversationId).lastAccess = Date.now();
  }
  
  return chatHistories.get(conversationId).history;
}

function cleanupOldSessions() {
  const now = Date.now();
  for (const [id, session] of chatHistories.entries()) {
    if (now - session.lastAccess > SESSION_TIMEOUT) {
      console.log(`Cleaning up expired session: ${id}`);
      chatHistories.delete(id);
    }
  }
}

setInterval(cleanupOldSessions, 5 * 60 * 1000);

app.post("/process", async (req, res) => {
  try {
    const { audioContentB64, languageCode = "es-ES", sceneContext, conversationId, audioFormat = "webm" } = req.body || {};
    console.log('=== /process endpoint called ===');
    console.log('Conversation ID:', conversationId);
    console.log('Audio length:', audioContentB64?.length || 0);
    console.log('Audio format:', audioFormat);
    console.log('Scene context:', JSON.stringify(sceneContext, null, 2));

    if (!audioContentB64) {
      return res.status(400).json({ error: "Missing audioContentB64" });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "Gemini API not configured" });
    }

    if (!ELEVEN_API_KEY || !ELEVEN_VOICE_ID) {
      return res.status(500).json({ error: "ElevenLabs API not configured" });
    }

    // 1) GCP Speech-to-Text - Try multiple encodings
    console.log('Starting STT transcription...');
    console.log('Audio size (base64):', audioContentB64.length, 'bytes');
    const sttStartTime = Date.now();
    
    const encodings = ["WEBM_OPUS", "OGG_OPUS", "MP3"];
    let sttResp = null;
    let usedEncoding = null;
    
    for (const encoding of encodings) {
      try {
        console.log(`Trying encoding: ${encoding}`);
        [sttResp] = await speechClient.recognize({
          config: {
            encoding: encoding,
            languageCode: languageCode,
            enableAutomaticPunctuation: true,
            model: "latest_short"
          },
          audio: { content: audioContentB64 }
        });
        
        if (sttResp.results && sttResp.results.length > 0) {
          usedEncoding = encoding;
          console.log(`Success with encoding: ${encoding}`);
          break;
        }
      } catch (error) {
        console.log(`Failed with ${encoding}:`, error.message);
      }
    }

    if (!sttResp || !sttResp.results || sttResp.results.length === 0) {
      console.error('❌ STT FAILED - No speech detected in audio');
      console.error('This means:');
      console.error('  1. Audio is too quiet/silent');
      console.error('  2. Audio format is corrupted/invalid');
      console.error('  3. Audio duration too short');
      console.error('  4. No actual speech in the recording');
      
      return res.status(400).json({
        error: "No speech detected in audio. Please speak louder and hold SPACE longer.",
        conversationId,
        transcript: ""
      });
    }

    console.log('STT raw response:', JSON.stringify(sttResp, null, 2));

    const transcript = (sttResp.results || [])
      .map(r => r.alternatives?.[0]?.transcript || "")
      .join(" ")
      .trim();
    
    const sttDuration = Date.now() - sttStartTime;
    console.log('STT completed in', sttDuration, 'ms');
    console.log('Used encoding:', usedEncoding);
    console.log('Transcript:', transcript);
    console.log('Number of results:', sttResp.results?.length || 0);

    if (!transcript) {
      return res.json({
        conversationId,
        transcript: "",
        replyText: "No pude escucharte bien. ¿Puedes repetir?",
        audioB64: null,
        audioMime: "audio/mpeg"
      });
    }

    // 2) Build context message
    let userMessage = transcript;
    if (sceneContext) {
      const contextInfo = [];
      if (sceneContext.character) {
        contextInfo.push(`Personaje actual: ${sceneContext.character}`);
      }
      if (sceneContext.background) {
        contextInfo.push(`Fondo actual: ${sceneContext.background}`);
      }
      if (sceneContext.objects && sceneContext.objects.length > 0) {
        contextInfo.push(`Objetos en escena: ${sceneContext.objects.join(', ')}`);
      } else {
        contextInfo.push(`Objetos en escena: ninguno`);
      }
      
      userMessage = `[CONTEXTO: ${contextInfo.join(' | ')}]\n\nUsuario dice: ${transcript}`;
    }

    console.log('Message to Gemini:', userMessage);

    // 3) Get or create chat history
    const chatHistory = getOrCreateChatHistory(conversationId);
    chatHistory.push({
      role: "user",
      parts: [{ text: userMessage }]
    });

    // 4) Call Gemini
    console.log('Starting Gemini call...');
    const geminiStartTime = Date.now();
    
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const geminiPayload = {
      contents: chatHistory,
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      generationConfig: {
        temperature: 0.8,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1000,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The response text in Spanish - MUST be in Spanish, never English"
            },
            command: {
              type: "string",
              description: "Optional command to execute - ONLY for semantic intent: bodoque, tulio, snow/invierno",
              nullable: true
            }
          },
          required: ["text"]
        }
      }
    };

    const geminiResp = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiPayload)
    });

    if (!geminiResp.ok) {
      const errTxt = await geminiResp.text().catch(() => "");
      throw new Error(`Gemini API failed: ${geminiResp.status} ${errTxt}`);
    }

    const geminiData = await geminiResp.json();
    const geminiDuration = Date.now() - geminiStartTime;
    console.log('Gemini completed in', geminiDuration, 'ms');
    console.log('Gemini raw data:', JSON.stringify(geminiData, null, 2));

    if (!geminiData?.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error('❌ GEMINI FAILED - Invalid response structure');
      console.error('Finish reason:', geminiData?.candidates?.[0]?.finishReason);
      console.error('Full response:', JSON.stringify(geminiData, null, 2));
      
      throw new Error(`Gemini returned invalid response. Finish reason: ${geminiData?.candidates?.[0]?.finishReason || 'unknown'}. This usually means the model is using thinking tokens or hitting MAX_TOKENS.`);
    }

    let rawReply = geminiData.candidates[0].content.parts[0].text;
    console.log('✅ Gemini raw reply:', rawReply);
    let replyText = null;
    let llmCommand = null;

    try {
      let jsonToParse = rawReply.trim();
      
      if (!jsonToParse.startsWith('{')) {
        const jsonMatch = rawReply.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonToParse = jsonMatch[0];
        } else {
          replyText = rawReply;
          throw new Error('No JSON found');
        }
      }
      
      const parsed = JSON.parse(jsonToParse);
      
      if (parsed.text) {
        replyText = parsed.text;
        llmCommand = parsed.command || null;
      } else {
        replyText = rawReply;
      }
    } catch (e) {
      if (!replyText) {
        replyText = rawReply;
      }
    }

    if (!replyText || replyText.trim().length === 0) {
      const response = {
        conversationId,
        transcript,
        replyText: '',
        audioB64: null,
        audioMime: "audio/mpeg"
      };
      return res.json(response);
    }

    // Intent-based command detection (Gemini AI only for semantic understanding)
    // Only detect: bodoque, tulio, snow/invierno (winter)
    // Everything else is handled by keyword detection in the frontend (SpeechManager.js)
    
    let commands = [];
    
    // Use Gemini's intent command if it matches our allowed intent commands
    const allowedIntentCommands = ['bodoque', 'tulio', 'snow', 'invierno'];
    
    if (llmCommand && allowedIntentCommands.includes(llmCommand.toLowerCase())) {
      commands = [llmCommand];
      console.log(`🤖 Using Gemini intent command: ${llmCommand}`);
    } else if (llmCommand) {
      console.log(`⚠️  Ignoring unsupported Gemini command: ${llmCommand} (only bodoque, tulio, snow/invierno are intent-based)`);
    }

    // 5) Update chat history
    chatHistory.push({
      role: "model",
      parts: [{ text: replyText }]
    });

    if (chatHistory.length > MAX_TURNS * 2) {
      const trimmed = chatHistory.slice(-MAX_TURNS * 2);
      chatHistory.length = 0;
      chatHistory.push(...trimmed);
    }

    // 6) ElevenLabs TTS
    console.log('Starting TTS...');
    const ttsStartTime = Date.now();
    
    const textForTTS = replyText.trim();
    const ttsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`;
    const ttsResp = await fetch(ttsUrl, {
      method: "POST",
      headers: { 
        "xi-api-key": ELEVEN_API_KEY, 
        "Content-Type": "application/json", 
        Accept: "audio/mpeg" 
      },
      body: JSON.stringify({
        text: textForTTS,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.4, similarity_boost: 0.8, speed: 1.15 }
      })
    });

    if (!ttsResp.ok) {
      const errTxt = await ttsResp.text().catch(() => "");
      throw new Error(`ElevenLabs TTS failed: ${ttsResp.status} ${errTxt}`);
    }

    const audioBuffer = Buffer.from(await ttsResp.arrayBuffer());
    const audioB64 = audioBuffer.toString("base64");
    
    const ttsDuration = Date.now() - ttsStartTime;
    console.log('TTS completed in', ttsDuration, 'ms');
    console.log('Total pipeline duration:', sttDuration + geminiDuration + ttsDuration, 'ms');

    const response = {
      conversationId,
      transcript,
      replyText,
      audioB64,
      audioMime: "audio/mpeg"
    };

    if (commands.length > 0) {
      // Return array if multiple commands, single value if one command (for backward compatibility)
      response.command = commands.length === 1 ? commands[0] : commands;
    }

    console.log('Response:', {
      hasAudio: !!response.audioB64,
      transcript: response.transcript,
      replyText: response.replyText,
      command: response.command
    });
    console.log('=== End of /process request ===\n');

    return res.json(response);
  } catch (e) {
    console.error("Process error:", e);
    return res.status(500).json({ error: e.message || "Internal error" });
  }
});

const SYSTEM_PROMPT = `Eres un asistente amigable para niños en español. Responde SOLO en JSON.

ARQUITECTURA DE COMANDOS:
- La mayoría de comandos se detectan por palabras clave en el frontend (plátano, astronauta, espacio, desierto, rotar, escalar, saludar, etc.)
- Solo devuelves comandos cuando detectas INTENCIÓN SEMÁNTICA para estos casos especiales:
  * "bodoque" - cuando el usuario menciona a Bodoque del programa 31 Minutos
  * "tulio" - cuando el usuario menciona a Tulio Triviño del programa 31 Minutos
  * "snow" o "invierno" - cuando el usuario quiere un ambiente invernal/navideño

Ejemplos:
User: "quiero un plátano"
{"text": "¡Genial! Te traigo un plátano. ¿Qué quieres hacer con él?"}

User: "trae a bodoque"
{"text": "¡Aquí viene Bodoque! ¿Qué aventura tendremos?", "command": "bodoque"}

User: "quiero ver a tulio triviño"
{"text": "¡Tulio está aquí con las noticias! ¿Qué te gustaría saber?", "command": "tulio"}

User: "quiero nieve y navidad"
{"text": "¡Prepárate para un día de nieve!", "command": "snow"}

User: "hola"
{"text": "¡Hola! ¿Qué quieres crear hoy?"}

REGLAS:
- Responde en español, máximo 2 oraciones cortas
- Sé entusiasta y simple
- Todo lo demás se maneja automáticamente por palabras clave
- Siempre formato JSON válido`;


// /speak: text -> Gemini -> TTS -> return audio
app.post("/speak", async (req, res) => {
  try {
    const { text, sceneContext, conversationId } = req.body || {};
    console.log('=== /speak endpoint called ===');
    console.log('Conversation ID:', conversationId);
    console.log('User text:', text);
    console.log('Scene context:', JSON.stringify(sceneContext, null, 2));
    
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Missing text" });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "Gemini API not configured" });
    }

    if (!ELEVEN_API_KEY || !ELEVEN_VOICE_ID) {
      return res.status(500).json({ error: "ElevenLabs API not configured" });
    }

    let userMessage = text.trim();
    if (sceneContext) {
      const contextInfo = [];
      if (sceneContext.character) {
        contextInfo.push(`Personaje actual: ${sceneContext.character}`);
      }
      if (sceneContext.background) {
        contextInfo.push(`Fondo actual: ${sceneContext.background}`);
      }
      if (sceneContext.objects && sceneContext.objects.length > 0) {
        contextInfo.push(`Objetos en escena: ${sceneContext.objects.join(', ')}`);
      } else {
        contextInfo.push(`Objetos en escena: ninguno`);
      }
      
      userMessage = `[CONTEXTO: ${contextInfo.join(' | ')}]\n\nUsuario dice: ${text.trim()}`;
    }
    
    console.log('Message to Gemini:', userMessage);

    // 1) Get or create chat history for this session
    const chatHistory = getOrCreateChatHistory(conversationId);
    
    // Add user message to history
    chatHistory.push({
      role: "user",
      parts: [{ text: userMessage }]
    });

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const geminiPayload = {
      contents: chatHistory,
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      generationConfig: {
        temperature: 0.8,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 300,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The response text in Spanish - MUST be in Spanish, never English"
            },
            command: {
              type: "string",
              description: "Optional command to execute - ONLY for semantic intent: bodoque, tulio, snow/invierno",
              nullable: true
            }
          },
          required: ["text"]
        }
      }
    };

    const geminiResp = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiPayload)
    });

    if (!geminiResp.ok) {
      const errTxt = await geminiResp.text().catch(() => "");
      throw new Error(`Gemini API failed: ${geminiResp.status} ${errTxt}`);
    }

    const geminiData = await geminiResp.json();
    console.log('Full Gemini response structure:', JSON.stringify(geminiData, null, 2));
    
    if (!geminiData?.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error('ERROR: No valid text in Gemini response!');
      console.error('Gemini data:', JSON.stringify(geminiData, null, 2));
      throw new Error('Gemini did not return a valid response');
    }
    
    let rawReply = geminiData.candidates[0].content.parts[0].text;
    console.log('=== Raw Gemini response text ===');
    console.log(rawReply);
    console.log('=== End raw response ===');

    let replyText = null;
    let command = null;

    try {
      let jsonToParse = rawReply.trim();
      
      if (!jsonToParse.startsWith('{')) {
        const jsonMatch = rawReply.match(/\{[\s\S]*\}/);
        console.log('Searching for JSON in response...');
        if (jsonMatch) {
          jsonToParse = jsonMatch[0];
          console.log('Found JSON:', jsonToParse);
        } else {
          console.warn('No JSON structure found in response, using raw text');
          replyText = rawReply;
          throw new Error('No JSON found');
        }
      }
      
      const parsed = JSON.parse(jsonToParse);
      console.log('Parsed JSON:', JSON.stringify(parsed, null, 2));
      
      if (parsed.text) {
        replyText = parsed.text;
        command = parsed.command || null;
        console.log('Extracted text:', replyText);
        console.log('Extracted command:', command);
      } else {
        console.warn('JSON parsed but no "text" field found, using entire response');
        replyText = rawReply;
      }
    } catch (e) {
      console.log("JSON parsing failed:", e.message);
      if (!replyText) {
        replyText = rawReply;
      }
    }
    
    if (!replyText || replyText.trim().length === 0) {
      console.error('Empty reply text, returning early without TTS');
      const response = {
        replyText: ''
      };
      if (command) {
        response.command = command;
      }
      return res.json(response);
    }

    if (!command) {
      const userTextLower = text.toLowerCase();
      const contextStr = JSON.stringify(sceneContext).toLowerCase();
      
      const objectChecks = [
        { keywords: ['plátano', 'platano', 'banana'], contextNames: ['plátano', 'platano'], command: 'platano' },
        { keywords: ['astronauta', 'astronaut'], contextNames: ['astronauta', 'astronaut'], command: 'astronaut' },
        { keywords: ['bodoque'], contextNames: ['bodoque'], command: 'bodoque' },
        { keywords: ['tulio'], contextNames: ['tulio'], command: 'tulio' }
      ];
      
      for (const check of objectChecks) {
        const userMentioned = check.keywords.some(kw => userTextLower.includes(kw));
        const inScene = check.contextNames.some(name => contextStr.includes(name));
        
        if (userMentioned && !inScene) {
          console.log(`FALLBACK: User mentioned ${check.command}, adding command automatically`);
          command = check.command;
          break;
        }
      }
    }

    // 2) Update chat history with model response (store the text part only)
    chatHistory.push({
      role: "model",
      parts: [{ text: replyText }]
    });

    // Keep history within MAX_TURNS (trim if too long)
    if (chatHistory.length > MAX_TURNS * 2) {
      const trimmed = chatHistory.slice(-MAX_TURNS * 2);
      chatHistory.length = 0;
      chatHistory.push(...trimmed);
    }

    // 3) ElevenLabs TTS with Gemini response (only the text part)
    const textForTTS = replyText.trim();
    
    if (textForTTS.startsWith('{') || textForTTS.includes('"text":')) {
      console.error('WARNING: Attempting to send JSON to TTS instead of text!');
      console.error('Text being sent:', textForTTS);
      throw new Error('Invalid text for TTS - contains JSON structure');
    }
    
    console.log('Sending to TTS:', textForTTS);
    
    const ttsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`;
    const ttsResp = await fetch(ttsUrl, {
      method: "POST",
      headers: { 
        "xi-api-key": ELEVEN_API_KEY, 
        "Content-Type": "application/json", 
        Accept: "audio/mpeg" 
      },
      body: JSON.stringify({
        text: textForTTS,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.4, similarity_boost: 0.8, speed: 1.15 }
      })
    });

    if (!ttsResp.ok) {
      const errTxt = await ttsResp.text().catch(() => "");
      throw new Error(`ElevenLabs TTS failed: ${ttsResp.status} ${errTxt}`);
    }

    const audioBuffer = Buffer.from(await ttsResp.arrayBuffer());
    const audioB64 = audioBuffer.toString("base64");

    const response = {
      audioB64,
      audioMime: "audio/mpeg",
      replyText
    };

    if (command) {
      response.command = command;
    }

    console.log('Response being sent to frontend:', {
      hasAudio: !!response.audioB64,
      replyText: response.replyText,
      command: response.command
    });
    console.log('=== End of /speak request ===\n');

    return res.json(response);
  } catch (e) {
    console.error("Speak error:", e);
    return res.status(500).json({ error: e.message || "Internal error" });
  }
});

// Endpoint to clear chat history for a specific session or all sessions
app.post("/clear-history", (req, res) => {
  try {
    const { conversationId } = req.body || {};
    
    if (conversationId) {
      if (chatHistories.has(conversationId)) {
        chatHistories.delete(conversationId);
        console.log(`Cleared history for session: ${conversationId}`);
        return res.json({ message: "Session history cleared", conversationId });
      } else {
        return res.json({ message: "Session not found", conversationId });
      }
    } else {
      const count = chatHistories.size;
      chatHistories.clear();
      console.log(`Cleared all ${count} chat sessions`);
      return res.json({ message: "All histories cleared", count });
    }
  } catch (e) {
    console.error("Clear history error:", e);
    return res.status(500).json({ error: e.message || "Internal error" });
  }
});

app.get("/*", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
