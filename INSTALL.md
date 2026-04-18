# Installation Guide

This guide installs the current `packages/*` implementation of CodeLink in the `claude-codex-lark-bridge` repository.

## Prerequisites

| Dependency | Version |
|---|---|
| Node.js | 18+ |
| Yarn | 1.x |
| Git | any recent version |

The primary local interaction model is platform-aware: Unix hosts use tmux-backed attach, while Windows hosts default to a bridge-managed `node-pty` runtime. Managed runtimes are still available as a supplement.

## 1. Clone And Install

```bash
git clone https://github.com/lz865469181/claude-codex-lark-bridge.git
cd claude-codex-lark-bridge
yarn install
```

## 2. Configure Credentials

Create `.env` if it does not exist:

```bash
cp .env.example .env
```

At minimum, set:

```bash
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=your_app_secret_here
```

Optional settings:

```bash
DINGTALK_APP_KEY=your_dingtalk_app_key
DINGTALK_APP_SECRET=your_dingtalk_app_secret
DINGTALK_MODE=stream

AGENT_CWD=.
CODELINK_IDLE_TIMEOUT=600000
CODELINK_LOG_LEVEL=info
CODELINK_RUNTIME_API_PORT=20263
```

Structured config files:

- Preferred: `codelink.config.json`
- Compatibility fallback: `atlas.config.json`

## 3. Configure Feishu

1. Create an app in Feishu Open Platform.
2. Add the Bot capability.
3. Subscribe to `im.message.receive_v1`.
4. Grant the required message permissions.
5. Use WebSocket mode.
6. Publish the app and approve it in your org.

## 4. Build

```bash
yarn build
```

This builds the workspace packages in dependency order:

```text
codelink-wire -> codelink-agent -> codelink-app-logs -> codelink-gateway -> codelink-cli
```

Directory names on disk remain `packages/atlas-*` for compatibility.

## 5. Start

```bash
yarn start
```

For development:

```bash
yarn dev
```

Expected startup includes the runtime API plus whichever channels you configured.

## 6. Verify In Chat

1. Open Feishu and message the bot.
2. Send a normal message and confirm you receive streamed output.
3. Run `/help`.
4. Run `/new` to create a runtime for the current thread. For local Claude/Codex defaults, this now prefers a local external runtime: tmux on Unix hosts, `node-pty` on Windows hosts.
5. Run `/status` and `/sessions`.
6. Run `/list` to inspect bindings and known runtimes.
7. If you are on a Unix/tmux host and already have local tmux sessions running, use `/discover`, `/adopt ...`, or `/pair ... ...` directly from chat.

## Optional: Bridge A Local Runtime

This is the recommended workflow for local coding sessions that are already running on your machine or that you want the bridge service to launch for you.

Examples:

```bash
yarn runtime start my-task
yarn runtime start --provider codex codex-task
yarn runtime discover
yarn runtime adopt existing-claude my-task
yarn runtime adopt --provider codex codex-lab codex-task
yarn runtime list
yarn runtime drop my-task
```

Requirements:

- Claude CLI installed and reachable as `claude`, or set `CLAUDE_CLI_PATH`
- Codex CLI installed and reachable as `codex`, or set `CODEX_CLI_PATH`
- Unix tmux mode also requires `tmux` installed and reachable as `tmux`, or set `CODELINK_TMUX_BIN`

If tmux is missing, CodeLink now returns an explicit install hint when you use `/tmux` or `codelink-runtime start|discover|adopt` on Unix/tmux hosts, including `brew install tmux`, `apt-get install tmux`, and the `CODELINK_TMUX_BIN` override path.
On Windows PowerShell, the default `yarn runtime start ...` flow does not require tmux because the bridge service starts a local `node-pty` runtime directly. `psmux` remains optional only if you explicitly want tmux-style reusable sessions.

Useful variables:

```bash
CODELINK_RUNTIME_CWD=/path/to/project
CODELINK_RUNTIME_PROVIDER=claude
CODELINK_TMUX_BIN=/usr/bin/tmux
CLAUDE_CLI_PATH=/usr/local/bin/claude
CODEX_CLI_PATH=/usr/local/bin/codex
```

