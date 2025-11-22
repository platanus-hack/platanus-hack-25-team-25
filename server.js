import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY || process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE_ID = process.env.ELEVEN_VOICE_ID || process.env.ELEVENLABS_VOICE_ID;

app.use(express.json());
app.use(express.static("public"));
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

const SYSTEM_PROMPT = `CRITICAL INSTRUCTION - JSON FORMAT REQUIRED:
You MUST respond ONLY with valid JSON. Never respond with plain text.
Every response must use this exact format:
{"text": "your response in spanish", "command": "command_if_needed"}

If no command is needed, omit the command field:
{"text": "your response in spanish"}

EXAMPLES:
User: "dragón" or "quiero un dragón"
Response: {"text": "¡Genial! Te traigo un dragón. ¿Quieres aprender a moverlo?", "command": "dragon"}

User: "mono" or "quiero un mono"
Response: {"text": "¡Un mono! Aquí está. ¿Qué va a hacer?", "command": "monkey"}

User: "plátano" or "pon un plátano"
Response: {"text": "¡Un plátano delicioso! ¿Para quién es?", "command": "platano"}

User: "astronauta"
Response: {"text": "¡Un astronauta espacial! ¿Listo para explorar?", "command": "astronaut"}

User: "hola"
Response: {"text": "¡Hola! ¿Qué quieres crear hoy?"}

User: "¿qué puedo hacer?"
Response: {"text": "¡Puedes agregar un dragón, mono, plátano o astronauta! ¿Cuál quieres?"}

---

ROLE: Eres un maestro amigable y entusiasta ayudando a un niño a explorar una plataforma de mundo virtual creativo.

PLATFORM FEATURES:
- ARRASTRAR: Di "arrastrar" para mover objetos con una mano
- ROTAR: Di "rotar" para girar objetos con una mano
- ESCALAR: Di "escalar" para hacer más grande o pequeño con ambas manos
- ANIMACIÓN: Di "animación" para ver animaciones

AVAILABLE OBJECTS:
- DRAGÓN: When user mentions "dragón" or "dragon", include "command": "dragon"
- MONO: When user mentions "mono" or "monkey", include "command": "monkey"  
- PLÁTANO: When user mentions "plátano" or "platano" or "banana", include "command": "platano"
- ASTRONAUTA: When user mentions "astronauta" or "astronaut", include "command": "astronaut"

GUIDELINES:
- Keep responses SHORT (max 1-2 sentences, under 100 words)
- Be energetic and encouraging
- Use simple language for kids
- ALWAYS respond in SPANISH (inside the JSON "text" field)
- DO NOT repeat context info unless asked
- If user asks for unavailable items, suggest the dragon
- End with engaging follow-up question

REMEMBER: EVERY response must be valid JSON with "text" field in Spanish, and optionally "command" field.`;


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

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    const geminiPayload = {
      contents: chatHistory,
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      generationConfig: {
        temperature: 0.8,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 150,
        responseMimeType: "application/json"
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
      console.error('Empty reply text, using fallback');
      replyText = '¡Estoy aquí para ayudar! ¿Qué te gustaría explorar?';
    }

    if (!command) {
      const userTextLower = text.toLowerCase();
      const contextStr = JSON.stringify(sceneContext).toLowerCase();
      
      const objectChecks = [
        { keywords: ['dragón', 'dragon'], contextNames: ['dragón', 'dragon'], command: 'dragon' },
        { keywords: ['mono', 'monkey'], contextNames: ['mono', 'monkey'], command: 'monkey' },
        { keywords: ['plátano', 'platano', 'banana'], contextNames: ['plátano', 'platano'], command: 'platano' },
        { keywords: ['astronauta', 'astronaut'], contextNames: ['astronauta', 'astronaut'], command: 'astronaut' }
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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
