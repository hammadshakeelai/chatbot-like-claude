import { toFile } from "openai";
import {
  PROVIDERS,
  SYSTEM_PROMPT,
  WHISPER,
  TITLE,
  VISION,
  IMAGE,
  TTS,
  getClientFor,
  clientsFor,
  modelFor,
  getKeys,
  hasImage,
  flattenContent,
} from "./providers.js";

/** Strip Markdown to plain prose so speech doesn't read out symbols. */
function stripMarkdown(s) {
  return String(s)
    .replace(/```[\s\S]*?```/g, " (code block) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__|\*|_|>|#)/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Emotion-aware delivery: each tone maps to ElevenLabs voice settings.
 * Lower stability + higher style = more expressive; higher stability = calmer.
 */
const EMOTION_PROFILES = {
  excited: { stability: 0.25, similarity_boost: 0.75, style: 0.85, use_speaker_boost: true },
  cheerful: { stability: 0.35, similarity_boost: 0.75, style: 0.65, use_speaker_boost: true },
  empathetic: { stability: 0.55, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
  sad: { stability: 0.68, similarity_boost: 0.8, style: 0.12, use_speaker_boost: false },
  serious: { stability: 0.72, similarity_boost: 0.75, style: 0.1, use_speaker_boost: false },
  calm: { stability: 0.6, similarity_boost: 0.75, style: 0.22, use_speaker_boost: true },
  neutral: { stability: 0.5, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true },
};

/** Cheap, dependency-free tone guess used as a fallback. */
function heuristicEmotion(text) {
  const t = text.toLowerCase();
  const bangs = (text.match(/!/g) || []).length;
  if (/(sorry|unfortunately|apolog|i'?m afraid|sadly|condolence|grief)/.test(t)) return "empathetic";
  if (/(congratulat|amazing|awesome|fantastic|wonderful|exciting|woohoo|let'?s go|🎉|🥳)/.test(t) || bangs >= 3)
    return "excited";
  if (/(warning|danger|critical|caution|important|careful|security|risk)/.test(t)) return "serious";
  if (bangs >= 1 || /(glad|happy|great|nice|love)/.test(t)) return "cheerful";
  return "neutral";
}

/** Classify the emotional tone with a fast model, falling back to heuristics. */
async function detectEmotion(text) {
  try {
    const { client, model } = getClientFor(TITLE.provider, TITLE.model);
    const out = await client.chat.completions.create({
      model,
      max_tokens: 3,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You label the emotional tone for a voice narrator. Reply with ONE word only " +
            "from this set: excited, cheerful, empathetic, sad, serious, calm, neutral.",
        },
        { role: "user", content: text.slice(0, 1200) },
      ],
    });
    const label = (out.choices?.[0]?.message?.content || "").toLowerCase().replace(/[^a-z]/g, "");
    if (EMOTION_PROFILES[label]) return label;
  } catch {
    /* fall through to heuristic */
  }
  return heuristicEmotion(text);
}

/**
 * Streaming chat. Accepts:
 *   { messages: [{ role, content }], provider?, model? }
 * `content` is normally a string; for vision it may be an OpenAI-style array
 * of parts ({type:"text"} / {type:"image_url"}). When any message carries an
 * image we transparently route to a multimodal model.
 */
export async function chatHandler(req, res) {
  const { messages, provider: pickedProvider, fast } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "`messages` must be a non-empty array." });
  }

  const useVision = messages.some(hasImage);

  // Keep only user/assistant turns with non-empty content (string or parts).
  const clean = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => {
      if (useVision) return { role: m.role, content: m.content };
      return { role: m.role, content: flattenContent(m.content) };
    })
    .filter((m) => (typeof m.content === "string" ? m.content.trim() !== "" : Array.isArray(m.content)));

  if (clean.length === 0 || clean[0].role !== "user") {
    return res.status(400).json({ error: "Conversation must start with a user message." });
  }

  const payload = {
    max_tokens: 4096,
    stream: true,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...clean],
  };

  // Each attempt is a ready client + model. Vision routes through multimodal
  // models; everything else through the picked provider. clientsFor() expands
  // into one attempt per configured API key, so quota errors (e.g. Gemini 429)
  // automatically fail over to the next key — and if every key for the picked
  // provider fails, we shift to a reliable fallback provider (Groq).
  const FALLBACK_PROVIDER = "groq";
  const attempts = useVision
    ? [
        ...clientsFor(VISION.primary.provider, VISION.primary.model),
        ...clientsFor(VISION.fallback.provider, VISION.fallback.model),
      ]
    : [
        ...clientsFor(pickedProvider, modelFor(pickedProvider || FALLBACK_PROVIDER, fast)),
        ...(pickedProvider && pickedProvider !== FALLBACK_PROVIDER
          ? clientsFor(FALLBACK_PROVIDER, modelFor(FALLBACK_PROVIDER, fast))
          : []),
      ];

  // Acquire a stream before committing response headers, so a total failure can
  // still return a clean JSON error instead of a half-written body.
  let stream;
  let lastErr;
  let served;
  for (const a of attempts) {
    try {
      stream = await a.client.chat.completions.create({ ...payload, model: a.model });
      served = a.providerName;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!stream) {
    let msg = lastErr?.error?.message || lastErr?.message || "All providers failed";
    if (lastErr?.status === 429 || /\b429\b|quota|rate.?limit/i.test(msg)) {
      msg =
        "All keys for this model are rate-limited right now (quota exceeded). " +
        "Try another model, or add more keys.";
    }
    console.error("Chat error:", msg);
    return res.status(502).json({ error: msg });
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  if (served) res.setHeader("X-Provider", served);
  res.flushHeaders?.();

  try {
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) res.write(delta);
    }
    res.end();
  } catch (err) {
    const msg = err?.error?.message || err?.message || "Stream interrupted";
    console.error("Chat stream error:", msg);
    res.write(`\n\n[Error: ${msg}]`);
    res.end();
  }
}

