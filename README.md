# Feishu AI Assistant (Atlas AI)

> Bridge Claude AI to Feishu/Lark and DingTalk as a team chatbot, with streaming responses, interactive permission cards, idle session notifications, and multi-channel support.

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

## Features

- **Claude AI Backend** — Anthropic SDK with streaming (`client.messages.stream()`)
- **Multi-Channel** — Feishu/Lark (WebSocket) + DingTalk (Stream/Webhook)
- **Streaming Responses** — Real-time token streaming via interactive cards
- **Interactive Permission Cards** — Tool calls require Allow / Deny approval
- **Per-Chat Sessions** — Isolated conversation history per chat
- **Idle Session Notifications** — Rich context (agent, last message, session age) when sessions go idle
- **Slash Commands** — `/new`, `/stop`, `/model`, `/sessions`, etc.
- **Session Queue** — Messages from the same chat serialized; different chats run concurrently
- **Pluggable Agent Registry** — Register new AI backends with `agentRegistry.register(id, factory)`

## Architecture (v2 Monorepo)

```
packages/
├── atlas-wire/        # Shared types and schemas (zod)
├── atlas-agent/       # Agent abstraction + Claude backend
│   └── backends/claude/  # Anthropic SDK integration
├── atlas-gateway/     # Engine, sessions, channels, cards, commands
├── atlas-app-logs/    # Structured logging
└── atlas-cli/         # Entry point (wires everything together)
```

```
                      ┌─────────────────────────────────────┐
                      │            Engine (gateway)          │
                      │  ┌──────────┐  ┌────────────────┐   │
Feishu ──WebSocket──► │  │ Commands │  │ SessionManager │   │
DingTalk ─Stream────► │  │ Registry │  │  + IdleWatcher │   │
                      │  └──────────┘  └───────┬────────┘   │
                      │                        │             │
                      │          ┌─────────────▼──────┐      │
                      │          │   AgentBridge       │      │
                      │          │   → AgentRegistry   │      │
                      │          │   → ClaudeBackend   │      │
                      │          └─────────────────────┘      │
                      └─────────────────────────────────────┘
```

**How it works:**

1. Feishu/DingTalk message arrives via WebSocket/Stream
2. `Engine.handleChannelEvent()` routes to command or agent
3. `SessionManager` creates/retrieves per-chat session
4. `AgentBridge` delegates to `ClaudeBackend` via `agentRegistry`
5. `ClaudeBackend` calls Anthropic `messages.stream()` API
6. Streaming tokens flow back through `CardRenderPipeline` → channel sender
7. `IdleWatcher` fires rich context notifications when sessions go idle

## Quick Start

See [INSTALL.md](./INSTALL.md) for detailed step-by-step instructions.

```bash
# 1. Clone and install
git clone https://github.com/lz865469181/AtlasOS.git feishu-ai-assistant
cd feishu-ai-assistant
yarn install

# 2. Configure
cp .env.example .env
# Edit .env with your credentials (see Configuration section below)

# 3. Build and run
yarn build
yarn start
```

## Configuration

### Option A: Environment Variables (`.env`)

Create a `.env` file at the project root:

```bash
# ── Required: Feishu/Lark bot credentials ──
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=your_app_secret_here

# ── Required: Anthropic API key ──
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxx

# ── Optional: DingTalk (if using DingTalk channel) ──
DINGTALK_APP_KEY=your_dingtalk_app_key
DINGTALK_APP_SECRET=your_dingtalk_app_secret
DINGTALK_MODE=stream    # stream or webhook

# ── Optional: Claude model configuration ──
CLAUDE_MODEL=claude-sonnet-4-6          # default model
CLAUDE_MAX_TOKENS=8192                    # max response tokens
CLAUDE_SYSTEM_PROMPT=You are a helpful assistant.

# ── Optional: Agent settings ──
AGENT_CWD=.                               # working directory for agent
ATLAS_IDLE_TIMEOUT=600000                  # idle notification timeout (ms, default 10min)
ATLAS_LOG_LEVEL=info                       # debug | info | warn | error
```

### Option B: Config File (`atlas.config.json`)

Create `atlas.config.json` at the project root for richer configuration:

```json
{
  "channels": {
    "feishu": {
      "appId": "cli_xxxxxxxxxxxx",
      "appSecret": "your_app_secret_here"
    },
    "dingtalk": {
      "appKey": "your_dingtalk_app_key",
      "appSecret": "your_dingtalk_app_secret",
      "mode": "stream"
    }
  },
  "agent": {
    "cwd": ".",
    "env": {
      "ANTHROPIC_API_KEY": "sk-ant-api03-xxxxxxxxxxxx",
      "CLAUDE_MODEL": "claude-sonnet-4-6",
      "CLAUDE_MAX_TOKENS": "8192",
      "CLAUDE_SYSTEM_PROMPT": "You are a helpful assistant."
    },
    "defaultAgent": "claude",
    "defaultPermissionMode": "auto"
  },
  "idleTimeoutMs": 600000,
  "logLevel": "info"
}
```

**Config resolution order:** `atlas.config.json` → `.env` → runtime overrides (later wins).

### Environment Variable → Config Mapping

