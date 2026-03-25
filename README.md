# Feishu AI Assistant

> Bridge any AI coding CLI (Claude, Codex, Gemini, Cursor, OpenCode) to Feishu/Lark as a team chatbot, with streaming responses, interactive permission cards, and multi-platform support.

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

## Why?

You already use Claude Code (or Codex, Gemini CLI, etc.) locally. Your team uses Feishu. This project turns your local AI CLI into a shared Feishu bot — anyone in your org can chat with it, and you get streaming responses, tool-use notifications, interactive permission cards, and per-user conversation sessions.

## Features

- **5 Agent Backends** — Claude Code, OpenAI Codex, Google Gemini CLI, Cursor, OpenCode
- **4 Platform Channels** — Feishu (primary), Telegram, Discord, DingTalk
- **Streaming Responses** — Real-time token streaming with configurable preview intervals
- **Interactive Permission Cards** — Tool calls require explicit Allow / Deny approval via Feishu cards
- **Per-User Sessions** — Isolated conversation history, workspace files, and memory per user
- **Slash Commands** — Extensible `/model`, `/reset`, `/help` and custom prompt commands
- **Session Queue** — Messages from the same user are serialized; different users run concurrently
- **Rate Limiting & RBAC** — Sliding-window rate limits with admin/user/guest roles
- **Cron Scheduler** — Schedule recurring tasks with standard cron expressions
- **WebUI Console** — Live monitor, config editor, and secrets management at `http://127.0.0.1:18791`
- **Per-User Workspace** — Each user gets `CLAUDE.md`, `MEMORY.md`, `USER.md` under `~/.atlasOS/agents/{id}/users/{uid}/`

## Architecture

```
                          ┌────────────────────────────────────┐
                          │             Engine                  │
                          │  ┌──────────┐  ┌────────────────┐  │
  Feishu  ──WebSocket──►  │  │ Commands │  │ SessionManager │  │
  Telegram ─Polling────►  │  │ Registry │  │  + Queue       │  │
  Discord  ─Gateway────►  │  └──────────┘  └───────┬────────┘  │
  DingTalk ─Webhook────►  │                        │            │
                          │          ┌─────────────▼──────┐     │
                          │          │   Agent Backend     │     │
                          │          │ (Claude/Codex/...)  │     │
                          │          └─────────────────────┘     │
                          └────────────────────────────────────┘
                                          │
                              AgentEvent stream (text, thinking,
                              tool_use, permission_request, result)
                                          │
                                          ▼
                                 PlatformSender
                            (sendText / sendMarkdown /
                             sendInteractiveCard)
```

**Key design decisions:**

