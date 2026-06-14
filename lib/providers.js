import OpenAI from "openai";

export const SYSTEM_PROMPT =
  "You are a helpful, friendly AI assistant. Answer clearly and concisely. " +
  "Use Markdown for formatting when it helps (code blocks, lists, bold).";

/**
 * Supported chat providers. All of these speak the OpenAI-compatible
 * chat-completions API, so one client works for every one — we just swap the
 * base URL, the API key, and the default model.
 */
// `model` is the best-quality choice; `fastModel` is the quicker, lighter one
// used when the UI's Fast mode is enabled.
export const PROVIDERS = {
  groq: {
    label: "Groq · GPT-OSS 120B",
    baseURL: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    model: "openai/gpt-oss-120b",
    fastModel: "llama-3.1-8b-instant",
  },
  cerebras: {
    label: "Cerebras · GPT-OSS 120B",
    baseURL: "https://api.cerebras.ai/v1",
    keyEnv: "CEREBRAS_API_KEY",
    model: "gpt-oss-120b",
    fastModel: "zai-glm-4.7",
  },
  openrouter: {
    label: "OpenRouter · DeepSeek V3",
    baseURL: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    model: "deepseek/deepseek-chat-v3-0324",
    fastModel: "meta-llama/llama-3.1-8b-instruct",
  },
  mistral: {
    label: "Mistral · Large",
    baseURL: "https://api.mistral.ai/v1",
    keyEnv: "MISTRAL_API_KEY",
    model: "mistral-large-latest",
    fastModel: "mistral-small-latest",
  },
  fireworks: {
    label: "Fireworks · DeepSeek V4 Pro",
    baseURL: "https://api.fireworks.ai/inference/v1",
    keyEnv: "FIREWORKS_API_KEY",
    model: "accounts/fireworks/models/deepseek-v4-pro",
    fastModel: "accounts/fireworks/models/gpt-oss-120b",
  },
  opencode: {
    label: "OpenCode Zen · Nemotron Ultra",
    baseURL: "https://opencode.ai/zen/v1",
    keyEnv: "OPENCODE_API_KEY",
    model: "nemotron-3-ultra-free",
    fastModel: "deepseek-v4-flash-free",
  },
  gemini: {
    label: "Gemini · 3.1 Pro",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    model: "gemini-3.1-pro-preview",
    fastModel: "gemini-3.5-flash",
  },
};

/** Pick the best-quality model, or the fast one when Fast mode is on. */
export function modelFor(name, fast) {
  const p = PROVIDERS[name] || PROVIDERS.groq;
  return fast && p.fastModel ? p.fastModel : p.model;
}

// Feature-specific models. Keys are read from the environment only.
export const WHISPER = { provider: "groq", model: "whisper-large-v3-turbo" };
export const TITLE = { provider: "groq", model: "llama-3.1-8b-instant" };

// Vision routes through a multimodal model regardless of the picked provider.
// Primary on Groq (Llama 4 Scout); falls back to Mistral Pixtral on error.
export const VISION = {
  primary: { provider: "groq", model: "meta-llama/llama-4-scout-17b-16e-instruct" },
  fallback: { provider: "mistral", model: "pixtral-12b-2409" },
};

// Text-to-image via an OpenRouter image-output model (cheap, ~$0.0004/image).
export const IMAGE = { keyEnv: "OPENROUTER_API_KEY", model: "google/gemini-2.5-flash-image" };

// Text-to-speech via ElevenLabs ("read aloud").
export const TTS = {
  keyEnv: "ELEVENLABS_API_KEY",
  voiceEnv: "ELEVENLABS_VOICE_ID",
  defaultVoice: "qVpGLzi5EhjW3WGVhOa9",
  model: "eleven_turbo_v2_5",
  maxChars: 2500,
};

/** Resolve a provider name to an OpenAI client + the model to use. */
export function getClientFor(name, modelOverride) {
  const providerName = PROVIDERS[name] ? name : "groq";
  const provider = PROVIDERS[providerName];
  const apiKey = getKeys(provider.keyEnv)[0] || "";
  const client = new OpenAI({ apiKey: apiKey || "missing", baseURL: provider.baseURL });
  return { client, provider, providerName, apiKey, model: modelOverride || provider.model };
}

/**
 * Collect every key configured for an env name, enabling automatic failover
 * (handy for quota-limited providers like Gemini). Recognises:
 *   NAME           → primary
 *   NAME_2 … NAME_9 → numbered backups
 *   NAMES           → comma-separated list  (e.g. GEMINI_API_KEYS=a,b,c)
 */
export function getKeys(keyEnv) {
  const keys = [];
  if (process.env[keyEnv]) keys.push(process.env[keyEnv].trim());
  for (let i = 2; i <= 9; i++) {
    const v = process.env[`${keyEnv}_${i}`];
    if (v) keys.push(v.trim());
  }
  const list = process.env[`${keyEnv}S`] || process.env[`${keyEnv}_LIST`];
  if (list) list.split(",").map((s) => s.trim()).filter(Boolean).forEach((k) => keys.push(k));
  return [...new Set(keys)];
}

/**
 * Build one OpenAI client per configured key for a provider, so callers can try
 * them in order and fail over (e.g. on 429 quota errors).
 */
export function clientsFor(name, modelOverride) {
  const providerName = PROVIDERS[name] ? name : "groq";
  const provider = PROVIDERS[providerName];
  const model = modelOverride || provider.model;
  const keys = getKeys(provider.keyEnv);
  const usable = keys.length ? keys : [""];
  return usable.map((apiKey) => ({
    client: new OpenAI({ apiKey: apiKey || "missing", baseURL: provider.baseURL }),
    model,
    providerName,
  }));
}

/** A message has an image when its content is an array carrying an image_url part. */
export function hasImage(m) {
  return Array.isArray(m?.content) && m.content.some((p) => p?.type === "image_url");
}

/** Flatten multimodal array content down to its plain text (drops images). */
export function flattenContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n")
      .trim();
  }
  return "";
}
