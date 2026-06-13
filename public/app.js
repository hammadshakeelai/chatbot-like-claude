// ---------- State ----------
const STORAGE_KEY = "chatbot.conversations";
let conversations = loadConversations();
let activeId = null;
let isStreaming = false;

// ---------- DOM ----------
const els = {
  sidebar: document.getElementById("sidebar"),
  list: document.getElementById("conversationList"),
  newChat: document.getElementById("newChatBtn"),
  toggle: document.getElementById("toggleSidebar"),
  title: document.getElementById("chatTitle"),
  messages: document.getElementById("messages"),
  empty: document.getElementById("emptyState"),
  form: document.getElementById("composer"),
  input: document.getElementById("input"),
  send: document.getElementById("sendBtn"),
};

// ---------- Storage helpers ----------
function loadConversations() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}
function saveConversations() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
}
function getActive() {
  return conversations.find((c) => c.id === activeId) || null;
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- Conversation actions ----------
function newConversation() {
  activeId = null;
  els.title.textContent = "New chat";
  renderSidebar();
  renderMessages();
  els.input.focus();
}

function selectConversation(id) {
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

// ---------- Rendering ----------
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

function renderMessages() {
  const conv = getActive();
  els.messages.innerHTML = "";

  if (!conv || conv.messages.length === 0) {
    els.messages.appendChild(els.empty);
    els.empty.style.display = "";
    return;
  }
  els.empty.style.display = "none";

  conv.messages.forEach((m) => addMessageEl(m.role, m.content));
  scrollToBottom();
}

function addMessageEl(role, content) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "You" : "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (role === "assistant") bubble.innerHTML = renderMarkdown(content);
  else bubble.textContent = content;

  wrap.append(avatar, bubble);
  els.messages.appendChild(wrap);
  return bubble;
}

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

// ---------- Sending / streaming ----------
async function sendMessage(text) {
  if (isStreaming) return;

  // Create a conversation on the first message.
  let conv = getActive();
  if (!conv) {
    conv = {
      id: uid(),
      title: text.slice(0, 40) + (text.length > 40 ? "..." : ""),
      messages: [],
      updatedAt: Date.now(),
    };
    conversations.unshift(conv);
    activeId = conv.id;
    els.title.textContent = conv.title;
  }

  conv.messages.push({ role: "user", content: text });
  conv.updatedAt = Date.now();
  saveConversations();

  els.empty.style.display = "none";
  addMessageEl("user", text);
  renderSidebar();
  scrollToBottom();

  // Placeholder assistant bubble with a blinking cursor.
  const bubble = addMessageEl("assistant", "");
  bubble.innerHTML = '<span class="cursor"></span>';
  scrollToBottom();

  setStreaming(true);
  let answer = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: conv.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      answer += decoder.decode(value, { stream: true });
      bubble.innerHTML = renderMarkdown(answer) + '<span class="cursor"></span>';
      scrollToBottom();
    }
  } catch (err) {
    answer = (answer || "") + `\n\n**Error:** ${err.message}`;
  } finally {
    bubble.innerHTML = renderMarkdown(answer);
    conv.messages.push({ role: "assistant", content: answer });
    conv.updatedAt = Date.now();
    saveConversations();
    setStreaming(false);
    scrollToBottom();
  }
}

function setStreaming(on) {
  isStreaming = on;
  updateSendState();
}

// ---------- Minimal, safe Markdown renderer ----------
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInline(s) {
  // Split on inline code spans and format only the non-code segments, so
  // formatting rules never touch code and there are no placeholder collisions.
  return s
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (part.length >= 2 && part.startsWith("`") && part.endsWith("`")) {
        return "<code>" + part.slice(1, -1) + "</code>";
      }
      return part
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
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
  let listType = null; // "ul" | "ol" | null

  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block ```
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      closeList();
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      html += `<pre><code>${code.join("\n")}</code></pre>`;
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      html += `<h${level}>${renderInline(h[2])}</h${level}>`;
      i++;
      continue;
    }

    // Unordered list
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

    // Ordered list
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

    // Blank line
    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    // Paragraph: gather consecutive non-empty, non-special lines
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

// ---------- Input handling ----------
function updateSendState() {
  els.send.disabled = isStreaming || els.input.value.trim() === "";
}

function autoGrow() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 200) + "px";
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
  const text = els.input.value.trim();
  if (!text || isStreaming) return;
  els.input.value = "";
  autoGrow();
  updateSendState();
  sendMessage(text);
});

els.newChat.addEventListener("click", newConversation);
els.toggle.addEventListener("click", () =>
  els.sidebar.classList.toggle("collapsed")
);

// ---------- Init ----------
renderSidebar();
renderMessages();
els.input.focus();
