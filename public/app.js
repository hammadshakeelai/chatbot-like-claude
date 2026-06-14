// ---------- Config ----------
const STORAGE_KEY = "chatbot.conversations";
const PROVIDER_KEY = "chatbot.provider";

// Mirrors lib/providers.js (labels only — keys live server-side).
const PROVIDERS = [
  { id: "groq", label: "Groq · GPT-OSS 120B" },
  { id: "cerebras", label: "Cerebras · GPT-OSS 120B" },
  { id: "openrouter", label: "OpenRouter · DeepSeek V3" },
  { id: "mistral", label: "Mistral · Large" },
  { id: "fireworks", label: "Fireworks · DeepSeek V4 Pro" },
  { id: "opencode", label: "OpenCode Zen · Nemotron Ultra" },
  { id: "gemini", label: "Gemini · 3.1 Pro" },
];

// ---------- Icons ----------
const ICON = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19.5 5a9 9 0 0 1 0 14"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  regen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
};

// ---------- State ----------
let conversations = loadConversations();
let activeId = null;
let isStreaming = false;
let abortController = null;
let provider = localStorage.getItem(PROVIDER_KEY) || "groq";
let fastMode = localStorage.getItem("chatbot.fast") === "1";
let attachedImage = null;
let mediaRecorder = null;
let isRecording = false;
let player = { audio: null, btn: null, url: null };

// ---------- DOM ----------
const els = {
  sidebar: document.getElementById("sidebar"),
  list: document.getElementById("conversationList"),
  newChat: document.getElementById("newChatBtn"),
  toggle: document.getElementById("toggleSidebar"),
  title: document.getElementById("chatTitle"),
  messages: document.getElementById("messages"),
  empty: document.getElementById("emptyState"),
  examples: document.getElementById("examples"),
  form: document.getElementById("composer"),
  input: document.getElementById("input"),
  send: document.getElementById("sendBtn"),
  providerSelect: document.getElementById("providerSelect"),
  fastBtn: document.getElementById("fastBtn"),
  attachBtn: document.getElementById("attachBtn"),
  micBtn: document.getElementById("micBtn"),
  fileInput: document.getElementById("fileInput"),
  attachment: document.getElementById("attachment"),
  attachmentThumb: document.getElementById("attachmentThumb"),
  removeAttachment: document.getElementById("removeAttachment"),
  hint: document.getElementById("composerHint"),
  toastWrap: document.getElementById("toastWrap"),
};
const DEFAULT_HINT = els.hint.innerHTML;

// ---------- Storage ----------
function loadConversations() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}
function saveConversations() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    toast("Storage is full — older images may not be saved.", "error");
  }
}
function getActive() {
  return conversations.find((c) => c.id === activeId) || null;
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- Conversations ----------
function newConversation() {
  stopAudio();
  activeId = null;
  clearAttachment();
  els.title.textContent = "New chat";
  renderSidebar();
  renderMessages();
  els.input.focus();
}
function selectConversation(id) {
  stopAudio();
  activeId = id;
  const conv = getActive();
  els.title.textContent = conv ? conv.title : "New chat";
  renderSidebar();
  renderMessages();
}
function deleteConversation(id, e) {
  e.stopPropagation();
  conversations = conversations.filter((c) => c.id !== id);
  saveConversations();
  if (activeId === id) newConversation();
  else renderSidebar();
}
function ensureConversation(seedTitle) {
  let conv = getActive();
  if (!conv) {
    const t = (seedTitle || "New chat").replace(/^\/image\s*/i, "");
    conv = {
      id: uid(),
      title: t.slice(0, 40) + (t.length > 40 ? "…" : ""),
      messages: [],
      titled: false,
      updatedAt: Date.now(),
    };
    conversations.unshift(conv);
    activeId = conv.id;
    els.title.textContent = conv.title;
  }
  return conv;
}

// ---------- Sidebar ----------
function renderSidebar() {
  els.list.innerHTML = "";
  conversations.forEach((conv) => {
    const item = document.createElement("div");
    item.className = "conv-item" + (conv.id === activeId ? " active" : "");
    item.onclick = () => selectConversation(conv.id);

    const title = document.createElement("span");
    title.className = "conv-title";
    title.textContent = conv.title;

    const del = document.createElement("button");
    del.className = "conv-delete";
    del.textContent = "Delete";
    del.title = "Delete conversation";
    del.onclick = (e) => deleteConversation(conv.id, e);

    item.append(title, del);
    els.list.appendChild(item);
  });
}

// ---------- Messages ----------
function renderMessages() {
  const conv = getActive();
  els.messages.innerHTML = "";

  if (!conv || conv.messages.length === 0) {
    els.messages.appendChild(els.empty);
    els.empty.style.display = "";
    return;
  }
  els.empty.style.display = "none";

  let lastAssistant = -1;
  conv.messages.forEach((m, i) => {
    if (m.role === "assistant" && (m.content || "").trim()) lastAssistant = i;
  });

  conv.messages.forEach((m, i) => addMessageEl(m, i === lastAssistant));
  scrollToBottom();
}

function addMessageEl(m, isLastAssistant) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${m.role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = m.role === "user" ? "You" : "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (m.image) {
    const img = document.createElement("img");
    img.className = "msg-image";
    img.src = m.image;
    img.alt = m.role === "assistant" ? "generated image" : "attached image";
    img.loading = "lazy";
    bubble.appendChild(img);
  }

  const body = document.createElement("div");
  body.className = "md";
  if (m.role === "assistant") {
    body.innerHTML = m.content ? renderMarkdown(m.content) : "";
    enhanceCodeBlocks(body);
  } else {
    body.textContent = m.content || "";
  }
  bubble.appendChild(body);

  if (m.role === "assistant" && (m.content || "").trim()) {
    bubble.appendChild(buildActions(m, isLastAssistant));
  }

  wrap.append(avatar, bubble);
  els.messages.appendChild(wrap);
  return body;
}

