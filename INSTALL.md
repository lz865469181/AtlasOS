# Installation Guide

Step-by-step guide to deploy **Feishu AI Assistant (Atlas AI)** on a new machine.

## Prerequisites

| Dependency | Version | Check |
|-----------|---------|-------|
| Node.js | >= 18 | `node -v` |
| Yarn | 1.x | `yarn -v` |
| Git | any | `git --version` |

## 1. Clone & Install

```bash
git clone https://github.com/lz865469181/AtlasOS.git feishu-ai-assistant
cd feishu-ai-assistant
yarn install
```

## 2. Configure Credentials

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# ── Required ──────────────────────────────────────

# Feishu/Lark bot credentials
# Get from: https://open.feishu.cn/app > Your App > Credentials
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=your_app_secret_here

# Anthropic API key
# Get from: https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxx

# ── Optional ──────────────────────────────────────

# DingTalk (if using DingTalk channel)
# DINGTALK_APP_KEY=your_dingtalk_app_key
# DINGTALK_APP_SECRET=your_dingtalk_app_secret
# DINGTALK_MODE=stream

# Claude model settings
# CLAUDE_MODEL=claude-sonnet-4-6
# CLAUDE_MAX_TOKENS=8192
# CLAUDE_SYSTEM_PROMPT=You are a helpful assistant.

