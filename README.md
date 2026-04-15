# CodeLink

`claude-codex-lark-bridge` bridges local Claude Code and Codex runtimes into Feishu/Lark and DingTalk with thread-aware routing, streaming cards, permission handling, and tmux-backed remote attach for the primary local interaction path.

## Architecture

CodeLink uses a dual-layer model:

- `RuntimeSession` represents a real Claude or Codex runtime.
- `ConversationBinding` maps a chat thread to one active runtime plus any attached alternatives.

That split lets `/new`, `/attach`, `/switch`, `/detach`, and `/sessions` behave cleanly without mixing transport state and chat state.

Each thread now supports one primary interactive runtime plus multiple secondary watching runtimes. The active runtime receives normal prompts and detailed output; watching runtimes are meant for status checks, completion awareness, and on-demand promotion back to active.
Watching runtimes accumulate unread summaries and emit lightweight reminders for completion, error, and approval-needed events instead of streaming full output into the thread. Active and watch cards both expose lightweight `Latest / Status` view toggles, and watch cards keep `Focus Runtime` plus `Stop Watching` so the thread stays compact until you expand the view you need.

For tmux-backed Feishu runtimes, `file` and `image` attachments can now be materialized into local files before prompt injection. CodeLink saves them under `.codelink/uploads/<runtime-id>/...` beneath the runtime working directory and forwards a textual prompt containing the saved path into the tmux session. `audio` attachments are still ignored for runtime bridging.

## Monorepo Layout

```text
packages/
|- atlas-wire/        # Directory name kept for compatibility, workspace package: codelink-wire
|- atlas-agent/       # Agent abstraction and provider backends, workspace package: codelink-agent
|- atlas-gateway/     # Engine, runtime bridge, commands, cards, workspace package: codelink-gateway
|- atlas-app-logs/    # Structured log sink, workspace package: codelink-app-logs
\- atlas-cli/         # Main entrypoint and runtime helper, workspace package: codelink-cli
```

The top-level `src/` tree is retired legacy scaffolding. The active implementation lives under `packages/*`.

## Quick Start

```bash
git clone https://github.com/lz865469181/claude-codex-lark-bridge.git
cd claude-codex-lark-bridge
yarn install
cp .env.example .env
yarn build
yarn start
```

Detailed setup is in `INSTALL.md`.

## Configuration

Primary config inputs:

- `.env`
- `codelink.config.json`

Compatibility inputs still supported:

- `atlas.config.json`
- `ATLAS_*` runtime env aliases

Important environment variables:

| Variable | Purpose |
|---|---|
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | Feishu/Lark bot credentials |
| `DINGTALK_APP_KEY` / `DINGTALK_APP_SECRET` | DingTalk bot credentials |
| `DINGTALK_MODE` | `stream` or `webhook` |
| `AGENT_CWD` | Working directory for CodeLink-managed runtimes |
| `CODELINK_IDLE_TIMEOUT` / `ATLAS_IDLE_TIMEOUT` | Idle notification timeout in milliseconds |
| `CODELINK_LOG_LEVEL` / `ATLAS_LOG_LEVEL` | Log level |
| `CODELINK_RUNTIME_API_PORT` / `ATLAS_RUNTIME_API_PORT` | Runtime registration API port, default `20263` |
| `CODELINK_RUNTIME_SERVER_URL` / `ATLAS_RUNTIME_SERVER_URL` | Runtime helper API base URL |
| `CODELINK_RUNTIME_CWD` / `ATLAS_RUNTIME_CWD` | Working directory for tmux-launched external runtimes |
| `CODELINK_RUNTIME_PROVIDER` / `ATLAS_RUNTIME_PROVIDER` | Default external runtime provider, `claude` or `codex` |
| `CODELINK_TMUX_BIN` / `ATLAS_TMUX_BIN` / `TMUX_BIN` | tmux binary path override |
| `CLAUDE_CLI_PATH` | Claude CLI path used by `codelink-runtime start` |
| `CODEX_CLI_PATH` | Codex CLI path used by `codelink-runtime start` |

Config precedence:

```text
codelink.config.json -> atlas.config.json -> .env -> runtime overrides
```

## Slash Commands

| Command | Description |
|---|---|
| `/new` | Create a new runtime and switch this thread to it |
| `/agent <id>` | Create a runtime from another backend/provider |
| `/model <name>` | Set model metadata on the active runtime |
| `/mode <mode>` | Set permission mode on the active runtime |
| `/status` | Show runtime provider, transport, model, mode, uptime, and runtime ID |
| `/list` | List thread bindings and known runtimes in the current chat |
| `/attach <name|id>` | Attach an existing runtime to this thread |
| `/discover` | List local tmux sessions that can be adopted from chat |
| `/adopt [--provider claude|codex] <tmux-session> [name]` | Register an existing local tmux session and attach this thread to it |
| `/pair <active-name|id> <watch-name|id>` | Attach two runtimes, set the first active, and set the second watching |
| `/tmux [--provider claude|codex] [name]` | Start a local tmux-backed runtime from chat and attach this thread to it |
| `/focus <number|name|id>` | Promote another attached runtime to active |
| `/switch <number|name|id>` | Alias for `/focus` |
| `/watch <number|name|id>` | Add an attached runtime to the watching set for this thread |
| `/unwatch [number|name|id]` | Stop watching one runtime, or clear all watchers when no target is provided |
| `/detach` | Detach the current runtime from this thread |
| `/destroy <id|all>` | Destroy runtimes |
| `/sessions` | List runtimes attached to this thread |
| `/cancel` | Cancel the current runtime execution |
| `/help` | Show command help |