function createLiveAssistant() {
  const wrap = document.createElement("div");
  wrap.className = "msg assistant";
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = "AI";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const body = document.createElement("div");
  body.className = "md";
  body.innerHTML = '<span class="cursor"></span>';
  bubble.appendChild(body);
  wrap.append(avatar, bubble);
  els.messages.appendChild(wrap);
  scrollToBottom();
  return body;
}

function buildActions(m, isLastAssistant) {
  const bar = document.createElement("div");
  bar.className = "actions";

  bar.appendChild(
    actionButton(ICON.copy, "Copy", () => {
      copyText(m.content)
        .then(() => toast("Copied to clipboard", "success"))
        .catch(() => toast("Copy failed", "error"));
    })
  );

  bar.appendChild(
    actionButton(ICON.speaker, "Read aloud", (btn) => readAloud(m.content, btn))
  );

  if (isLastAssistant) {
    bar.appendChild(actionButton(ICON.regen, "Regenerate", () => regenerate()));
  }
  return bar;
}

function actionButton(svg, label, onClick) {
  const b = document.createElement("button");
  b.className = "action-btn";
  b.type = "button";
  b.innerHTML = svg + `<span class="label">${label}</span>`;
  b.onclick = () => onClick(b);
  return b;
}
function setActionLabel(btn, text) {
  const span = btn.querySelector(".label");
  if (span) span.textContent = text;
}

// Copy that works even without the async Clipboard API (insecure contexts).
function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

// Add a header + copy button to each code block.
function enhanceCodeBlocks(container) {
  container.querySelectorAll("pre").forEach((pre) => {
    if (pre.parentElement && pre.parentElement.classList.contains("code-wrap")) return;
    const code = pre.querySelector("code");
    const lang = (code && code.getAttribute("data-lang")) || "";

    const wrap = document.createElement("div");
    wrap.className = "code-wrap";
    const head = document.createElement("div");
    head.className = "code-head";
    const langSpan = document.createElement("span");
    langSpan.textContent = lang || "code";
    const copy = document.createElement("button");
    copy.className = "code-copy";
    copy.innerHTML = ICON.copy + "<span>Copy</span>";
    copy.onclick = () => {
      copyText(code ? code.textContent : "").then(() => {
        const s = copy.querySelector("span");
        s.textContent = "Copied";
        setTimeout(() => (s.textContent = "Copy"), 1500);
      });
    };
    head.append(langSpan, copy);

    pre.parentNode.insertBefore(wrap, pre);
    wrap.append(head, pre);
  });
}

// ---------- API shaping ----------
function toApiMessages(messages) {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const text = m.content || "";
      if (m.role === "user" && m.image) {
        const parts = [];
        if (text.trim()) parts.push({ type: "text", text });
        parts.push({ type: "image_url", image_url: { url: m.image } });
        return { role: m.role, content: parts };
      }
      return { role: m.role, content: text };
    });
}

