<p align="center">
  <img src="assets/banner.svg" alt="Chatbot like Claude" width="100%">
</p>

<p align="center">
  A minimal, self-hostable AI chat web app with a <b>Claude-style interface</b> —
  conversation history in a sidebar, streaming replies, and your choice of model.
</p>

<p align="center">
  <a href="https://chatbot-like-claude.vercel.app"><b>🚀 Live demo</b></a>
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white">
  <img alt="Deploy" src="https://img.shields.io/badge/Deploy-Vercel-000000?logo=vercel&logoColor=white">
  <img alt="OpenAI-compatible" src="https://img.shields.io/badge/API-OpenAI--compatible-412991?logo=openai&logoColor=white">
  <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-c96442">
</p>

---

## ✨ Features

- 🗂️ **Conversation sidebar** — every chat is saved; click to reopen, rename happens automatically, delete any time
- ⚡ **Streaming replies** with a live typing effect
- 📝 **Markdown rendering** — code blocks, lists, bold/italic, links
- 🔌 **Pluggable models** — works with any OpenAI-compatible provider (Groq, OpenRouter, Cerebras, Mistral, Fireworks)
- 🔒 **Keys stay server-side** — the browser never sees your API key
- 💾 **No database** — conversations live in `localStorage`
- 🎨 **Clean, Claude-inspired UI** — zero frontend build step

## 🧱 Tech stack

Vanilla **HTML / CSS / JS** frontend · **Node.js** backend (Express locally, a Vercel serverless function in production) · **OpenAI-compatible** chat API.

## 🚀 Quick start (local)

```bash
git clone <your-repo-url>
cd chatbot-like-claude
npm install

cp .env.example .env      # then add a key for your chosen provider
npm start
```

Open <http://localhost:3000>.

## ⚙️ Configure the model

Everything is controlled by `.env`:

```ini
PROVIDER=groq          # groq | openrouter | cerebras | mistral | fireworks
# MODEL=...            # optional: override the provider's default model
GROQ_API_KEY=...       # only the active provider's key is required
```

| Provider     | Default model                                       |
| ------------ | --------------------------------------------------- |
| `groq`       | `llama-3.3-70b-versatile`                           |
| `openrouter` | `meta-llama/llama-3.3-70b-instruct`                 |
| `cerebras`   | `gpt-oss-120b`                                      |
| `mistral`    | `mistral-small-latest`                              |
| `fireworks`  | `accounts/fireworks/models/llama-v3p3-70b-instruct` |

> **Want real Claude?** Set `PROVIDER=openrouter` and `MODEL=anthropic/claude-3.5-sonnet`
> (needs credits on your OpenRouter account), or swap the backend to the official
> `@anthropic-ai/sdk`.

## ☁️ Deploy (Vercel)

```bash
npm i -g vercel
vercel deploy --prod
```

Then add your key in **Vercel → Project → Settings → Environment Variables**
(`GROQ_API_KEY`, and optionally `PROVIDER` / `MODEL`).

`public/` is served as static files; `api/chat.js` runs as a serverless function.

## 📁 Project structure

```
.
├── api/
│   └── chat.js        Serverless chat endpoint (production, Vercel)
├── public/
│   ├── index.html     Page layout
│   ├── styles.css     Styling
│   └── app.js         Sidebar, conversations, streaming, markdown
├── assets/
│   └── banner.svg     README banner
├── server.js          Local dev server (Express) — same chat logic
├── vercel.json        Vercel function config
├── .env.example       Environment template
└── package.json
```

## 🔐 Security

- API keys are read from **environment variables only** — there are no secrets in the source.
- `.env` and any local key files are git-ignored (and `.vercelignore`d), so they're never committed or deployed.
- The chat key is used **server-side**; it is never exposed to the browser.
- The public endpoint has no auth — anyone with the URL uses your quota. For a public deploy,
  consider adding a password gate or rate limiting.

## 📄 License

[MIT](LICENSE)