/**
 * Speech-to-text via Groq Whisper. Accepts:
 *   { audio: "<base64>", mime?: "audio/webm" }
 * Returns { text }.
 */
export async function transcribeHandler(req, res) {
  try {
    const { audio, mime } = req.body || {};
    if (!audio || typeof audio !== "string") {
      return res.status(400).json({ error: "`audio` (base64) is required." });
    }

    const buffer = Buffer.from(audio, "base64");
    const ext = (mime || "audio/webm").includes("mp4") ? "mp4" : "webm";
    const { client } = getClientFor(WHISPER.provider);

    const result = await client.audio.transcriptions.create({
      file: await toFile(buffer, `audio.${ext}`, { type: mime || "audio/webm" }),
      model: WHISPER.model,
      response_format: "text",
    });

    const text = typeof result === "string" ? result : result?.text || "";
    return res.status(200).json({ text: text.trim() });
  } catch (err) {
    const msg = err?.error?.message || err?.message || "Transcription failed";
    console.error("Transcribe error:", msg);
    return res.status(500).json({ error: msg });
  }
}

/**
 * Short conversation title from the first exchange. Accepts:
 *   { messages: [{ role, content }] }  → returns { title }.
 */
export async function titleHandler(req, res) {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "`messages` required." });
    }

    const transcript = messages
      .slice(0, 4)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${flattenContent(m.content)}`)
      .join("\n")
      .slice(0, 2000);

    const { client, model } = getClientFor(TITLE.provider, TITLE.model);
    const out = await client.chat.completions.create({
      model,
      max_tokens: 20,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You write very short chat titles. Reply with ONLY a 3-6 word title " +
            "summarising the conversation. No quotes, no punctuation at the end.",
        },
        { role: "user", content: transcript },
      ],
    });

    let title = (out.choices?.[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "");
    title = title.replace(/[.\s]+$/, "").slice(0, 60);
    return res.status(200).json({ title: title || "New chat" });
  } catch (err) {
    console.error("Title error:", err?.message || err);
    return res.status(200).json({ title: "" }); // non-critical: let the client keep its fallback
  }
}

/** Generate an image via OpenRouter, failing over across every OpenRouter key. */
async function imageViaOpenRouter(prompt) {
  const keys = getKeys(IMAGE.keyEnv);
  if (!keys.length) return { url: null, err: "OpenRouter key not set" };
  let err = "error";
  for (const apiKey of keys) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: IMAGE.model,
          modalities: ["image", "text"],
          // Small cap keeps the upfront credit hold tiny (image needs ~1.3k tokens).
          max_tokens: 1536,
          messages: [{ role: "user", content: `Generate an image: ${prompt}` }],
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.error) {
        err = data.error?.message || `error ${r.status}`;
        continue;
      }
      const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url || "";
      if (url) return { url };
      err = "no image returned";
    } catch (e) {
      err = e?.message || "request failed";
    }
  }
  return { url: null, err };
}

/** Generate an image via Gemini's native API, failing over across all keys. */
async function imageViaGemini(prompt) {
  const keys = getKeys("GEMINI_API_KEY");
  const model = "gemini-2.5-flash-image";
  let err = "no Gemini keys";
  for (const key of keys) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ["IMAGE"] },
          }),
        }
      );
      if (!r.ok) {
        err = `error ${r.status}`;
        continue;
      }
      const j = await r.json();
      const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
      if (part) return { url: `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}` };
    } catch (e) {
      err = e?.message || "request failed";
    }
  }
  return { url: null, err };
}

/** Submit a job to AI Horde (free, keyless). Returns { id } or { err }. */
async function hordeSubmit(prompt) {
  try {
    const r = await fetch("https://aihorde.net/api/v2/generate/async", {
      method: "POST",
      headers: { apikey: "0000000000", "Content-Type": "application/json", "Client-Agent": "chatbot-like-claude:1.0:github" },
      body: JSON.stringify({
        prompt,
        params: { width: 512, height: 512, steps: 20, n: 1, sampler_name: "k_euler_a" },
        models: ["stable_diffusion"],
      }),
    });
    const j = await r.json().catch(() => ({}));
    return j.id ? { id: j.id } : { err: j.message || `horde submit failed (${r.status})` };
  } catch (e) {
    return { err: e?.message || "horde submit failed" };
  }
}

/** Poll one AI Horde job. Returns { done, dataUrl? } / { done:false, queue,wait } / { error }. */
async function hordeStatus(id) {
  try {
    const r = await fetch(`https://aihorde.net/api/v2/generate/status/${id}`);
    const j = await r.json().catch(() => ({}));
    if (j.faulted) return { done: false, error: "generation faulted" };
    if (!j.done) return { done: false, wait: j.wait_time, queue: j.queue_position };
    const img = j.generations?.[0]?.img;
    if (!img) return { done: false, error: "no image returned" };
    try {
      const ir = await fetch(img);
      const buf = Buffer.from(await ir.arrayBuffer());
      const mime = ir.headers.get("content-type") || "image/webp";
      return { done: true, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
    } catch {
      return { done: true, dataUrl: img };
    }
  } catch (e) {
    return { done: false, error: e?.message || "status check failed" };
  }
}