// ---------- Sending / streaming ----------
async function sendMessage(text) {
  if (isStreaming) return;

  if (/^\/image\b/i.test(text)) {
    const prompt = text.replace(/^\/image\b\s*/i, "").trim();
    if (!prompt) return flashHint("Add a prompt after /image, e.g. /image a red bicycle", true);
    return generateImage(prompt, text);
  }

  const image = attachedImage;
  clearAttachment();

  const conv = ensureConversation(text || "Image question");
  conv.messages.push({ role: "user", content: text, image: image || undefined });
  conv.updatedAt = Date.now();
  saveConversations();
  renderSidebar();
  renderMessages();

  await streamReply(conv);
}

async function streamReply(conv) {
  els.empty.style.display = "none";
  const body = createLiveAssistant();
  setStreaming(true);
  abortController = new AbortController();
  let answer = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, fast: fastMode, messages: toApiMessages(conv.messages) }),
      signal: abortController.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${res.status})`);
    }
    const served = res.headers.get("X-Provider");
    if (served && served !== provider) {
      const label = (PROVIDERS.find((p) => p.id === served) || {}).label || served;
      toast(`Switched to ${label.split(" · ")[0]} — your pick was unavailable`, "info");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      answer += decoder.decode(value, { stream: true });
      body.innerHTML = renderMarkdown(answer) + '<span class="cursor"></span>';
      scrollToBottom();
    }
  } catch (err) {
    if (err.name === "AbortError") {
      if (!answer.trim()) answer = "_(stopped)_";
    } else {
      answer = (answer || "") + `\n\n**Error:** ${err.message}`;
      toast(err.message, "error");
    }
  } finally {
    abortController = null;
    conv.messages.push({ role: "assistant", content: answer });
    conv.updatedAt = Date.now();
    saveConversations();
    setStreaming(false);
    renderMessages();
    maybeAutoTitle(conv);
  }
}

function stopStreaming() {
  if (abortController) abortController.abort();
}

async function generateImage(prompt, rawText) {
  const conv = ensureConversation(prompt);
  conv.messages.push({ role: "user", content: rawText });
  conv.updatedAt = Date.now();
  saveConversations();
  renderSidebar();
  renderMessages();

  const body = createLiveAssistant();
  body.innerHTML = '🎨 <em>Generating image… (can take up to a minute)</em> <span class="cursor"></span>';
  setStreaming(true);

  try {
    const res = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

    let dataUrl = data.dataUrl;
    // Free queue (AI Horde) returns a pending job we poll without blocking.
    if (!dataUrl && data.pending && data.id) {
      dataUrl = await pollImageJob(data.id, body);
    }
    if (!dataUrl) throw new Error("No image was produced");
    conv.messages.push({ role: "assistant", content: "", image: dataUrl });
  } catch (err) {
    conv.messages.push({ role: "assistant", content: `**Couldn't generate image:** ${err.message}` });
    toast(`Image: ${err.message}`, "error");
  } finally {
    conv.updatedAt = Date.now();
    saveConversations();
    setStreaming(false);
    renderMessages();
    maybeAutoTitle(conv);
  }
}

// Poll a pending free-queue image job until it finishes (no server time limit).
async function pollImageJob(id, body) {
  const deadline = Date.now() + 180000; // up to 3 minutes
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    let s = {};
    try {
      const r = await fetch("/api/image-status?id=" + encodeURIComponent(id));
      s = await r.json().catch(() => ({}));
    } catch {
      continue;
    }
    if (s.dataUrl) return s.dataUrl;
    if (s.error) throw new Error(s.error);
    const pos = s.queue != null ? ` (queue position ${s.queue})` : "";
    body.innerHTML = `🎨 <em>Generating image on the free queue…${pos}</em> <span class="cursor"></span>`;
    scrollToBottom();
  }
  throw new Error("Image is taking too long — please try again");
}

function regenerate() {
  if (isStreaming) return;
  const conv = getActive();
  if (!conv) return;
  while (conv.messages.length && conv.messages[conv.messages.length - 1].role === "assistant") {
    conv.messages.pop();
  }
  if (!conv.messages.length) return;
  saveConversations();
  renderMessages();
  streamReply(conv);
}

