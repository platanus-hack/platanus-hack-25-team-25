// voice-agent.js

const talkBtn = document.getElementById("talk-btn");
const transcriptDiv = document.getElementById("transcript");
const answerDiv = document.getElementById("assistant-answer");

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let isListening = false;
const audioPlayer = new Audio();

if (!SpeechRecognition) {
  talkBtn.disabled = true;
  talkBtn.textContent = "Browser no soportado 😢";
  transcriptDiv.textContent =
    "Prueba en Chrome/Edge para usar el micrófono.";
} else {
  recognition = new SpeechRecognition();
  recognition.lang = "en-US"; // or "es-ES" if you want Spanish
  recognition.continuous = false;
  recognition.interimResults = true;

  talkBtn.addEventListener("click", () => {
    if (isListening) {
      recognition.stop();
      return;
    }
    transcriptDiv.textContent = "";
    answerDiv.textContent = "";
    isListening = true;
    talkBtn.textContent = "🎧 Listening...";
    recognition.start();
  });

  recognition.onresult = (event) => {
    let text = "";
    for (let i = 0; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
    }
    transcriptDiv.textContent = text;
  };

  recognition.onerror = (event) => {
    console.error("Speech error", event);
    isListening = false;
    talkBtn.textContent = "🎙 Talk to Vibe";
  };

  recognition.onend = async () => {
    isListening = false;
    talkBtn.textContent = "🎙 Talk to Vibe";

    const message = transcriptDiv.textContent.trim();
    if (!message) return;

    // call backend
    answerDiv.textContent = "Thinking...";
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      if (!res.ok) {
        answerDiv.textContent = "Oops, something went wrong.";
        return;
      }

      const data = await res.json();
      answerDiv.textContent = data.answer;

      const audioBlob = base64ToBlob(data.audioBase64, "audio/mpeg");
      const url = URL.createObjectURL(audioBlob);
      audioPlayer.src = url;
      audioPlayer.play();
    } catch (err) {
      console.error(err);
      answerDiv.textContent = "Connection error 😢";
    }
  };
}

// helper to decode base64 → Blob
function base64ToBlob(base64, mime) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mime });
}