/**
 * Text-to-image with a 3-tier fallback so it keeps working even when funded
 * paths are exhausted:
 *   1) OpenRouter image model (fast, needs credit)
 *   2) Gemini native image, failing over across every key (fast, quota-limited)
 *   3) AI Horde — free & keyless (slow queue → returned as a pending job the
 *      client polls via /api/image-status, so it never blocks past the limit)
 * Accepts { prompt } → returns { dataUrl, source } or { pending, id, source }.
 */
export async function imageHandler(req, res) {
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
      return res.status(400).json({ error: "`prompt` is required." });
    }
    const clean = prompt.trim();

    const a = await imageViaOpenRouter(clean);
    if (a.url) return res.status(200).json({ dataUrl: a.url, source: "openrouter" });

    const b = await imageViaGemini(clean);
    if (b.url) return res.status(200).json({ dataUrl: b.url, source: "gemini" });

    const h = await hordeSubmit(clean);
    if (h.id) return res.status(200).json({ pending: true, id: h.id, source: "aihorde" });

    console.error("Image error:", a.err, "|", b.err, "|", h.err);
    return res.status(502).json({
      error: "Every image provider is busy right now. Please try again in a moment.",
    });
  } catch (err) {
    const msg = err?.message || "Image generation failed";
    console.error("Image error:", msg);
    return res.status(500).json({ error: msg });
  }
}

/** Poll endpoint for a pending AI Horde image job: GET /api/image-status?id=… */
export async function imageStatusHandler(req, res) {
  const id = req.query?.id || req.body?.id;
  if (!id) return res.status(400).json({ error: "`id` is required." });
  const s = await hordeStatus(String(id));
  return res.status(200).json(s);
}

/**
 * Text-to-speech via ElevenLabs ("read aloud"). Accepts:
 *   { text: string }  → streams back audio/mpeg bytes.
 */
export async function ttsHandler(req, res) {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string" || text.trim() === "") {
      return res.status(400).json({ error: "`text` is required." });
    }

    const apiKey = process.env[TTS.keyEnv] || "";
    if (!apiKey) return res.status(500).json({ error: "Read-aloud is not configured." });

    const voice = process.env[TTS.voiceEnv] || TTS.defaultVoice;
    const clean = stripMarkdown(text).slice(0, TTS.maxChars);

    // Match the delivery to the emotional tone of the text.
    const emotion = await detectEmotion(clean);
    const voice_settings = EMOTION_PROFILES[emotion] || EMOTION_PROFILES.neutral;

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: clean, model_id: TTS.model, voice_settings }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      let msg = `Speech provider error (${r.status})`;
      try {
        msg = JSON.parse(detail)?.detail?.message || JSON.parse(detail)?.detail || msg;
      } catch {}
      return res.status(502).json({ error: String(msg).slice(0, 200) });
    }

    const buffer = Buffer.from(await r.arrayBuffer());
    res.statusCode = 200;
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Emotion", emotion);
    res.end(buffer);
  } catch (err) {
    const msg = err?.message || "Read-aloud failed";
    console.error("TTS error:", msg);
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
}

export { PROVIDERS };