# System settings
# ATLAS_IDLE_TIMEOUT=600000
# ATLAS_LOG_LEVEL=info
```

### Alternative: Config File

For richer configuration, create `atlas.config.json` at the project root:

```json
{
  "channels": {
    "feishu": {
      "appId": "cli_xxxxxxxxxxxx",
      "appSecret": "your_app_secret_here"
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

Config resolution: `atlas.config.json` → `.env` → runtime overrides (later wins).

## 3. Feishu App Setup

Before starting the service, create and configure a Feishu bot:

1. Go to [Feishu Open Platform](https://open.feishu.cn/app) > **Create Enterprise App**
2. **Add Bot capability**: App Features > Bot
3. **Subscribe to events**: Event Subscriptions > Add `im.message.receive_v1`
4. **Grant permissions**: `im:message`, `im:message:readonly`
5. **Connection method**: Event Subscriptions > choose **WebSocket** (not HTTP callback)
6. **Publish** the app and approve it in your organization
7. Copy **App ID** and **App Secret** to your `.env` file

## 4. Build

```bash
yarn build
```

This builds all packages in dependency order:
`atlas-wire` → `atlas-agent` → `atlas-app-logs` → `atlas-gateway` → `atlas-cli`

## 5. Start

```bash
# Foreground (see logs directly)
yarn start

# Or use dev mode with hot reload
yarn dev
```

Expected output:

```
[atlas] Feishu adapter started
[atlas] Started — active channels: feishu
```

## 6. Verify

1. Open Feishu and find your bot (by the app name you configured)
2. Send any message — the bot calls Claude API and streams the response back
3. You should see streaming text responses in the chat
4. Try `/help` to see all available slash commands
5. Try `/list` to see active sessions with recent chat history
6. Reply in a Feishu thread/topic — the bot creates a separate session for each thread

## Running as a Background Service

### PM2 (Recommended)

```bash
npm install -g pm2

# Start
cd /path/to/feishu-ai-assistant
pm2 start "yarn start" --name atlas-ai

# Auto-restart on boot
pm2 save
pm2 startup

# Manage
pm2 status
pm2 logs atlas-ai
pm2 restart atlas-ai
```

### systemd (Linux)

Create `/etc/systemd/system/atlas-ai.service`:

```ini
[Unit]
Description=Atlas AI (Feishu AI Assistant)
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/path/to/feishu-ai-assistant
ExecStart=/usr/bin/yarn start
Restart=on-failure
EnvironmentFile=/path/to/feishu-ai-assistant/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable atlas-ai
sudo systemctl start atlas-ai
sudo systemctl status atlas-ai
```

## Configuration Reference

### All Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FEISHU_APP_ID` | Yes* | — | Feishu bot App ID |
| `FEISHU_APP_SECRET` | Yes* | — | Feishu bot App Secret |
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key for Claude |
| `DINGTALK_APP_KEY` | No | — | DingTalk App Key |
| `DINGTALK_APP_SECRET` | No | — | DingTalk App Secret |
| `DINGTALK_MODE` | No | `webhook` | `stream` or `webhook` |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-6` | Claude model ID |
| `CLAUDE_MAX_TOKENS` | No | `8192` | Max response tokens |
| `CLAUDE_SYSTEM_PROMPT` | No | *(none)* | System prompt |
| `AGENT_CWD` | No | `.` | Agent working directory |
| `AGENT_DEFAULT_AGENT` | No | `claude` | Default agent backend |
| `AGENT_PERMISSION_MODE` | No | `auto` | `auto` / `confirm` / `deny` |
| `ATLAS_IDLE_TIMEOUT` | No | `600000` | Idle timeout in ms (10 min) |
| `ATLAS_LOG_LEVEL` | No | `info` | `debug` / `info` / `warn` / `error` |

*At least one channel (Feishu or DingTalk) must be configured.

### Config Schema (atlas.config.json)

```typescript
{
  channels: {
    feishu?: { appId: string; appSecret: string; verificationToken?: string };
    dingtalk?: { appKey: string; appSecret: string; mode: 'stream' | 'webhook' };
  };
  agent: {
    cwd: string;                           // default: '.'
    env?: Record<string, string>;          // passed to agent backend
    defaultAgent: string;                  // default: 'claude'
    defaultModel?: string;
    defaultPermissionMode: 'auto' | 'confirm' | 'deny';  // default: 'auto'
  };
  idleTimeoutMs: number;                   // default: 600000 (10 min)
  logLevel: 'debug' | 'info' | 'warn' | 'error';  // default: 'info'
}
```

## Monorepo Structure

```
feishu-ai-assistant/
├── .env                          # Credentials (git-ignored)
├── .env.example                  # Template
├── atlas.config.json             # Optional config file
├── package.json                  # Yarn workspaces root
├── packages/
│   ├── atlas-wire/               # Shared types & zod schemas
│   ├── atlas-agent/              # Agent abstraction layer
│   │   └── src/
│   │       ├── core/             # AgentBackend, AgentMessage, AgentRegistry
│   │       ├── backends/
│   │       │   └── claude/       # ClaudeBackend (Anthropic SDK)
│   │       └── transport/        # Transport abstractions
│   ├── atlas-gateway/            # Engine, channels, cards, sessions
│   │   └── src/
│   │       ├── engine/           # Engine, SessionManager, IdleWatcher, CommandRegistry
│   │       │   └── commands/     # Slash commands (new, cancel, agent, model, list, etc.)
│   │       ├── channel/          # Feishu/DingTalk adapters
│   │       ├── cards/            # Interactive card system
│   │       └── config/           # ConfigLoader, ConfigSchema
│   ├── atlas-app-logs/           # Structured logging
│   └── atlas-cli/                # Entry point
│       └── src/
│           ├── index.ts          # Main entry (loads config, starts app)
│           └── createApp.ts      # Wires all components together
└── src/                          # Legacy v1 code (being migrated)
```

## Adding a New Agent Backend

The agent system uses a registry pattern. To add a new AI provider:

1. **Create the backend** at `packages/atlas-agent/src/backends/myagent/MyAgentBackend.ts`:

```typescript
import type { AgentBackend, StartSessionResult } from '../../core/AgentBackend.js';
import type { AgentMessage, AgentMessageHandler, SessionId } from '../../core/AgentMessage.js';
import type { AgentFactoryOptions } from '../../core/AgentRegistry.js';

export class MyAgentBackend implements AgentBackend {
  private handlers = new Set<AgentMessageHandler>();

  constructor(opts: AgentFactoryOptions) {
    // Initialize your AI client using opts.env for API keys
  }

  onMessage(handler: AgentMessageHandler): void { this.handlers.add(handler); }
  offMessage(handler: AgentMessageHandler): void { this.handlers.delete(handler); }
  private emit(msg: AgentMessage): void { for (const h of this.handlers) h(msg); }

  async startSession(): Promise<StartSessionResult> {
    const sessionId = crypto.randomUUID();
    this.emit({ type: 'status', status: 'starting' });
    this.emit({ type: 'status', status: 'idle' });
    return { sessionId };
  }

  async sendPrompt(sessionId: SessionId, prompt: string): Promise<void> {
    this.emit({ type: 'status', status: 'running' });
    // Call your AI API, emit model-output events for streaming
    this.emit({ type: 'model-output', textDelta: 'Hello' });
    this.emit({ type: 'model-output', fullText: 'Hello world' });
    this.emit({ type: 'status', status: 'idle' });
  }

  async cancel(sessionId: SessionId): Promise<void> { /* abort */ }
  async dispose(): Promise<void> { /* cleanup */ }
}
```

2. **Register it** at `packages/atlas-agent/src/backends/myagent/index.ts`:

```typescript
import { agentRegistry } from '../../core/AgentRegistry.js';
import { MyAgentBackend } from './MyAgentBackend.js';
agentRegistry.register('myagent', (opts) => new MyAgentBackend(opts));
```

3. **Import** in `packages/atlas-agent/src/backends/index.ts`:

```typescript
import './claude/index.js';
import './myagent/index.js';  // add this line
```

4. **Use it** by setting `AGENT_DEFAULT_AGENT=myagent` in `.env` or `"defaultAgent": "myagent"` in `atlas.config.json`.

The backend auto-registers via the import side-effect chain — no hooks or manual wiring needed.

## Claude Code Hook → Feishu Notifications

Send Claude Code events (tool calls, errors, completion) to a Feishu chat in real time.

### Setup

1. **Set environment variables** (in your shell profile or `.env`):

```bash
export FEISHU_APP_ID=cli_xxxxxxxxxxxx
export FEISHU_APP_SECRET=your_app_secret_here
export FEISHU_NOTIFY_CHAT=oc_xxxxxxxxxxxx   # target chat ID
```

To find your chat ID: send any message to the bot → check server logs for the `chatId` field.

2. **Configure Claude Code hooks** in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "type": "command",
        "command": "node /path/to/feishu-ai-assistant/hooks/notify-feishu-filtered.mjs"
      }
    ],
    "Stop": [
      {
        "type": "command",
        "command": "node /path/to/feishu-ai-assistant/hooks/notify-feishu.mjs"
      }
    ]
  }
}
```

### Two Hook Variants

| Hook | File | Description |
|------|------|-------------|
| **Full** | `hooks/notify-feishu.mjs` | Notifies on every event — useful for debugging |
| **Filtered** | `hooks/notify-feishu-filtered.mjs` | Only notifies on `Bash`, `Write`, `Edit` tool calls + Stop/Error events |

### Filtering Configuration

The filtered hook only sends notifications for code-changing tools by default. Customize via:

```bash
# Only notify on Bash commands (default: Bash,Write,Edit)
export FEISHU_NOTIFY_TOOLS=Bash

# Notify on all tools that modify files
export FEISHU_NOTIFY_TOOLS=Bash,Write,Edit,NotebookEdit
```

### Available Hook Events

| Claude Code Event | When it fires |
|-------------------|---------------|
| `PreToolUse` | Before a tool is executed |
| `PostToolUse` | After a tool finishes |
| `Stop` | When Claude Code session ends |
| `Notification` | System notifications |

### Hook Data

Claude Code pipes JSON to the hook's stdin with these fields:

| Field | Description |
|-------|-------------|
| `hook_event_name` | Event type (`PostToolUse`, `Stop`, etc.) |
| `tool_name` | Tool name (`Bash`, `Read`, `Write`, etc.) |
| `tool_input` | Tool input (command, file path, etc.) |
| `tool_output` | Tool output/result |
| `session_id` | Claude Code session ID |

### Example Notification in Feishu

```
🔧 [Claude Code] PostToolUse
Session: a1b2c3d4...
Tool: Bash
Input: {"command":"yarn test"}
Output: ✓ 541 tests passed
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Unknown agent: claude` | Missing `ANTHROPIC_API_KEY` in `.env`, or `atlas-agent` not built |
| `Cannot create Feishu sender` | `FEISHU_APP_ID` / `FEISHU_APP_SECRET` not set |
| `At least one channel must be configured` | Set Feishu or DingTalk credentials in `.env` |
| Bot connected but no response | Check `ANTHROPIC_API_KEY` is valid; check logs for API errors |
| `yarn build` fails | Run `yarn install` first; ensure Node.js >= 18 |
| `@vitest/mocker` missing | Run `yarn install` (it's in devDependencies) |
| Idle notifications show bare UUIDs | Update to latest version — now shows chat/agent/message context |
| Slash commands not intercepted | Kill all node processes and restart — multiple instances compete for WebSocket |
| `/list` shows "No active sessions" | Sessions are created when you send a regular message, not by commands |
