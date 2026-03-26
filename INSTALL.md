# Installation Guide

Step-by-step guide to deploy **Feishu AI Assistant** on a new machine (Windows / macOS / Linux).

All runtime configuration lives in `~/.atlasOS/`. On first run, the app auto-creates `config.json` and `.env` there.

## Quick Deploy (TL;DR)

```bash
# 1. Clone & install
git clone https://github.com/lz865469181/AtlasOS.git feishu-ai-assistant
cd feishu-ai-assistant
npm install
npm run build

# 2. Install Claude CLI (if not installed)
npm install -g @anthropic-ai/claude-code
claude auth login

# 3. First run — auto-creates ~/.atlasOS/config.json and ~/.atlasOS/.env
npm start
# [bootstrap] Created default config.json → ~/.atlasOS/config.json
# [bootstrap] Created .env template → ~/.atlasOS/.env

# 4. Edit credentials
#    Windows:  notepad %USERPROFILE%\.atlasOS\.env
#    macOS/Linux:  nano ~/.atlasOS/.env
# Set FEISHU_APP_ID and FEISHU_APP_SECRET

# 5. Configure Feishu App (web UI):
#    https://open.feishu.cn/app → Create Enterprise App
#    - Add Bot capability: App Features > Bot
#    - Subscribe events: Event Subscriptions > Add im.message.receive_v1
#    - Grant permissions: im:message, im:message:readonly, im:message.reactions:write
#    - Connection method: Event Subscriptions > WebSocket
#    - Publish & approve in your organization

# 6. Restart the server
npm start

# 7. Verify
#    - Browser: http://127.0.0.1:20263 (WebUI console)
#    - Feishu: send a message to your bot, should get AI reply

# 8. beam-flow session bridging (optional)
npm run beam start my-task       # start a Claude session locally
# after exit, session auto-parks
# in Feishu: /sessions → /resume my-task

# 9. Run as background service (optional)
npm install -g pm2
pm2 start dist/index.js --name feishu-ai-assistant
pm2 save && pm2 startup
```

---

## Detailed Guide

## Prerequisites

| Dependency | Version | Check |
|-----------|---------|-------|
| Node.js | >= 18 | `node -v` |
| npm | >= 9 | `npm -v` |
| Git | any | `git --version` |
| Claude Code CLI | latest | `claude --version` |

### Install Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
claude --version
claude auth login   # one-time authentication
```

## 1. Clone & Install

```bash
git clone https://github.com/lz865469181/AtlasOS.git feishu-ai-assistant
cd feishu-ai-assistant
npm install
```

## 2. Build

```bash
npm run build
```

This compiles TypeScript to `dist/` and registers the `beam-flow` CLI via the `bin` field in `package.json`.

## 3. First Run (Auto-Bootstrap)

```bash
npm start
```

On first run, the app automatically creates:

| File | Description |
|------|-------------|
| `~/.atlasOS/config.json` | Copied from project template, or created with defaults |
| `~/.atlasOS/.env` | Copied from project `.env`, or created with placeholder |

You'll see:
```
[bootstrap] Copied config.json → ~/.atlasOS/config.json
[bootstrap] Created .env template → ~/.atlasOS/.env
```

## 4. Configure Credentials

Edit `~/.atlasOS/.env`:

```bash
# Windows
notepad %USERPROFILE%\.atlasOS\.env

# macOS / Linux
nano ~/.atlasOS/.env
```

Set these values:

```bash
# Required: Feishu bot credentials
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=your_app_secret_here

# Optional: for Claude API mode (not CLI mode)
ANTHROPIC_API_KEY=sk-ant-xxx
```

Get Feishu credentials from [Feishu Open Platform](https://open.feishu.cn/app) > Your App > Credentials.

## 5. Configure `~/.atlasOS/config.json`

The default config works out of the box for Claude CLI backend + Feishu. Key sections to review:

```jsonc
{
  "agent": {
    "backend": "claude",           // claude | codex | gemini | cursor | opencode
    "claude_cli_path": "claude",   // path to claude CLI executable
    "timeout": "120s",
    "max_retries": 3
  },
  "channels": {
    "feishu": {
      "app_id": "${FEISHU_APP_ID}",       // reads from ~/.atlasOS/.env
      "app_secret": "${FEISHU_APP_SECRET}",
      "enabled": true
    }
  },
  "webui": {
    "enabled": true,
    "port": 20263
  }
}
```

### Feishu App Setup

1. Go to [Feishu Open Platform](https://open.feishu.cn/app) > Create Enterprise App
2. **Add Bot capability**: App Features > Bot
3. **Subscribe to events**: Event Subscriptions > Add `im.message.receive_v1`
4. **Permissions**: grant `im:message`, `im:message:readonly`, `im:message.reactions:write`
5. **Connection method**: Event Subscriptions > choose **WebSocket**
6. **Publish** the app and approve it in your organization

## 6. Run

```bash
# Development (hot-reload)
npm run dev

