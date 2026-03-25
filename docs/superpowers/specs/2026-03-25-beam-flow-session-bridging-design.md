# beam-flow: CLI-to-Feishu Session Bridging

## Goal

Let users start a Claude CLI session locally in PowerShell, "park" it, then list and resume it from Feishu. The CLI tool is called `beam-flow`.

## User Flow

```
PowerShell:
> npx beam-flow start "fix-the-damn-bug"
  Starting Claude session...
  [normal interactive Claude CLI]
  > /exit

> beam-flow park
  Parked session 'fix-the-damn-bug' (id: abc123)
  In Feishu, type: /sessions

Feishu:
> /sessions
  ┌─────────────────────────────────────┐
  │  Parked Sessions                     │
  │  1. fix-the-damn-bug    (5 min ago) │
  │     [Resume]                         │
  └─────────────────────────────────────┘

> /resume fix-the-damn-bug
  Resumed! Claude remembers the full conversation.
```

## Architecture

```
beam-flow CLI                    feishu-ai-assistant server
┌──────────────┐                ┌─────────────────────────┐
│ start <name> │                │ POST /api/beam/park      │
│  - spawn     │                │ GET  /api/beam/sessions  │
│    claude    │  park ──HTTP──►│ DEL  /api/beam/sessions/ │
│  - set env   │                │          │                │
│    vars      │                │   SessionManager         │
└──────────────┘                │   (sessions.json)        │
                                │          │                │
                                │   Engine                  │
                                │   /sessions → list card   │
                                │   /resume   → startSession│
                                │              (--session-id)│
                                └─────────────────────────┘
```

## Components

### 1. CLI Tool: `beam-flow`

**File:** `src/cli/beam-flow.ts`
**Binary:** `beam-flow` (via package.json `bin` field)

#### Commands

| Command | Description |
|---------|-------------|
| `beam-flow start <name>` | Start Claude CLI with session tracking |
| `beam-flow park [name]` | Park current session for Feishu resumption |
| `beam-flow sessions` | List parked sessions |
| `beam-flow drop <name>` | Remove a parked session |

#### `start` behavior

1. Generate a UUID for the session
2. Spawn `claude --session-id <uuid>` as interactive child process with inherited stdio
3. Set environment variables in the child process:
   - `BEAM_SESSION_ID=<uuid>`
   - `BEAM_SESSION_NAME=<name>`
4. Also print `export` commands to stdout so user can source them in their shell
5. On Claude process exit, print: `Session "<name>" ready to park. Run: beam-flow park`

#### `park` behavior

1. Read `BEAM_SESSION_ID` and `BEAM_SESSION_NAME` from environment
2. If not found, call `GET http://127.0.0.1:18791/api/beam/sessions` to show recent Claude sessions and let user pick interactively
3. POST to `http://127.0.0.1:18791/api/beam/park` with:
   ```json
   { "name": "<name>", "cliSessionId": "<uuid>" }
   ```
4. Print confirmation with Feishu instructions

#### `sessions` behavior

GET `http://127.0.0.1:18791/api/beam/sessions` and print a formatted table.

#### `drop` behavior

DELETE `http://127.0.0.1:18791/api/beam/sessions/<name>`.

### 2. Server API Endpoints

**File:** `src/webui/server.ts` (add to existing server)

CSRF-exempted (like existing `/api/reuse` routes).

| Method | Endpoint | Body/Params | Response |
|--------|----------|-------------|----------|
| `POST` | `/api/beam/park` | `{ name, cliSessionId }` | `{ ok: true }` |
| `GET` | `/api/beam/sessions` | — | `ParkedSession[]` |
| `DELETE` | `/api/beam/sessions/:name` | — | `{ ok: true }` |

### 3. Data Model

```typescript
interface ParkedSession {
  name: string;           // user-friendly name ("fix-the-damn-bug")
  cliSessionId: string;   // real Claude CLI session UUID
  parkedAt: number;       // Date.now() timestamp
  parkedBy?: string;      // optional: who parked it (CLI user)
}
```

Stored in `SessionManager` alongside active sessions, persisted to `~/.atlasOS/agents/default/sessions.json`.

### 4. SessionManager Changes

**File:** `src/core/session/manager.ts`

Current state: SessionManager has full persistence code (`loadFromDisk`/`saveToDisk`) but `persistPath` is never set by Engine.

Changes:
- Add `parkedSessions: Map<string, ParkedSession>` with CRUD methods
- Include parked sessions in `saveToDisk`/`loadFromDisk`
- Expose `parkSession(ps: ParkedSession)`, `getParkedSessions()`, `removeParkedSession(name)`

### 5. Engine Changes

**File:** `src/core/engine.ts`

Changes:
- Accept `persistPath` in `EngineConfig` and pass to `SessionManager`
- Capture `cliSessionId` from `result` events (the `sessionId` field in `AgentEvent`)
- New method `resumeParkedSession(name, replyCtx)`: looks up parked session, calls `agent.startSession({ sessionId: parkedSession.cliSessionId })`, creates `InteractiveState`
- Expose `sessionManager` for WebUI endpoints

### 6. Feishu Slash Commands

**File:** `src/core/command/builtins.ts` (new)

| Command | Aliases | Description |
|---------|---------|-------------|
| `/sessions` | `/ss` | List parked sessions as interactive card with Resume buttons |
| `/resume <name>` | `/rs` | Resume a parked session |

#### `/sessions` card

Renders an interactive card listing all parked sessions with:
- Session name
- Time since parked (human-readable)
- "Resume" button per session (triggers `/resume <name>` callback)

#### `/resume` handler

1. Look up parked session by name
2. Call `engine.resumeParkedSession(name, replyCtx)`
3. Remove from parked sessions (it's now active)
4. Reply: "Resumed session '<name>'! Claude remembers your conversation."

### 7. Entry Point Wiring

**File:** `src/index.ts`

- Pass `persistPath: path.join(workspace.agentDir, "sessions.json")` to Engine config
- Register `/sessions` and `/resume` commands on `engine.commands`
- Pass `engine.sessionManager` to WebUI deps for beam endpoints

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/cli/beam-flow.ts` | Create | CLI entry point with start/park/sessions/drop |
| `src/core/session/manager.ts` | Modify | Add parked session storage + connect persistence |
| `src/core/engine.ts` | Modify | Accept persistPath, capture cliSessionId, add resumeParkedSession |
| `src/core/command/builtins.ts` | Create | /sessions and /resume command handlers |
| `src/webui/server.ts` | Modify | Add /api/beam/* endpoints |
| `src/index.ts` | Modify | Wire persistPath, register commands, pass sessionManager to WebUI |
| `package.json` | Modify | Add bin.beam-flow entry |

## Testing Strategy

- **Unit tests** for SessionManager parked session CRUD and persistence
- **Unit tests** for beam API endpoints (mock SessionManager)
- **Unit tests** for /sessions and /resume command handlers
- **Integration test** for the full flow: park via API -> list -> resume -> verify session ID passed to agent

## Out of Scope

- Feishu-first flow (start in Feishu, attach from CLI) — future enhancement
- Conversation history export/import — relies on Claude CLI's built-in session persistence
- Multi-user session sharing — parked sessions are global for now (single-server)
