// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// If Node < 18, uncomment:
// import fetch from "node-fetch";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY;
const ELEVEN_VOICE_ID = process.env.ELEVEN_VOICE_ID;

// JSON body parsing
app.use(express.json());
// Serve the 3D demo files
app.use(express.static("public"));
app.use(cors());

/**
 * POST /api/ask
 * body: { message: string }
 * returns: { answer: string, audioBase64: string }
 */
app.post("/api/ask", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    // 1) Call Gemini (kid-friendly teacher prompt)
    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `
You are a friendly teacher talking to a kid. Explain this in a simple, fun way, max 3 short sentences:

"${message}"
                  `.trim(),
                },
              ],
            },
          ],
        }),
      }
    );

    const geminiJson = await geminiResponse.json();

    const answer =
      geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "Hmm, I don’t know how to explain that yet, but we can explore together!";

    // 2) Call ElevenLabs TTS to turn answer into speech
    const ttsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVEN_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: answer,
          model_id: "eleven_multilingual_v2",
        }),
      }
    );

    if (!ttsResponse.ok) {
      const errText = await ttsResponse.text();
      console.error("ElevenLabs error:", errText);
      return res.status(500).json({ error: "TTS failed" });
    }

    const audioArrayBuffer = await ttsResponse.arrayBuffer();
    const audioBase64 = Buffer.from(audioArrayBuffer).toString("base64");

    return res.json({ answer, audioBase64 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Vibe Imagine running at http://localhost:${PORT}`);
});