# Production
npm run build && npm start
```

Expected output:

```
{"level":"info","msg":"Configuration loaded"}
{"level":"info","msg":"Workspace initialized"}
{"level":"info","msg":"Engine started","platforms":["feishu"],"webui":"http://127.0.0.1:20263"}
```

## 7. Verify

- Open `http://127.0.0.1:20263` in your browser to see the WebUI console
- Send a message to your bot in Feishu — it should reply with Claude's response

## beam-flow CLI

After `npm install` and `npm run build`, the `beam-flow` command is available:

```bash
# Run via npm script (development)
npm run beam start my-session
npm run beam sessions
npm run beam park
npm run beam drop my-session

# Run the built JS directly (works from any directory)
node dist/cli/beam-flow.js --help
node dist/cli/beam-flow.js -d sessions    # -d starts server daemon first
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BEAM_SERVER_URL` | `http://127.0.0.1:20263` | Server URL for beam-flow API |
| `CLAUDE_CLI_PATH` | `claude` | Path to the Claude CLI executable |
| `FEISHU_APP_ID` | — | Feishu app ID (in `~/.atlasOS/.env`) |
| `FEISHU_APP_SECRET` | — | Feishu app secret (in `~/.atlasOS/.env`) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (optional, for API mode) |

## Directory Structure

All runtime data and configuration lives in `~/.atlasOS/`:

```
~/.atlasOS/
├── config.json               # Runtime configuration
├── .env                      # Credentials (FEISHU_APP_ID, etc.)
└── agents/default/
    ├── sessions.json          # Active session state
    ├── SOUL.md                # Agent personality
    ├── AGENTS.md              # Agent configuration
    └── users/{user-id}/
        ├── CLAUDE.md          # Per-user project instructions
        ├── MEMORY.md          # Per-user conversation memory
        └── USER.md            # Per-user preferences
```

The project directory only contains source code and build output:

```
feishu-ai-assistant/
├── dist/                     # Compiled output (after npm run build)
│   ├── index.js              # Server entry point
│   └── cli/
│       └── beam-flow.js      # CLI entry point
├── src/                      # TypeScript source
├── config.json               # Template config (copied to ~/.atlasOS/ on first run)
├── package.json
└── node_modules/
```

## Running as a Service (Optional)

### Using PM2

```bash
npm install -g pm2
pm2 start dist/index.js --name feishu-ai-assistant
pm2 save
pm2 startup   # auto-start on boot
```

### Using systemd (Linux)

Create `/etc/systemd/system/feishu-ai-assistant.service`:

```ini
[Unit]
Description=Feishu AI Assistant
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/path/to/feishu-ai-assistant
ExecStart=/usr/bin/node /path/to/feishu-ai-assistant/dist/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

> Note: No `EnvironmentFile` needed — credentials are loaded from `~/.atlasOS/.env` automatically.

```bash
sudo systemctl enable feishu-ai-assistant
sudo systemctl start feishu-ai-assistant
sudo systemctl status feishu-ai-assistant
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `claude: command not found` | Install Claude CLI: `npm install -g @anthropic-ai/claude-code` |
| `Configuration loaded` then crash | Check `~/.atlasOS/.env` has valid `FEISHU_APP_ID` and `FEISHU_APP_SECRET` |
| Feishu bot not responding | Verify WebSocket mode is enabled in Feishu app settings |
| `EADDRINUSE` port error | Another process is using port 20263. Change `webui.port` in `~/.atlasOS/config.json` |
| `fetch failed` in beam-flow | Server not running. Start it first with `npm start` or use `-d` flag |
| Config not updating | Config lives at `~/.atlasOS/config.json`, not in the project root |
