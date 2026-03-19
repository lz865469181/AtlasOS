# System Architecture

## 1. High-Level Architecture

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

## 2. Gateway Components

```
Gateway
├── MessageRouter        // Route to command or session→agent
├── CommandHandler       // /reset /help /status /branch /merge /feedback
├── SessionManager       // Tree-structured session lifecycle
├── AgentScheduler       // Agent pool, concurrency, dispatch
├── ContextBuilder       // L0/L1/L2 system prompt assembly
├── ToolExecutor         // Sandboxed 4 core tools
├── HeartbeatScheduler   // Cron tasks (compaction, cleanup)
└── WebSocket Server     // ws://127.0.0.1:18789 JSON protocol
```

## 3. Message Flow

```
User (Feishu) → FeishuChannel (ws) → Gateway.MessageRouter
  → Is command? → CommandHandler → reply
  → SessionManager.GetOrCreate
  → AgentScheduler.Dispatch
    → ContextBuilder (L0 SOUL+AGENTS, L1 USER+MEMORY, L2 skills)
    → Claude CLI (pipe subprocess)
    → ToolExecutor (Read/Write/Edit/Bash sandbox)
    → Response
  → FeishuChannel.SendReply → User
```

## 4. WebSocket Protocol (JSON)

```json
// Channel → Gateway
{"type":"channel.message","channel":"feishu","user_id":"ou_xxx","chat_id":"oc_xxx","content":"hello"}

// Gateway → Channel
{"type":"gateway.reply","channel":"feishu","chat_id":"oc_xxx","content":"Hi!","content_type":"markdown"}

// Streaming (future)
{"type":"gateway.stream","chat_id":"oc_xxx","chunk":"partial...","is_final":false}

// Admin
{"type":"admin.status"}
{"type":"gateway.status","active_sessions":12,"active_agents":3}
```

## 5. Session Tree

```
main ────●────●────●────●──── (main conversation)
              │         │
              │         └──side-quest-2──●──●──[summary]──┘
              └──side-quest-1──●──●──●──[summary]──┘

FORK:  child session, parent paused, own context window
MERGE: summary → parent, parent resumes
ABORT: discard child, parent resumes
```

## 6. Tiered Context Loading

```
L0 (always):  SOUL.md + AGENTS.md        (~500-1300 tokens)
L1 (session): USER.md + MEMORY.md        (~300-1300 tokens)
L2 (demand):  matched skills/*.md        (~0-500 tokens)
Total budget: ~2000-3000 tokens typical
```

## 7. Configuration (config.json)

```json
{
  "gateway": {"host":"127.0.0.1","port":18789,"session_ttl":"30m","context_compress_threshold":0.8},
  "channels": {"feishu":{"enabled":true,"app_id":"","app_secret":"","ws_endpoint":"wss://open.feishu.cn/event/ws"}},
  "agent": {"claude_cli_path":"claude","timeout":"120s","workspace_root":"./workspace",
    "bash":{"timeout":"30s","network":false,"blocked_commands":["curl","wget","sudo"],"allowed_commands":["ls","grep","echo"]}},
  "memory": {"compaction":{"enabled":true,"schedule":"0 3 * * *","expire_overridden_days":30}},
  "health": {"enabled":true,"port":18790}
}
```

## 8. Startup Sequence

1. Load config.json + env vars
2. Verify Claude CLI (`claude --version`)
3. Init workspace, scan agents, verify SOUL.md integrity
4. Start Gateway (SessionManager, AgentScheduler, HeartbeatScheduler, WebSocket server)
5. Start Feishu Channel (WebSocket connect, register OnMessage → Gateway)
6. Start health check HTTP on :18790
7. Block on SIGINT/SIGTERM → graceful shutdown
