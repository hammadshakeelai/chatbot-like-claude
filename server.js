import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  chatHandler,
  transcribeHandler,
  titleHandler,
  imageHandler,
  imageStatusHandler,
  ttsHandler,
} from "./lib/handlers.js";
import { PROVIDERS } from "./lib/providers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Never let a stray async error take the dev server down.
process.on("unhandledRejection", (e) => console.error("Unhandled rejection:", e?.message || e));
process.on("uncaughtException", (e) => console.error("Uncaught exception:", e?.message || e));

const providerName = (process.env.PROVIDER || "groq").toLowerCase();
if (!PROVIDERS[providerName]) {
  console.warn(
    `\n⚠  Unknown PROVIDER "${providerName}". The UI can still switch providers; ` +
      `valid options: ${Object.keys(PROVIDERS).join(", ")}\n`
  );
}

const app = express();
// Generous limit: image data URLs and base64 audio travel in the JSON body.
app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/chat", chatHandler);
app.post("/api/transcribe", transcribeHandler);
app.post("/api/title", titleHandler);
app.post("/api/image", imageHandler);
app.get("/api/image-status", imageStatusHandler);
app.post("/api/speak", ttsHandler);

// JSON error backstop so a thrown route error never crashes the response.
app.use((err, _req, res, _next) => {
  console.error("Server error:", err?.message || err);
  if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  const p = PROVIDERS[providerName] || PROVIDERS.groq;
  console.log(`\n  Default provider: ${providerName}  |  Model: ${p.model}`);
  console.log(`  Features: chat · voice (Whisper) · vision · image-gen · read-aloud · auto-titles`);
  console.log(`  Providers: ${Object.keys(PROVIDERS).join(", ")}`);
  console.log(`  Chatbot running ->  http://localhost:${PORT}\n`);
});
