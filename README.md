# CodeLink

`claude-codex-lark-bridge` bridges local Claude Code and Codex runtimes into Feishu/Lark and DingTalk with thread-aware routing, streaming cards, permission handling, and optional tmux-backed remote attach.

## Architecture

CodeLink uses a dual-layer model:

- `RuntimeSession` represents a real Claude or Codex runtime.
- `ConversationBinding` maps a chat thread to one active runtime plus any attached alternatives.

That split lets `/new`, `/attach`, `/switch`, `/detach`, and `/sessions` behave cleanly without mixing transport state and chat state.

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
| `/switch <number|name|id>` | Switch to another attached runtime |
| `/detach` | Detach the current runtime from this thread |
| `/destroy <id|all>` | Destroy runtimes |
| `/sessions` | List runtimes attached to this thread |
| `/cancel` | Cancel the current runtime execution |
| `/help` | Show command help |

## tmux External Runtimes

tmux is optional for the main service. Install it only if you want to bridge an already-running local Claude Code or Codex session into Feishu/DingTalk.

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
- Feishu `/attach` and DingTalk `/attach` bind to that same tmux-backed runtime instead of shelling into `tmux attach`.
- Re-adopting the same `provider + tmux session` reuses the existing runtime registration.

The standalone helper binary is `codelink-runtime`. `atlas-runtime` remains available as a compatibility alias.

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