async function maybeAutoTitle(conv) {
  if (conv.titled) return;
  const hasUser = conv.messages.some((m) => m.role === "user");
  const hasAssistant = conv.messages.some((m) => m.role === "assistant");
  if (!hasUser || !hasAssistant) return;
  conv.titled = true;

  try {
    const res = await fetch("/api/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: conv.messages
          .slice(0, 4)
          .map((m) => ({ role: m.role, content: m.content || (m.image ? "[image]" : "") })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.title) {
      conv.title = data.title;
      if (activeId === conv.id) els.title.textContent = conv.title;
      renderSidebar();
    }
  } catch {
    /* non-critical */
  } finally {
    saveConversations();
  }
}

function setStreaming(on) {
  isStreaming = on;
  updateSendState();
}

// ---------- Read aloud (ElevenLabs) ----------
async function readAloud(text, btn) {
  if (player.btn === btn && player.audio) {
    stopAudio();
    return;
  }
  stopAudio();

  btn.disabled = true;
  setActionLabel(btn, "Loading…");
  try {
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `Request failed (${res.status})`);
    }
    const emotion = res.headers.get("X-Emotion") || "";
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    player = { audio, btn, url };

    btn.disabled = false;
    btn.classList.add("playing");
    setActionLabel(btn, "Stop");
    if (emotion) {
      const emoji = { excited: "🤩", cheerful: "😊", empathetic: "🤗", sad: "😔", serious: "🧐", calm: "😌", neutral: "🗣️" };
      toast(`${emoji[emotion] || "🔊"} Reading in a ${emotion} tone`, "info");
    }
    audio.onended = () => stopAudio();
    audio.onerror = () => {
      toast("Audio playback failed", "error");
      stopAudio();
    };
    await audio.play();
  } catch (err) {
    btn.disabled = false;
    btn.classList.remove("playing");
    setActionLabel(btn, "Read aloud");
    toast(`Read aloud: ${err.message}`, "error");
  }
}
function stopAudio() {
  if (player.audio) {
    try {
      player.audio.pause();
    } catch {}
  }
  if (player.url) URL.revokeObjectURL(player.url);
  if (player.btn) {
    player.btn.classList.remove("playing");
    player.btn.disabled = false;
    setActionLabel(player.btn, "Read aloud");
  }
  player = { audio: null, btn: null, url: null };
}

// ---------- Voice input (Whisper) ----------
async function toggleRecording() {
  if (isStreaming) return;
  if (isRecording) {
    mediaRecorder?.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    return toast("Voice input isn't supported in this browser.", "error");
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    const mr = new MediaRecorder(stream);
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      isRecording = false;
      els.micBtn.classList.remove("recording");
      els.micBtn.classList.add("busy");
      flashHint("Transcribing…");
      const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
      await transcribeBlob(blob);
      els.micBtn.classList.remove("busy");
    };
    mr.start();
    mediaRecorder = mr;
    isRecording = true;
    els.micBtn.classList.add("recording");
    flashHint("Recording… click the mic again to stop.");
  } catch {
    toast("Microphone access was denied.", "error");
  }
}

async function transcribeBlob(blob) {
  try {
    const base64 = await blobToBase64(blob);
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: base64, mime: blob.type || "audio/webm" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    const text = (data.text || "").trim();
    if (!text) {
      resetHint();
      return toast("Didn't catch that — try again.", "error");
    }
    els.input.value = (els.input.value ? els.input.value.trimEnd() + " " : "") + text;
    autoGrow();
    updateSendState();
    els.input.focus();
    resetHint();
  } catch (err) {
    resetHint();
    toast(`Transcription failed: ${err.message}`, "error");
  }
}
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ---------- Image attachment (vision) ----------
function fileToDownscaledDataUrl(file, max = 1024, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > max || height > max) {
        const s = Math.min(max / width, max / height);
        width = Math.round(width * s);
        height = Math.round(height * s);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}
async function onFilePicked(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) return toast("Please choose an image file.", "error");
  try {
    attachedImage = await fileToDownscaledDataUrl(file);
    els.attachmentThumb.src = attachedImage;
    els.attachment.hidden = false;
    updateSendState();
    els.input.focus();
    flashHint("Image attached — ask a question about it.");
  } catch {
    toast("Couldn't load that image.", "error");
  }
}
function clearAttachment() {
  attachedImage = null;
  els.attachment.hidden = true;
  els.attachmentThumb.removeAttribute("src");
  els.fileInput.value = "";
  updateSendState();
}