## tmux External Runtimes

tmux is the recommended primary interaction path when you want to take over a real local Claude Code or Codex session from Feishu/DingTalk.

Managed runtimes still exist as a supplement:

- use tmux-backed runtimes when you want chat to control an already-running local coding session
- use managed runtimes when you want CodeLink to create an SDK-driven runtime directly
- `/new` now prefers tmux-backed runtimes for local `claude` and `codex` defaults when local tmux management is available; non-tmux agents such as `gemini` still fall back to managed SDK runtimes

tmux is still optional for the base service. Install it when you want to bridge an already-running local Claude Code or Codex session into Feishu/DingTalk.
If `tmux` is missing locally, `/tmux` and `codelink-runtime start|discover|adopt` now return explicit install guidance instead of only exposing the raw spawn error.
On Windows, `psmux` is a workable native substitute for this project because it exposes the tmux-compatible commands CodeLink uses. Install it with `winget install -e --id marlocarlo.psmux`, then restart the shell or point `CODELINK_TMUX_BIN` at the installed `psmux.exe`.

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

Behavior:

- `start` creates a new detached tmux session, launches the selected CLI inside it, registers that session as an external runtime, and prints both the local `tmux attach` command and the chat `/attach` command.
- `discover` lists local tmux sessions that can be adopted.
- `adopt` registers an existing tmux session without creating or killing it.
- Feishu can also create tmux-backed local runtimes directly from chat with `/tmux [--provider claude|codex] [name]`.
- Feishu can discover and adopt local tmux sessions directly from chat with `/discover` and `/adopt [--provider claude|codex] <tmux-session> [name]`.
- Feishu `/attach` and DingTalk `/attach` bind to that same tmux-backed runtime instead of shelling into `tmux attach`.
- Re-adopting the same `provider + tmux session` reuses the existing runtime registration.

Examples from chat:

- `/tmux feature-lab` starts a local Claude Code tmux session and attaches the current thread to it.
- `/tmux --provider codex spec-review` starts a local Codex tmux session and attaches the current thread to it.
- `/discover` lists local tmux sessions and tells you which ones are already registered.
- `/adopt --provider codex codex-lab spec-review` registers an existing local tmux session and binds the current thread to it.
- `/pair dev-shell ops-shell` attaches both runtimes, keeps `dev-shell` active, and marks `ops-shell` as watching in one step.
- Active and watch cards expose `Latest / Status` buttons so you can switch views without generating extra reply messages.

Current recommendation:

- for local Claude Code / Codex workflows, use `/new`, `/tmux`, `/discover`, and `/adopt` directly from Feishu when possible; `codelink-runtime start|adopt` remains useful for local shell-driven setup
- treat managed Codex/Claude runtimes as a fallback or lightweight direct-start option

The standalone helper binary is `codelink-runtime`. `atlas-runtime` remains available as a compatibility alias.

## External Runtime HTTP Bridge

For advanced integrations, CodeLink also exposes a small polling bridge for externally managed runtimes. This is the secondary path behind tmux-backed local sessions.

Register a runtime first:

```bash
POST /api/runtimes/register
{
  "runtimeId": "runtime-external-1",
  "source": "external",
  "provider": "claude",
  "transport": "bridge",
  "displayName": "bridge-runtime"
}
```

Then use the runtime bridge endpoints:

- `GET /api/runtimes/:runtimeId/inbox` drains queued chat actions for that runtime. Items are `prompt`, `cancel`, or `permission-response`.
- `POST /api/runtimes/:runtimeId/events` pushes one `message` object or a `messages` array back into CodeLink card rendering.
- `POST /api/runtimes/:runtimeId/events` returns `400` when neither `message` nor `messages` is provided.
- `POST /api/runtimes/:runtimeId/events` and `GET /api/runtimes/:runtimeId/inbox` return `404` when the runtime is unknown.

Message ingestion can optionally include `chatId` to override the runtime's remembered chat binding for that event batch.

## Development

```bash
yarn install
yarn build
yarn test
yarn dev
yarn start
yarn runtime --help
```

Package-scoped examples:

```bash
yarn workspace codelink-agent test
yarn workspace codelink-gateway test
yarn workspace codelink-cli test
```

## Verification

Primary verification commands:

```bash
yarn test
yarn build
```
