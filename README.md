# Feishu AI Assistant

Feishu/Lark chatbot powered by Claude CLI. Send a message to your bot in Feishu, get a Claude-powered response.

## Architecture

```
Feishu (WebSocket) --> FeishuAdapter --> Router --> SessionQueue --> Claude CLI (-p)
                                                                        |
                                                     --append-system-prompt (SOUL + MEMORY + history)
                                                     --output-format json
                                                     --no-session-persistence
                                                     --add-dir <user workspace>
```

- **Per-session async queue** — messages from the same user are serialized, different users run concurrently
- **Stateless CLI** — no session file locks; conversation history injected via `--append-system-prompt`
- **Per-user workspace** — each user gets `CLAUDE.md`, `MEMORY.md`, `USER.md` in `workspace/agents/{id}/users/{uid}/`
- **WebUI** — config editor + live monitor at http://127.0.0.1:18791

## Prerequisites

- **Node.js** >= 18
- **Claude Code CLI** installed and authenticated (`claude` command available in PATH)
- **Feishu Developer App** with bot capability enabled and `im.message.receive_v1` event subscribed

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/user/feishu-ai-assistant.git
cd feishu-ai-assistant
npm install
```

### 2. Configure Feishu credentials

Create `.env` in the project root:

```bash
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=your_app_secret_here
```

Get these from [Feishu Open Platform](https://open.feishu.cn/app) > Your App > Credentials.

### 3. Verify config.json

The default `config.json` uses `${ENV_VAR}` placeholders that auto-expand from `.env`:

```json
{
  "channels": {
    "feishu": {
      "app_id": "${FEISHU_APP_ID}",
      "app_secret": "${FEISHU_APP_SECRET}",
      "enabled": true
    }
  }
}
```

No need to edit `config.json` directly for credentials.

### 4. Run

**Development** (hot-reload):

```bash
npm run dev
```

**Production**:

```bash
npm run build
npm start
```

### 5. Verify

You should see:

```
{"level":"info","msg":"Configuration loaded"}
{"level":"info","msg":"Workspace initialized"}
[info]: [ 'client ready' ]
[info]: [ 'event-dispatch is ready' ]
{"level":"info","msg":"Feishu adapter started"}
{"level":"info","msg":"Feishu AI Assistant started","adapters":["feishu"],"webui":"http://127.0.0.1:18791"}
```

Send a message to your bot in Feishu. It will reply with Claude's response.

## Feishu App Setup

1. Go to [Feishu Open Platform](https://open.feishu.cn/app) and create an app
2. **Add Bot capability**: App Features > Bot
3. **Subscribe to events**: Event Subscriptions > Add `im.message.receive_v1`
4. **Permissions**: grant `im:message`, `im:message:readonly`, `im:message.reactions:write`
5. **Connection method**: Event Subscriptions > choose **WebSocket** (not HTTP callback)
6. **Publish** the app and approve it in your organization

## Project Structure

```
src/
├── index.ts                  # Entry point, wiring, graceful shutdown
├── config.ts                 # Load config.json + .env, expand ${ENV_VAR}
├── claude/
│   ├── client.ts             # Spawn claude CLI with -p and --append-system-prompt
│   └── context-builder.ts    # Build system prompt (SOUL + AGENTS + MEMORY + history)
├── platform/
│   ├── types.ts              # PlatformAdapter / PlatformSender interfaces
│   ├── registry.ts           # Adapter registry
│   └── feishu/
│       ├── adapter.ts        # Feishu WebSocket adapter (@larksuiteoapi/node-sdk)
│       ├── client.ts         # Send messages, reply, add reactions
│       └── cards.ts          # Interactive card formatting
├── router/
│   └── router.ts             # Message routing: event -> session -> queue -> Claude -> reply
├── session/
│   ├── session.ts            # Conversation history per user
│   ├── manager.ts            # Session lifecycle (TTL cleanup)
│   └── queue.ts              # Per-session serial async queue
├── workspace/
│   └── workspace.ts          # Per-agent/per-user file management
└── webui/
    ├── server.ts             # Express server (config API, secrets, SSE events)
    ├── events.ts             # SSE event bus for live monitoring
    └── static/index.html     # Web console SPA
```

## Configuration

All settings in `config.json`. Key sections:

| Section | Description |
|---------|-------------|
| `agent` | Claude CLI path, timeout (120s), max retries (3), workspace root |
| `channels.feishu` | App credentials (use `${ENV_VAR}`), enable/disable |
| `gateway` | Max sessions (200), session TTL (30m) |
| `webui` | Enable/disable, port (18791) |

Use the WebUI at http://127.0.0.1:18791 to edit config visually.

## WebUI

Auto-starts with the main program on port 18791. Four tabs:

- **Monitor** — live logs and message feed via SSE
- **Configuration** — tree editor for config.json
- **Secrets** — manage environment variables
- **Status** — uptime, platform info

## Documentation

| Document | Description |
|----------|-------------|
| [doc/memory.md](./doc/memory.md) | Change log and architecture notes |
| [go-archive/](./go-archive/) | Archived Go v1 implementation |