// ---------- Toast / hint ----------
function toast(message, type = "info") {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = message;
  els.toastWrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .25s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 260);
  }, 3200);
}
let hintTimer = null;
function flashHint(text, isError = false) {
  clearTimeout(hintTimer);
  els.hint.textContent = text;
  els.hint.classList.toggle("error", isError);
  hintTimer = setTimeout(resetHint, 4000);
}
function resetHint() {
  clearTimeout(hintTimer);
  els.hint.innerHTML = DEFAULT_HINT;
  els.hint.classList.remove("error");
}

// ---------- Markdown ----------
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderInline(s) {
  return s
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (part.length >= 2 && part.startsWith("`") && part.endsWith("`")) {
        return "<code>" + part.slice(1, -1) + "</code>";
      }
      return part
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
        .replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>")
        .replace(
          /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
        );
    })
    .join("");
}
function renderMarkdown(text) {
  const src = escapeHtml(text);
  const lines = src.split("\n");
  let html = "";
  let i = 0;
  let listType = null;

  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      closeList();
      const lang = fence[1] || "";
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++;
      html += `<pre><code data-lang="${lang}">${code.join("\n")}</code></pre>`;
      continue;
    }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      html += `<h${level}>${renderInline(h[2])}</h${level}>`;
      i++;
      continue;
    }

    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (listType !== "ul") {
        closeList();
        html += "<ul>";
        listType = "ul";
      }
      html += `<li>${renderInline(ul[1])}</li>`;
      i++;
      continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (listType !== "ol") {
        closeList();
        html += "<ol>";
        listType = "ol";
      }
      html += `<li>${renderInline(ol[1])}</li>`;
      i++;
      continue;
    }

    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    closeList();
    const para = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i]) &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^\s*[-*]\s/.test(lines[i]) &&
      !/^\s*\d+\.\s/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    html += `<p>${renderInline(para.join("<br>"))}</p>`;
  }

  closeList();
  return html;
}

// ---------- Input ----------
function updateSendState() {
  if (isStreaming) {
    els.send.disabled = false;
    els.send.classList.add("streaming");
    els.send.title = "Stop generating";
  } else {
    els.send.classList.remove("streaming");
    els.send.title = "Send";
    els.send.disabled = els.input.value.trim() === "" && !attachedImage;
  }
}
function autoGrow() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 220) + "px";
}

els.input.addEventListener("input", () => {
  autoGrow();
  updateSendState();
});
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.form.requestSubmit();
  }
});
els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (isStreaming) {
    stopStreaming();
    return;
  }
  const text = els.input.value.trim();
  if (!text && !attachedImage) return;
  els.input.value = "";
  autoGrow();
  updateSendState();
  sendMessage(text);
});

els.newChat.addEventListener("click", newConversation);
els.toggle.addEventListener("click", () => els.sidebar.classList.toggle("collapsed"));
els.attachBtn.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", (e) => onFilePicked(e.target.files[0]));
els.removeAttachment.addEventListener("click", clearAttachment);
els.micBtn.addEventListener("click", toggleRecording);

els.examples.addEventListener("click", (e) => {
  const b = e.target.closest(".example");
  if (!b || isStreaming) return;
  sendMessage(b.dataset.prompt);
});

// Provider selector
PROVIDERS.forEach((p) => {
  const opt = document.createElement("option");
  opt.value = p.id;
  opt.textContent = p.label;
  els.providerSelect.appendChild(opt);
});
if (!PROVIDERS.some((p) => p.id === provider)) provider = "groq";
els.providerSelect.value = provider;
els.providerSelect.addEventListener("change", () => {
  provider = els.providerSelect.value;
  localStorage.setItem(PROVIDER_KEY, provider);
  toast(`Model: ${els.providerSelect.options[els.providerSelect.selectedIndex].text}`, "info");
});

// Fast mode toggle (best-quality models by default; quicker ones when on)
function syncFastBtn() {
  els.fastBtn.classList.toggle("active", fastMode);
  els.fastBtn.setAttribute("aria-pressed", String(fastMode));
}
syncFastBtn();
els.fastBtn.addEventListener("click", () => {
  fastMode = !fastMode;
  localStorage.setItem("chatbot.fast", fastMode ? "1" : "0");
  syncFastBtn();
  toast(
    fastMode ? "⚡ Fast mode on — quicker, lighter models" : "Quality mode — best models",
    "info"
  );
});

// ---------- Init ----------
renderSidebar();
renderMessages();
els.input.focus();
