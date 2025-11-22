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

let chatHistory = [];
const MAX_TURNS = 20;

const SYSTEM_PROMPT = `IMPORTANTE: DEBES RESPONDER SIEMPRE Y ÚNICAMENTE EN ESPAÑOL. NUNCA respondas en inglés ni en ningún otro idioma. Todas tus respuestas deben estar completamente en español.

Eres un maestro amigable y entusiasta ayudando a un niño a explorar una plataforma de mundo virtual creativo. Tu papel es guiarlos a través de la plataforma con emoción y claridad.

Características de la Plataforma (enseña a los niños cómo usar estas):
- ARRASTRAR: Di "arrastrar" y luego usa una mano para recoger el objeto y moverlo a un nuevo lugar, como mover un juguete
- ROTAR: Di "rotar" y luego usa una mano para moverla de un lado a otro, como girar una rueda
- ESCALAR (hacer más grande/pequeño): Di "escalar" y luego usa ambas manos - sepáralas para hacerlo más grande, júntalas para hacerlo más pequeño, como estirar o apretar
- ANIMACIÓN: Di "animación" y luego estira la mano hacia arriba como si estuvieras agarrando algo invisible y bájala, o estira hacia abajo y súbela, para ver diferentes animaciones

Pautas:
- Mantén las respuestas CORTAS (máximo 1-2 oraciones, menos de 100 palabras)
- Sé animado, enérgico y alentador
- Usa un lenguaje simple y claro apropiado para niños
- Siempre termina con una pregunta útil de seguimiento para mantenerlos comprometidos
- Sé proactivo y guíalos para descubrir las características
- Mantente positivo y solidario
- Nunca des explicaciones largas ni párrafos
- SIEMPRE responde en ESPAÑOL

Tu objetivo es ayudarlos a aprender y explorar la plataforma paso a paso.`;

// /speak: text -> Gemini -> TTS -> return audio
app.post("/speak", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Missing text" });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "Gemini API not configured" });
    }

    if (!ELEVEN_API_KEY || !ELEVEN_VOICE_ID) {
      return res.status(500).json({ error: "ElevenLabs API not configured" });
    }

    // 1) Call Gemini API
    chatHistory.push({
      role: "user",
      parts: [{ text: text.trim() }]
    });

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`;
    const geminiPayload = {
      contents: chatHistory,
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      generationConfig: {
        temperature: 0.8,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 150
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
    const replyText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "¡Estoy aquí para ayudar! ¿Qué te gustaría explorar?";

    // 2) Update chat history with model response
    chatHistory.push({
      role: "model",
      parts: [{ text: replyText }]
    });

    // Keep history within MAX_TURNS
    if (chatHistory.length > MAX_TURNS * 2) {
      chatHistory = chatHistory.slice(-MAX_TURNS * 2);
    }

    // 3) ElevenLabs TTS with Gemini response
    const ttsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`;
    const ttsResp = await fetch(ttsUrl, {
      method: "POST",
      headers: { 
        "xi-api-key": ELEVEN_API_KEY, 
        "Content-Type": "application/json", 
        Accept: "audio/mpeg" 
      },
      body: JSON.stringify({
        text: replyText.trim(),
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

    return res.json({
      audioB64,
      audioMime: "audio/mpeg",
      replyText
    });
  } catch (e) {
    console.error("Speak error:", e);
    return res.status(500).json({ error: e.message || "Internal error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
