# Channel / Session / Agent Detailed Design

## 1. Channel Layer

### 1.1 Channel Interface

All channels use WebSocket (not webhook). Unified interface for 20+ platforms.

```
Interface: Channel {
    Connect(ctx)          // WebSocket to IM platform
    Disconnect()          // Graceful close
    Reconnect(ctx)        // Auto-reconnect with exponential backoff
    OnMessage(handler)    // Register inbound message handler
    SendReply(ctx, reply) // Send response back
    Type() string         // "feishu" | "telegram" | "discord"
    Status()              // connected | disconnected | reconnecting
}
```

### 1.2 ChannelMessage Model

```
ChannelMessage:
  platform      string    // "feishu" | "telegram" | "discord"
  user_id       string    // Platform-specific user ID
  user_name     string    // Display name
  chat_id       string    // Chat/conversation ID
  chat_type     string    // "p2p" | "group"
  message_id    string    // Platform message ID (dedup)
  message_type  string    // "text" | "rich_text" | "image"
  content       string    // Extracted text content
  mention_bot   bool      // Bot was mentioned
  timestamp     int64
```

### 1.3 FeishuChannel

- WebSocket long-connection to Feishu bot platform
- Event dedup by event_id
- Auto token refresh (tenant_access_token)
- Reply: text or markdown (interactive card)
- Auto-reconnect with exponential backoff (1s → 60s, 10 attempts)

---

## 2. Session Layer — Tree Structure

### 2.1 Session Model

```
Session:
  id             string
  parent_id      string | null    // null = root (main branch)
  branch_name    string           // "main" | "side-quest-*"
  depth          int              // 0 = main, 1+ = side-quest
  agent_id       string
  user_id        string
  conversation   []Message        // This branch only
  token_count    int              // Estimated tokens
  state          enum             // ACTIVE | PAUSED | COMPLETED | EXPIRED
  children       []string         // Child session IDs
  summary        string | null    // Set on completion
```

### 2.2 Branching Mechanics

**FORK:** Agent needs deep-dive → child session created. Parent paused. Child gets own context window, inherits workspace access, does NOT inherit conversation.

**MERGE:** Child completes → auto-generates 1-3 sentence summary → injected into parent as "summary" role message → parent resumes.

**ABORT:** Discard child entirely, parent resumes without injection.

### 2.3 Context Auto-Compression

When `token_count > threshold` (80% of model limit):
1. Identify old conversation turns (keep recent N intact)
2. Summarize via Claude CLI
3. Replace old turns with summary block
4. Reset token_count

### 2.4 Session Manager

- `GetOrCreate(msg, agentID)` — find/create by (platform:user:chat) key
- `Fork(parentKey, branchName)` — create side-quest child
- `Merge(childID, summary)` — complete child, inject summary, resume parent
- `Abort(childID)` — discard child, resume parent
- `Reset(key)` — destroy session
- `CleanupExpired()` — periodic background task
- `StartCleanupLoop(interval)` — goroutine ticker

---

## 3. Agent Runtime

### 3.1 Workspace Structure

```
workspace/agents/{agent-id}/
├── SOUL.md              (immutable identity — created once, never modified)
├── AGENTS.md            (behavior rules, capabilities)
├── users/{user-id}/
│   ├── USER.md          (user preferences)
│   └── MEMORY.md        (long-term memory per user)
├── HEARTBEAT.md         (scheduled tasks config)
├── memory/
│   └── YYYY-MM-DD.md    (daily append-only activity log)
├── skills/
│   └── *.md             (self-extending skills with metadata)
└── sessions.json        (session index)
```

### 3.2 File Roles & Loading Tiers

| File | Mutable? | Loaded | Tier |
|------|----------|--------|------|
| SOUL.md | NO (immutable) | Every request | L0 |
| AGENTS.md | Admin only | Every request | L0 |
| USER.md | By agent | Session start | L1 |
| MEMORY.md | By agent | Session start | L1 |
| skills/*.md | By agent | On demand (keyword match) | L2 |
| HEARTBEAT.md | Admin | By scheduler | L2 |
| memory/YYYY-MM-DD.md | Append-only | On demand | L2 |

### 3.3 SOUL.md — Immutable Identity

```markdown
## Identity
I am Aria, an AI assistant for the engineering team.

## Values
- Accuracy over speed: never guess, always verify
- Transparency: explain reasoning, admit uncertainty

## Boundaries
- Never execute destructive commands without confirmation
- Never share one user's data with another
- Never modify my own SOUL.md
```

Immutability enforced: filesystem read-only permission + Write/Edit tool blocks SOUL.md path.

### 3.4 MEMORY.md — Per-User Long-Term Memory

Agent writes autonomously when detecting decisions, preferences, facts.

```markdown
## Decisions
- 2026-03-15: Chose Go over Python for new service

## Preferences
- Concise answers, Chinese for casual, English for code

## Facts
- Team lead, platform team (5 members)
```

### 3.5 Memory Compaction

Configured in HEARTBEAT.md (default: daily 3 AM):
- Merge duplicate preferences
- Remove overridden decisions (>30 days)
- Summarize sections exceeding 20 bullets
- Max 50KB per file, backup before compact

### 3.6 Self-Extending Skills

Skill file with metadata:
```markdown
## Metadata
- version: 1.2
- confidence: 0.92
- status: stable
- test_count: 5
- fail_count: 1

## Purpose
Build interactive Feishu message cards.
```

Lifecycle: experimental (0.5) → test pass (+0.1) / fail (-0.15) → stable (≥0.8, ≥3 tests) or deprecated (<0.4).

### 3.7 Four Core Tools

| Tool | Scope | Protection |
|------|-------|------------|
| Read | Workspace + allowed paths | — |
| Write | Workspace only | SOUL.md blocked |
| Edit | Workspace only | SOUL.md blocked |
| Bash | Command-level sandbox | Blocked commands, pipe detection, resource limits |

### 3.8 Bash Security Sandbox

**Hardcoded blocks:** curl, wget, nc, sudo, su, dd, mkfs, chmod, chown, interpreter+flag combos (python -c, bash -c, sh -c, node -e), /dev/tcp, eval, exec

**Pipe/chain detection:** Split on `| && || ;`, validate each sub-command independently. Any blocked → entire command denied.

**Resource limits:** 30s timeout, 1MB stdout, network disabled, working dir locked to workspace.

**Anti-bypass:** Block interpreter+flag combos, pipe to sh/bash, base64 decode to sh, binary copy outside allowlist.

---

## 4. Agent Lifecycle

```
1. CREATE: admin provides SOUL.md → workspace created → SOUL.md set read-only
2. USER BIND: first message → users/{uid}/ created → USER.md + MEMORY.md initialized
3. PER-REQUEST: L0+L1+L2 context → Claude CLI (pipe) → parse → tool calls → response
4. SELF-UPGRADE: /feedback → review conversations → write new skills → update AGENTS.md
5. DESTROY: archive workspace → delete directory
```

## 5. Claude CLI Integration

```
Single-shot mode (V1):
  claude --print --output-format json -p "user message"

Session resume (future):
  claude --print --resume <session-id> -p "follow-up"

System prompt via --system-prompt flag (assembled from L0+L1+L2)
```
