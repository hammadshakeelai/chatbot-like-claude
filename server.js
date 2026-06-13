import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const SYSTEM_PROMPT =
  "You are a helpful, friendly AI assistant. Answer clearly and concisely. " +
  "Use Markdown for formatting when it helps (code blocks, lists, bold).";

/**
 * Supported providers. All of these speak the OpenAI-compatible
 * chat-completions API, so the same client works for every one — we just
 * change the base URL, the API key, and the default model.
 *
 * Pick one with PROVIDER=<name> in your .env file. Override the model with
 * MODEL=<id> if you want a different one.
 */
const PROVIDERS = {
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    model: "llama-3.3-70b-versatile",
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    model: "meta-llama/llama-3.3-70b-instruct",
  },
  cerebras: {
    baseURL: "https://api.cerebras.ai/v1",
    keyEnv: "CEREBRAS_API_KEY",
    model: "gpt-oss-120b",
  },
  mistral: {
    baseURL: "https://api.mistral.ai/v1",
    keyEnv: "MISTRAL_API_KEY",
    model: "mistral-small-latest",
  },
  fireworks: {
    baseURL: "https://api.fireworks.ai/inference/v1",
    keyEnv: "FIREWORKS_API_KEY",
    model: "accounts/fireworks/models/llama-v3p3-70b-instruct",
  },
};

const providerName = (process.env.PROVIDER || "groq").toLowerCase();
const provider = PROVIDERS[providerName];

if (!provider) {
  console.error(
    `\n✖ Unknown PROVIDER "${providerName}". Valid options: ${Object.keys(
      PROVIDERS
    ).join(", ")}\n`
  );
  process.exit(1);
}

const apiKey = process.env[provider.keyEnv];
const MODEL = process.env.MODEL || provider.model;

if (!apiKey) {
  console.warn(
    `\n⚠  ${provider.keyEnv} is not set. Add it to your .env file,\n` +
      `   otherwise chat requests to "${providerName}" will fail.\n`
  );
}

const client = new OpenAI({ apiKey: apiKey || "missing", baseURL: provider.baseURL });

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

/**
 * Streaming chat endpoint.
 * Expects: { messages: [{ role: "user" | "assistant", content: string }, ...] }
 * Streams the assistant's reply back as plain UTF-8 text chunks.
 */
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body || {};

  // --- light validation ---
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "`messages` must be a non-empty array." });
  }
  const clean = messages
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim() !== ""
    )
    .map((m) => ({ role: m.role, content: m.content }));

  if (clean.length === 0 || clean[0].role !== "user") {
    return res
      .status(400)
      .json({ error: "Conversation must start with a user message." });
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering if present
  res.flushHeaders?.();

  try {
    const stream = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 4096,
      stream: true,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...clean],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) res.write(delta);
    }
    res.end();
  } catch (err) {
    const msg = err?.error?.message || err?.message || "Unknown error";
    console.error("Chat error:", msg);
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    } else {
      // Stream already started — surface the error inline, then end.
      res.write(`\n\n[Error: ${msg}]`);
      res.end();
    }
  }
});

app.listen(PORT, () => {
  console.log(`\n  Provider: ${providerName}  |  Model: ${MODEL}`);
  console.log(`  Chatbot running ->  http://localhost:${PORT}\n`);
});
