# Installation Guide

Step-by-step guide to deploy **Feishu AI Assistant** on a new machine (Windows / macOS / Linux).

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

## 3. Configure Environment

Create `.env` in the project root:

```bash
# Required: Feishu bot credentials
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=your_app_secret_here

# Optional: for Claude API mode (not CLI mode)
ANTHROPIC_API_KEY=sk-ant-xxx
```

Get Feishu credentials from [Feishu Open Platform](https://open.feishu.cn/app) > Your App > Credentials.

## 4. Configure `config.json`

The default `config.json` works out of the box for Claude CLI backend + Feishu. Key sections to review:

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
      "app_id": "${FEISHU_APP_ID}",       // reads from .env
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

## 5. Run

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

## 6. Verify

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
| `FEISHU_APP_ID` | — | Feishu app ID (required) |
| `FEISHU_APP_SECRET` | — | Feishu app secret (required) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (optional, for API mode) |

## Directory Structure After Install

```
feishu-ai-assistant/
├── .env                  # Your credentials (not committed)
├── config.json           # Runtime configuration
├── dist/                 # Compiled output (after npm run build)
│   ├── index.js          # Server entry point
│   └── cli/
│       └── beam-flow.js  # CLI entry point
├── src/                  # TypeScript source
├── package.json          # bin.beam-flow → dist/cli/beam-flow.js
└── node_modules/
```

Runtime data is stored at:

```
~/.atlasOS/
└── agents/default/
    ├── sessions.json     # Active session state
    └── users/{user-id}/
        ├── CLAUDE.md     # Per-user project instructions
        ├── MEMORY.md     # Per-user conversation memory
        └── USER.md       # Per-user preferences
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
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
EnvironmentFile=/path/to/feishu-ai-assistant/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable feishu-ai-assistant
sudo systemctl start feishu-ai-assistant
sudo systemctl status feishu-ai-assistant
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `claude: command not found` | Install Claude CLI: `npm install -g @anthropic-ai/claude-code` |
| `Configuration loaded` then crash | Check `.env` has valid `FEISHU_APP_ID` and `FEISHU_APP_SECRET` |
| Feishu bot not responding | Verify WebSocket mode is enabled in Feishu app settings |
| `EADDRINUSE` port error | Another process is using port 20263. Change `webui.port` in `config.json` |
| `fetch failed` in beam-flow | Server not running. Start it first with `npm start` or use `-d` flag |
