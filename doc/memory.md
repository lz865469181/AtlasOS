# Feishu AI Assistant — Change Log

## Overview

AI assistant for Feishu/Lark powered by Claude CLI. Rewritten from Go to TypeScript (v2.0.0) on 2026-03-20.

---

## Architecture (v2.0 — TypeScript)

```
Feishu SDK (WS) → FeishuAdapter → Router → SessionQueue → ClaudeClient → claude CLI (-p --output-format json)
                                                                              ↕
                                                          ContextBuilder (SOUL + MEMORY + conversation history)
```

Key design decisions:
- `--no-session-persistence` instead of `--session-id` (avoids file lock issues)
- Conversation history injected via system prompt (not managed by Claude CLI)
- Per-session async queue (Promise-chain pattern, no global mutex)
- Hot-reload via `tsx watch`

## Project Structure

```
src/
├── index.ts                  # Main entry, wiring, graceful shutdown
├── config.ts                 # Load config.json + .env, expand ${ENV_VAR}
├── claude/
│   ├── client.ts             # ClaudeClient: exec claude CLI with -p --output-format json
│   └── context-builder.ts    # Build system prompt from SOUL + AGENTS + MEMORY + history
├── platform/
│   ├── types.ts              # PlatformAdapter, PlatformSender, MessageEvent interfaces
│   ├── registry.ts           # Adapter registry
│   └── feishu/
│       ├── adapter.ts        # FeishuAdapter wrapping @larksuiteoapi/node-sdk WS
│       ├── client.ts         # Feishu API client (send text/cards, reactions)
│       └── cards.ts          # Card/markdown formatting helpers
├── router/
│   └── router.ts             # Message routing → session → queue → Claude → reply
├── session/
│   ├── session.ts            # Session class (conversation history, timestamps)
│   ├── manager.ts            # SessionManager (get-or-create, TTL cleanup)
│   ├── queue.ts              # SessionQueue (per-session serial async execution)
│   └── index.ts              # Re-exports
├── workspace/
│   └── workspace.ts          # Workspace dir layout (agents, users, SOUL, MEMORY)
└── webui/
    ├── server.ts             # Express server (config API, secrets, SSE events)
    ├── events.ts             # SSE event bus (ring buffer, pub/sub)
    └── static/index.html     # SPA (Monitor, Config, Secrets, Status tabs)
```

## Config Format

Same `config.json` as Go version. Sections: agent, channels, gateway, health, logging, memory, webui. Secrets use `${ENV_VAR}` placeholders expanded from process.env.

## Dependencies

- `@larksuiteoapi/node-sdk` — Feishu/Lark SDK (WS long connection + API)
- `dotenv` — Load .env file
- `express` — WebUI HTTP server
- `typescript`, `tsx` — Build and dev

## Key Differences from Go Version

| Aspect | Go (v1) | TypeScript (v2) |
|--------|---------|-----------------|
| CLI invocation | `--session-id` (file lock issues) | `--no-session-persistence` (stateless) |
| Conversation context | Claude CLI manages via session | Injected in system prompt |
| Concurrency | Global mutex on agent | Per-session async queue |
| Hot reload | Rebuild binary | `tsx watch` |
| Feishu SDK | `oapi-sdk-go/v3` | `@larksuiteoapi/node-sdk` |
| WebUI | go:embed + net/http | Express + static files |

## WebUI (unchanged functionality)

- URL: http://127.0.0.1:20263
- Tabs: Monitor (live logs + messages via SSE), Configuration (tree editor), Secrets, Status
- Security: localhost-only, CSRF token, input validation
- API: GET/POST /api/config, GET/POST/DELETE /api/secrets, GET /api/status, GET /api/events (SSE)

---

## Change History

### 2026-03-20 — TypeScript rewrite (v2.0.0)

**Go code archived to `go-archive/` directory.**

**Created files:**
- `package.json` — Dependencies, scripts (dev/build/start)
- `tsconfig.json` — ES2022, NodeNext module
- `src/config.ts` — Config loader with ${ENV_VAR} expansion
- `src/session/session.ts` — Session with conversation history
- `src/session/manager.ts` — SessionManager with TTL cleanup
- `src/session/queue.ts` — Per-session serial async queue
- `src/session/index.ts` — Re-exports
- `src/workspace/workspace.ts` — Workspace directory management
- `src/claude/client.ts` — Claude CLI execution with retry
- `src/claude/context-builder.ts` — System prompt builder (SOUL + AGENTS + MEMORY + history)
- `src/platform/types.ts` — Platform adapter interfaces
- `src/platform/registry.ts` — Adapter registry
- `src/platform/feishu/adapter.ts` — Feishu WS adapter
- `src/platform/feishu/client.ts` — Feishu API (send text, cards, reactions)
- `src/platform/feishu/cards.ts` — Card formatting
- `src/router/router.ts` — Message routing logic
- `src/webui/events.ts` — SSE event bus
- `src/webui/server.ts` — Express WebUI server
- `src/webui/static/index.html` — Copied from Go, updated SSE listeners
- `src/index.ts` — Main entry with graceful shutdown

### Pre-rewrite history (Go version)

- 2026-03-19: Initial WebUI console (Config/Secrets/Status tabs)
- 2026-03-19: Tree editor upgrade (replaced raw JSON textarea)
- 2026-03-19: Monitor tab with live logs + messages via SSE
- 2026-03-20: Per-user Claude CLI sessions with CLAUDE.md memory
- 2026-03-20: Stale CLI session lock recovery
