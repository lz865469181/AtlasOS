# AI Assistant Platform — V1 Design Specification

> Date: 2026-03-19
> Scope: Gateway + Channel(Feishu) + Agent Runtime (SOUL.md / MEMORY.md / 4 tools)
> Deferred: Context Database (OpenViking), Node (camera/screen/system.run)

---

## 1. Overview

An AI Assistant platform inspired by OpenClaw architecture. User messages flow through Channel → Gateway → Claude CLI Agent, with each Agent having an isolated filesystem workspace, immutable identity (SOUL.md), per-user long-term memory (MEMORY.md), and self-extending skill capabilities.

**V1 delivers:**
- Gateway: WebSocket control plane (`ws://127.0.0.1:18789`), session tree management, agent scheduling
- Channel: Feishu bot via WebSocket (abstracted interface for future platforms)
- Agent Runtime: Claude CLI subprocess, 4 core tools, SOUL/MEMORY/Skill system

**Architecture approach:** Single Go binary (monolith). Internal interfaces designed for future microservice split.

---

## 2. Architecture

```
IM Platforms                     Channel Layer                      Gateway
───────────                      ─────────────                      ───────
                              ┌─────────────────┐
Feishu Bot  ◄──ws──►         │ FeishuChannel    │──┐
                              └─────────────────┘  │
                              ┌─────────────────┐  │  Channel
Telegram ◄──ws──► (future)   │ TelegramChannel  │──┤  Interface
                              └─────────────────┘  │
                              ┌─────────────────┐  │
Discord ◄──ws──► (future)    │ DiscordChannel   │──┤
                              └─────────────────┘  │
                                                    ▼
                              ┌──────────────────────────────────┐
                              │            Gateway                │
                              │  ws://127.0.0.1:18789            │
                              │  ├── MessageRouter                │
                              │  ├── SessionManager (tree)        │
                              │  ├── AgentScheduler               │
                              │  ├── CommandHandler               │
                              │  └── HeartbeatScheduler           │
                              └──────────────┬───────────────────┘
                                             │
                                             ▼
                              ┌──────────────────────────────────┐
                              │          Agent Runtime            │
                              │  agents/{agent-id}/               │
                              │  ├── SOUL.md       (immutable)    │
                              │  ├── AGENTS.md     (behavior)     │
                              │  ├── users/{uid}/                 │
                              │  │   ├── USER.md                  │
                              │  │   └── MEMORY.md                │
                              │  ├── HEARTBEAT.md                 │
                              │  ├── memory/YYYY-MM-DD.md         │
                              │  ├── skills/*.md                  │
                              │  └── sessions.json                │
                              │                                    │
                              │  Claude CLI ◄──pipe──► subprocess  │
                              │  Tools: Read, Write, Edit, Bash   │
                              └──────────────────────────────────┘
```

## 3. Channel Layer

All channels use WebSocket (not webhook). Unified Channel interface.

```
Interface: Channel {
    Connect(ctx)          // WebSocket to IM platform
    Disconnect()          // Graceful close
    Reconnect(ctx)        // Auto-reconnect
    OnMessage(handler)    // Inbound handler
    SendReply(ctx, reply) // Send response
    Type() string         // "feishu" | "telegram"
    Status()              // connected | disconnected
}
```

## 4. Session — Tree Structure

```
main ────●────●────●────●────── (main conversation)
              │         │
              │         └──side-quest-2──●──●──[summary]──┘
              └──side-quest-1──●──●──●──[summary]──┘
```

- FORK: child session, parent paused, own context window
- MERGE: summary injected into parent, parent resumes
- ABORT: discard child, parent resumes
- Auto-compress when token_count > 80% threshold

## 5. Agent Workspace

```
workspace/agents/{agent-id}/
├── SOUL.md           (immutable identity)
├── AGENTS.md         (behavior rules)
├── users/{uid}/
│   ├── USER.md       (user preferences)
│   └── MEMORY.md     (long-term memory)
├── HEARTBEAT.md      (scheduled tasks)
├── memory/YYYY-MM-DD.md (daily log)
├── skills/*.md       (self-extending)
└── sessions.json
```

Tiered loading: L0 (SOUL+AGENTS always) → L1 (USER+MEMORY on session) → L2 (skills on demand)

## 6. Memory Compaction

- Merge duplicate preferences
- Remove overridden decisions (>30 days)
- Summarize long sections (>20 bullets)
- Max 50KB per MEMORY.md, backup before compact

## 7. Skill Versioning

```
Metadata: version, author, confidence (0-1), status (experimental/stable/deprecated)
- New → experimental (0.5)
- Pass test → confidence += 0.1
- Fail → confidence -= 0.15
- confidence >= 0.8 && tests >= 3 → stable
- confidence < 0.4 → deprecated
```

## 8. Bash Security Sandbox

Command-level parsing (not shell-level). Hardcoded blocks: curl/wget/sudo/rm-rf/interpreter-bypass/shell-escape. Pipe/chain detection. Resource limits: 30s timeout, 1MB output, network disabled.

## 9. Config: config.json (JSON format, env var override)

## 10. Out of Scope (V1)

Context Database (OpenViking), Node (camera/screen/system.run), channels beyond Feishu, Web UI, multi-model, voice/file support, Redis store.
