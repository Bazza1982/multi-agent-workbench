# 🤖 Multi-Agent Workbench

A real-time multi-agent chat workbench for [OpenClaw](https://github.com/openclaw/openclaw). Monitor and interact with multiple AI agents simultaneously in a sleek dark-themed web UI.

![Multi-Agent Workbench](https://img.shields.io/badge/React-Vite-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Multi-Agent Grid** — View 1–9 agents simultaneously with smart auto-layout (1×1, 1×2, 2×2, 2×3, 3×3)
- **Real-Time Chat Sync** — 1-second transcript polling from OpenClaw session files
- **Per-Agent Input** — Each agent has its own message box (Enter to send, Shift+Enter for newline, Ctrl+V to paste images)
- **Context Window Monitor** — Live token usage with color-coded progress bars (🟢 <60%, 🟡 60–80%, 🔴 >80%)
- **System Dashboard** — CPU, RAM, GPU, and Gateway status at a glance
- **Thinking/Reasoning Controls** — Toggle reasoning visibility and thinking depth per agent
- **Deep Dark Theme** — Easy on the eyes for long sessions
- **Responsive** — Works on wide monitors and laptops alike

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│  React UI   │────▶│  Express API │────▶│  OpenClaw Gateway │
│  (Vite)     │     │  (port 3001) │     │  (port 18789)    │
│  port 5173  │     │              │     │                  │
└─────────────┘     └──────────────┘     └──────────────────┘
                           │
                           ▼
                    📁 Transcript .jsonl files
                    📁 sessions.json (token usage)
```

- **Frontend**: React 18 + Vite — fast HMR, zero-config JSX
- **Backend**: Express.js — proxies chat API, reads transcripts & session state
- **Data**: Reads OpenClaw's `.jsonl` transcript files and `sessions.json` for real-time sync

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [OpenClaw](https://github.com/openclaw/openclaw) running with `chatCompletions` enabled

### Install & Run

```bash
cd web
npm install
npm run dev
```

This starts:
- Frontend at `http://localhost:5173`
- Backend API at `http://localhost:3001`

### Configuration

Edit `server/agents.js` to configure your agents (IDs, session keys, transcript paths).

The server reads the Gateway token from:
1. `OPENCLAW_TOKEN` environment variable, or
2. `~/.openclaw/openclaw.json` → `gateway.auth.token`

## Usage

1. Open `http://localhost:5173` in your browser
2. Check the agents you want to monitor (up to 9)
3. Chat with any agent using the input box in their panel
4. Watch real-time transcript updates flow in
5. Monitor context window usage to know when to `/compact`

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 18, Vite 5 |
| Backend | Express.js, Node.js |
| Styling | Pure CSS (dark theme) |
| Data | OpenClaw transcript `.jsonl`, `sessions.json` |
| Chat API | OpenClaw `/v1/chat/completions` |

## License

MIT

## Credits

Built with ❤️ by 小夏 (Sunny) — an AI assistant powered by OpenClaw.

Original concept and direction by Barry Li.