Windows example:

```powershell
yarn runtime start dev-shell
```

Compatibility aliases:

- `ATLAS_RUNTIME_CWD`
- `ATLAS_RUNTIME_PROVIDER`
- `ATLAS_TMUX_BIN`
- `atlas-runtime`

Behavior:

- `discover` lists local tmux sessions that CodeLink can adopt.
- `adopt` registers an existing tmux session and does not kill it when later dropped.
- Re-adopting the same provider and tmux session reuses the existing runtime entry.
- Feishu chat now supports `/discover` and `/adopt [--provider claude|codex] <tmux-session> [name]` directly on Unix/tmux hosts, so you can register existing local sessions without leaving chat.
- Feishu chat also supports `/pair <active-name|id> <watch-name|id>` so one command can attach two runtimes and assign active vs watching roles.
- Feishu `/new` now prefers local external Claude/Codex runtimes. That means tmux on Unix hosts and `node-pty` on Windows hosts.
- Feishu `file` and `image` attachments sent to a local runtime are downloaded into `.codelink/uploads/<runtime-id>/...` inside the runtime working directory, then converted into a textual prompt containing the saved path before prompt injection.
- Feishu `audio` attachments are still not bridged into runtimes.
- Chat `/attach` binds Feishu or DingTalk directly to that local runtime.
- Active and watch cards now expose `Latest / Status` toggles that patch the same card in place instead of sending extra output messages.
- Managed Codex SDK runtimes remain available, but local external runtimes are the main path for taking over local interactive coding sessions.

## Optional: External Runtime HTTP Bridge

This is an advanced integration path for externally managed runtimes. Use it when tmux is not the transport, but you still want CodeLink cards and chat bindings.

Contract summary:

- `POST /api/runtimes/register` creates an external runtime entry. Set `source=external` and `transport=bridge`.
- `GET /api/runtimes/:runtimeId/inbox` drains queued actions from chat. Items are `prompt`, `cancel`, or `permission-response`.
- `POST /api/runtimes/:runtimeId/events` sends one `message` object or a `messages` array back into CodeLink.
- `POST /api/runtimes/:runtimeId/events` returns `400` when the payload has neither `message` nor `messages`.
- `GET /api/runtimes/:runtimeId/inbox` and `POST /api/runtimes/:runtimeId/events` return `404` when the runtime is unknown.

Use tmux when you want to control a real local Claude Code or Codex CLI session. Use the HTTP bridge only for custom runtime adapters.

## Background Service

### PM2

```bash
npm install -g pm2
pm2 start "yarn start" --name codelink
pm2 save
pm2 startup
```

Useful commands:

```bash
pm2 status
pm2 logs codelink
pm2 restart codelink
pm2 stop codelink
```

### systemd

```ini
[Unit]
Description=CodeLink
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/path/to/claude-codex-lark-bridge
ExecStart=/usr/bin/yarn start
Restart=on-failure
EnvironmentFile=/path/to/claude-codex-lark-bridge/.env

[Install]
WantedBy=multi-user.target
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `At least one channel must be configured` | Set Feishu or DingTalk credentials |
| `Cannot create Feishu sender` | Check `FEISHU_APP_ID` and `FEISHU_APP_SECRET` |
| No response from Claude/Codex | Check your provider credentials and local CLI availability |
| `/list` shows no active runtimes | Create one with `/new`, or register one and `/attach` it |
| `yarn build` fails | Run `yarn install` first and ensure Node.js 18+ |
| runtime helper cannot register | Check `CODELINK_RUNTIME_API_PORT` and whether `yarn start` is running |

## Monorepo Structure

```text
claude-codex-lark-bridge/
|- package.json
|- .env
|- .env.example
|- codelink.config.json
|- atlas.config.json        # optional compatibility fallback
|- packages/
|  |- atlas-wire/
|  |- atlas-agent/
|  |- atlas-gateway/
|  |- atlas-app-logs/
|  \- atlas-cli/
\- src/                     # retired legacy entrypoints kept only as stubs
```