| Environment Variable | Config Path | Description |
|---------------------|-------------|-------------|
| `FEISHU_APP_ID` | `channels.feishu.appId` | Feishu bot App ID |
| `FEISHU_APP_SECRET` | `channels.feishu.appSecret` | Feishu bot App Secret |
| `DINGTALK_APP_KEY` | `channels.dingtalk.appKey` | DingTalk App Key |
| `DINGTALK_APP_SECRET` | `channels.dingtalk.appSecret` | DingTalk App Secret |
| `DINGTALK_MODE` | `channels.dingtalk.mode` | `stream` or `webhook` |
| `AGENT_CWD` | `agent.cwd` | Agent working directory |
| `AGENT_DEFAULT_AGENT` | `agent.defaultAgent` | Default agent ID (default: `claude`) |
| `AGENT_DEFAULT_MODEL` | `agent.defaultModel` | Default model override |
| `AGENT_PERMISSION_MODE` | `agent.defaultPermissionMode` | `auto` / `confirm` / `deny` |
| `ATLAS_IDLE_TIMEOUT` | `idleTimeoutMs` | Idle notification timeout in ms |
| `ATLAS_LOG_LEVEL` | `logLevel` | Log level |

### Claude Backend Environment Variables

These are passed to the Claude backend via `agent.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | **Required.** Anthropic API key |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Model to use |
| `CLAUDE_MAX_TOKENS` | `8192` | Max response tokens |
| `CLAUDE_SYSTEM_PROMPT` | *(none)* | System prompt for all conversations |

## Feishu App Setup

1. Go to [Feishu Open Platform](https://open.feishu.cn/app) > Create Enterprise App
2. **Add Bot capability**: App Features > Bot
3. **Subscribe to events**: Event Subscriptions > Add `im.message.receive_v1`
4. **Permissions**: grant `im:message`, `im:message:readonly`
5. **Connection method**: Event Subscriptions > choose **WebSocket**
6. **Publish** the app and approve it in your organization

## Bot Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `/new` | `/reset` | Create new session (clear context) |
| `/stop` | — | Stop current agent execution |
| `/sessions` | `/ss` | List active sessions |
| `/resume <name>` | `/rs` | Resume a parked session |
| `/model` | `/m` | Switch AI model |
| `/help` | `/h` | List available commands |
| `/status` | — | Show server and session status |

## Development

### Monorepo Commands

```bash
# Install all workspace dependencies
yarn install

# Build all packages (dependency-ordered)
yarn build

# Run all tests
yarn test

# Dev mode (atlas-gateway with hot reload)
yarn dev

# Start the service
yarn start

# Build/test individual packages
yarn workspace atlas-agent build
yarn workspace atlas-agent test
yarn workspace atlas-gateway test
```

### Package Overview

| Package | Description |
|---------|-------------|
| `atlas-wire` | Shared types, zod schemas |
| `atlas-agent` | `AgentBackend` interface + `ClaudeBackend` implementation |
| `atlas-gateway` | Engine, channels (Feishu/DingTalk), cards, sessions, commands |
| `atlas-app-logs` | Structured JSON logging |
| `atlas-cli` | Entry point — wires agent + gateway + config, starts the service |

### Adding a New Agent Backend

1. Create `packages/atlas-agent/src/backends/myagent/MyAgentBackend.ts` implementing `AgentBackend`
2. Create `packages/atlas-agent/src/backends/myagent/index.ts`:
   ```typescript
   import { agentRegistry } from '../../core/AgentRegistry.js';
   import { MyAgentBackend } from './MyAgentBackend.js';
   agentRegistry.register('myagent', (opts) => new MyAgentBackend(opts));
   ```
3. Import in `packages/atlas-agent/src/backends/index.ts`:
   ```typescript
   import './claude/index.js';
   import './myagent/index.js';  // add this
   ```
4. The new backend auto-registers on import — use it by setting `defaultAgent: "myagent"` in config

### Key Interfaces

```typescript
// AgentBackend — implement this for new AI providers
interface AgentBackend {
  startSession(): Promise<{ sessionId: string }>;
  sendPrompt(sessionId: string, prompt: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  onMessage(handler: (msg: AgentMessage) => void): void;
  offMessage?(handler: (msg: AgentMessage) => void): void;
  dispose(): Promise<void>;
}

// AgentMessage — emitted during streaming
type AgentMessage =
  | { type: 'model-output'; textDelta?: string; fullText?: string }
  | { type: 'status'; status: 'starting' | 'running' | 'idle' | 'stopped' | 'error'; detail?: string }
  | { type: 'tool-use'; toolName: string; input: unknown }
  | { type: 'permission-request'; ... }
  | { type: 'result'; text: string };
```

## Testing

```bash
# All packages
yarn test

# Specific package
yarn workspace atlas-agent test
yarn workspace atlas-gateway test

# Watch mode (in a package directory)
cd packages/atlas-gateway && npx vitest --watch
```

Test coverage: 541+ tests across gateway, 9+ tests for Claude backend.

## Idle Session Notifications

When a session is idle for the configured timeout (default 10 minutes), the bot sends a rich notification:

```
Chat: `oc_xxx`
Agent: `claude`
Last message: 帮我查一下这个 bug 的根因...
Session age: 25 min | Idle: 10 min
Reply `/takeover fac1d46d-...` to take over.
```

Configure the timeout via `ATLAS_IDLE_TIMEOUT` (ms) or `idleTimeoutMs` in `atlas.config.json`.

## Claude Code Hook → Feishu

Send Claude Code events to Feishu in real time. Two hooks included:

- **`hooks/notify-feishu.mjs`** — Notifies on every event
- **`hooks/notify-feishu-filtered.mjs`** — Only code-changing tools (`Bash`, `Write`, `Edit`) + Stop/Error

Quick setup:

```bash
# Set env vars
export FEISHU_APP_ID=cli_xxxxxxxxxxxx
export FEISHU_APP_SECRET=your_secret
export FEISHU_NOTIFY_CHAT=oc_xxxxxxxxxxxx
```

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "type": "command",
        "command": "node /path/to/feishu-ai-assistant/hooks/notify-feishu-filtered.mjs"
      }
    ]
  }
}
```

See [INSTALL.md](./INSTALL.md#claude-code-hook--feishu-notifications) for full documentation.

## License

MIT