- **Engine orchestrator** — Central `Engine` class replaces flat routing; manages platforms, sessions, and message dispatch
- **Stateless CLI** — No session file locks; conversation history injected via `--append-system-prompt`
- **Agent/Session factory** — Pluggable backends via registry pattern; each backend spawns CLI as child process
- **Streaming event protocol** — Unified `AgentEvent` types: `text`, `thinking`, `tool_use`, `tool_result`, `permission_request`, `result`, `error`

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **One AI CLI** installed and authenticated (e.g., `claude` in PATH)
- **Feishu Developer App** with bot capability ([create one here](https://open.feishu.cn/app))

### 1. Clone and install

```bash
git clone https://github.com/user/feishu-ai-assistant.git
cd feishu-ai-assistant
npm install
```

### 2. Configure credentials

Create `.env` in the project root:

```bash
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=your_app_secret_here
# Optional: for API-mode agents
ANTHROPIC_API_KEY=your_api_key
```

Get Feishu credentials from [Feishu Open Platform](https://open.feishu.cn/app) > Your App > Credentials.

### 3. Choose your agent backend

Edit `config.json`:

```jsonc
{
  "agent": {
    "backend": "claude",       // or "codex", "gemini", "cursor", "opencode"
    "cli_path": "claude",      // path to CLI executable
    "timeout": 120,
    "max_retries": 3
  }
}
```

### 4. Run

```bash
# Development (hot-reload)
npm run dev

# Production
npm run build && npm start
```

### 5. Verify

You should see:

```
{"level":"info","msg":"Configuration loaded"}
{"level":"info","msg":"Workspace initialized"}
{"level":"info","msg":"Engine started","platforms":["feishu"],"webui":"http://127.0.0.1:18791"}
```

Send a message to your bot in Feishu. It will reply with the AI's response.

## Feishu App Setup

1. Go to [Feishu Open Platform](https://open.feishu.cn/app) and create an Enterprise App
2. **Add Bot capability**: App Features > Bot
3. **Subscribe to events**: Event Subscriptions > Add `im.message.receive_v1`
4. **Permissions**: grant `im:message`, `im:message:readonly`, `im:message.reactions:write`
5. **Connection method**: Event Subscriptions > choose **WebSocket** (not HTTP callback)
6. **Publish** the app and approve it in your organization

## Bridging Local Claude CLI Sessions to Feishu

This is the core use case: you run Claude Code locally, and your team interacts with it through Feishu.

### How It Works

```
Your machine                              Feishu
┌─────────────────────┐                  ┌──────────────┐
│  feishu-ai-assistant │◄──WebSocket───► │  Feishu Bot   │
│  (Node.js server)    │                 │  (your app)   │
│         │            │                 └──────────────┘
│         ▼            │                        ▲
│  ┌──────────────┐    │                        │
│  │ claude -p    │    │     Streaming text,     │
│  │ (child proc) │────┼───► tool cards, ────────┘
│  └──────────────┘    │     permission prompts
└─────────────────────┘
```

### Step-by-Step Setup

#### Step 1: Install Claude Code CLI

```bash
# Install globally
npm install -g @anthropic-ai/claude-code

# Verify installation
claude --version

# Authenticate (one-time)
claude auth login
```

#### Step 2: Configure the Bridge

Your `config.json` should have:

```jsonc
{
  "agent": {
    "backend": "claude",
    "cli_path": "claude",          // or absolute path like "/usr/local/bin/claude"
    "timeout": 120,
    "max_retries": 3,
    "workspace_root": "~/.atlasOS" // where per-user data lives
  },
  "channels": {
    "feishu": {
      "app_id": "${FEISHU_APP_ID}",
      "app_secret": "${FEISHU_APP_SECRET}",
      "enabled": true
    }
  },
  "gateway": {
    "max_sessions": 200,
    "session_ttl": "30m",
    "context_compression_threshold": 100000
  }
}
```

#### Step 3: Start the Server

```bash
npm run dev
```

The server connects to Feishu via WebSocket and begins listening for messages.

#### Step 4: Chat in Feishu

1. Open Feishu and find your bot (by the app name you configured)
2. Send any message — the bot spawns a `claude -p` child process
3. Claude's response streams back to Feishu in real time
4. If Claude wants to use a tool (e.g., run a bash command), you'll see an **interactive permission card**:

   ```
   ┌─────────────────────────────────┐
   │  🔧 Tool Permission Request     │
   │                                  │
   │  bash: rm -rf /tmp/cache        │
   │                                  │
   │  [Allow]  [Deny]  [Allow All]   │
   └─────────────────────────────────┘
   ```

5. Click **Allow** or **Deny** directly in Feishu
6. The conversation continues with full context

#### Step 5: Session Management

- Each Feishu user gets an **isolated session** with their own conversation history
- Sessions expire after the configured TTL (default 30 minutes)
- Use `/reset` in Feishu to clear your session and start fresh
- Use `/model` to switch between agent backends on the fly

#### Step 6: Per-User Workspace

Each user's workspace lives at:

```
~/.atlasOS/agents/{agent-id}/users/{feishu-user-id}/
├── CLAUDE.md     # Project instructions (persists across sessions)
├── MEMORY.md     # Conversation memory
└── USER.md       # User preferences
```

You can pre-populate `CLAUDE.md` with project-specific instructions.

### Tips for Team Usage

- **Rate limits**: Configure `access_control.rate_limit` to prevent abuse (default: 30 msgs/min)
- **Admin list**: Add trusted users to `access_control.admin_list` for unrestricted access
- **Multiple backends**: Different team members can use `/model codex` or `/model gemini` to switch
- **Cron tasks**: Schedule recurring prompts (e.g., daily standup summaries) via `config.json`

## beam-flow: Park & Resume Sessions from Feishu

Start a Claude CLI session locally, "park" it, then list and resume it from Feishu — so you can switch from your terminal to mobile/desktop Feishu without losing context.

### Quick Example

```
PowerShell:
> npm run beam start fix-the-damn-bug
  Starting Claude session 'fix-the-damn-bug' (id: a1b2c3...)
  [normal interactive Claude CLI]
  > /exit
  Park now? [Y/n] y
  Parked 'fix-the-damn-bug'! In Feishu, type: /sessions

Feishu:
> /sessions
  Parked Sessions
  1. fix-the-damn-bug (2m ago)
  To resume: /resume <name>

> /resume fix-the-damn-bug
  Resumed session 'fix-the-damn-bug'! Claude remembers your conversation.
  Send a message to continue.
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `npm run beam start <name>` | Start Claude CLI with session tracking. Sets `BEAM_SESSION_ID` and `BEAM_SESSION_NAME` env vars. On exit, offers to auto-park. |
| `npm run beam park [name]` | Park the current session (reads env vars from `start`). Registers it with the server for Feishu access. |
| `npm run beam sessions` | List all parked sessions (alias: `ls`). |
| `npm run beam drop <name>` | Remove a parked session (alias: `rm`). |

### Feishu Slash Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `/sessions` | `/ss` | List all parked sessions with time since parked |
| `/resume <name>` | `/rs` | Resume a parked session — Claude picks up the full conversation history |

### How It Works

```
beam-flow CLI                    feishu-ai-assistant server
┌──────────────┐                ┌─────────────────────────┐
│ start <name> │                │ POST /api/beam/park      │
│  - spawn     │                │ GET  /api/beam/sessions  │
│    claude    │  park ──HTTP──►│ DEL  /api/beam/sessions/ │
│  - set env   │                │          │                │
│    vars      │                │   ParkedSessionStore      │
└──────────────┘                │   (parked.json)           │
                                │          │                │
                                │   Engine.resumeSession()  │
                                │   /sessions → list        │
                                │   /resume   → startSession│
                                │              (--session-id)│
                                └─────────────────────────┘
```

1. `beam-flow start` spawns `claude --session-id <uuid>` and binds the UUID to your shell via env vars
2. `beam-flow park` reads env vars and POSTs to the server's `/api/beam/park` endpoint
3. In Feishu, `/sessions` lists parked sessions; `/resume` calls `Engine.resumeSession()` which starts a new agent session using the same Claude CLI session UUID
4. Claude CLI's built-in session persistence means the full conversation history is available

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BEAM_SERVER_URL` | `http://127.0.0.1:18791` | Server URL for beam-flow API calls |
| `CLAUDE_CLI_PATH` | `claude` | Path to the Claude CLI executable |
| `BEAM_SESSION_ID` | *(set by start)* | Auto-set by `beam-flow start`, used by `park` |
| `BEAM_SESSION_NAME` | *(set by start)* | Auto-set by `beam-flow start`, used by `park` |

### REST API

These endpoints are CSRF-exempted and localhost-only:

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `POST` | `/api/beam/park` | `{ name, cliSessionId }` | `{ ok: true }` |
| `GET` | `/api/beam/sessions` | — | `ParkedSession[]` |
| `DELETE` | `/api/beam/sessions/:name` | — | `{ ok: removed }` |

## Multi-Platform Support

Enable additional platforms in `config.json`:

```jsonc
{
  "channels": {
    "feishu":   { "enabled": true,  "app_id": "...", "app_secret": "..." },
    "telegram": { "enabled": false, "bot_token": "..." },
    "discord":  { "enabled": false, "bot_token": "..." },
    "dingtalk": { "enabled": false, "app_key": "...", "app_secret": "..." }
  }
}
```

Each platform adapter implements the same `PlatformAdapter` interface, so all features (streaming, cards, permissions) work across platforms.

## Project Structure

```
src/
├── index.ts                     # Entry point, wiring, graceful shutdown
├── config.ts                    # Load config.json + .env, expand ${ENV_VAR}
├── agent/
│   ├── registry.ts              # Agent backend registry (factory pattern)
│   ├── types.ts                 # Agent/AgentSession interfaces
│   ├── claude/                  # Claude Code CLI backend
│   ├── codex/                   # OpenAI Codex CLI backend
│   ├── gemini/                  # Google Gemini CLI backend
│   ├── cursor/                  # Cursor CLI backend
│   └── opencode/                # OpenCode CLI backend
├── core/
│   ├── engine.ts                # Central orchestrator (Engine class)
│   ├── interfaces.ts            # Shared types (Agent, PlatformAdapter, AgentEvent, etc.)
│   ├── cards.ts                 # Platform-agnostic card builder
│   ├── permission.ts            # Interactive permission system (multilingual)
│   ├── error.ts                 # Error classification (retryable, auth, rate-limit, etc.)
│   ├── dedup.ts                 # Message deduplication
│   ├── ratelimit.ts             # Sliding-window rate limiter + RBAC
│   ├── cron.ts                  # Cron expression parser and scheduler
│   ├── logger.ts                # Structured JSON logger with token redaction
│   ├── utils.ts                 # Token estimation, line iterators
│   ├── command/
│   │   └── registry.ts          # Slash command registry with prefix matching
│   └── session/
│       ├── manager.ts           # Session lifecycle (TTL, cleanup)
│       └── queue.ts             # Per-session serial async queue
├── platform/
│   ├── registry.ts              # Platform adapter registry
│   ├── types.ts                 # Capability interfaces (InlineButton, Image, File, Audio, Typing)
│   ├── feishu/
│   │   ├── adapter.ts           # Feishu WebSocket adapter (@larksuiteoapi/node-sdk)
│   │   ├── client.ts            # Feishu API client (send messages, reactions)
│   │   └── cards.ts             # Feishu interactive card formatting
│   ├── telegram/adapter.ts      # Telegram polling adapter
│   ├── discord/adapter.ts       # Discord gateway adapter
│   └── dingtalk/adapter.ts      # DingTalk webhook adapter
├── workspace/
│   └── workspace.ts             # Per-agent/per-user file management
└── webui/
    ├── server.ts                # Express server (config API, secrets, SSE, CSRF)
    ├── events.ts                # SSE event bus for live monitoring
    └── static/index.html        # Web console SPA
```

## Configuration Reference

All settings in `config.json`. The config supports `${ENV_VAR}` expansion from `.env`.

| Section | Key Settings | Description |
|---------|-------------|-------------|
| `agent` | `backend`, `cli_path`, `timeout`, `max_retries` | AI backend selection and CLI configuration |
| `channels` | `feishu`, `telegram`, `discord`, `dingtalk` | Platform adapter credentials and enable/disable |
| `gateway` | `max_sessions`, `session_ttl`, `context_compression_threshold` | Session management and limits |
| `access_control` | `admin_list`, `allow_list`, `roles`, `rate_limit` | RBAC and rate limiting |
| `voice` | `stt` (Whisper), `tts` (Edge) | Voice message support |
| `cron` | `tasks` | Scheduled recurring prompts |
| `webui` | `enabled`, `port` | Web console (default: 18791) |
| `logging` | `level`, `format`, `output` | Structured JSON logging |
| `mcp` | `config_path` | MCP server configuration |

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

The test suite covers:

- **Core modules**: Engine, session queue, command registry, error classification, dedup, cron, rate limiting, permission system, card builder
- **Platform modules**: Feishu cards, message formatting, permission request cards

## WebUI

Auto-starts on port 18791. Provides:

- **Monitor** — Live logs and message feed via Server-Sent Events (SSE)
- **Configuration** — Visual tree editor for `config.json`
- **Secrets** — Manage `.env` variables securely
- **Status** — Uptime, connected platforms, active sessions

## Documentation

| Document | Description |
|----------|-------------|
| [doc/memory.md](./doc/memory.md) | Change log and architecture notes |
| [docs/superpowers/specs/](./docs/superpowers/specs/) | Design specifications |
| [docs/superpowers/plans/](./docs/superpowers/plans/) | Implementation plans |
| [go-archive/](./go-archive/) | Archived Go v1 implementation |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Write tests first (TDD), then implement
4. Run `npm test` to verify
5. Submit a Pull Request

## License

MIT
