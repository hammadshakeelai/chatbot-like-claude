import OpenAI from "openai";

const SYSTEM_PROMPT =
  "You are a helpful, friendly AI assistant. Answer clearly and concisely. " +
  "Use Markdown for formatting when it helps (code blocks, lists, bold).";

// All of these speak the OpenAI-compatible chat-completions API.
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

// Keys are read from environment variables only — no secrets in source code.
// Set GROQ_API_KEY in Vercel (Project Settings -> Environment Variables) for
// production, and in your local .env for development.
const FALLBACK_KEYS = {};

const providerName = (process.env.PROVIDER || "groq").toLowerCase();
const provider = PROVIDERS[providerName] || PROVIDERS.groq;
const apiKey = process.env[provider.keyEnv] || FALLBACK_KEYS[provider.keyEnv] || "";
const MODEL = process.env.MODEL || provider.model;

const client = new OpenAI({ apiKey: apiKey || "missing", baseURL: provider.baseURL });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
      res.write(`\n\n[Error: ${msg}]`);
      res.end();
    }
  }
}
