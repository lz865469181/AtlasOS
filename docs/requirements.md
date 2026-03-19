# Feishu AI Assistant — Core Requirements Specification

## 1. Project Overview

An AI Assistant platform inspired by OpenClaw, using Channel → Gateway → Agent architecture. Feishu bot as the first channel (via WebSocket), Claude CLI as the AI backend (pipe subprocess), with multi-platform deployment support.

## 2. Functional Requirements

### 2.1 Channel Layer (Feishu First, Extensible)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | Connect to Feishu bot via WebSocket (长连接, not webhook) | P0 |
| FR-02 | Support text message type | P0 |
| FR-03 | Support rich text / Markdown reply | P1 |
| FR-04 | Support image message (input & output) | P2 |
| FR-05 | Support @bot mention trigger | P0 |
| FR-06 | Support group chat and private chat | P0 |
| FR-07 | Auto-reconnect on connection drop | P0 |
| FR-08 | Support interactive card reply | P2 |
| FR-09 | Channel interface abstraction for 20+ platforms | P0 |

### 2.2 Gateway (Central Control Plane)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-10 | WebSocket server on ws://127.0.0.1:18789 | P0 |
| FR-11 | One instance per host | P0 |
| FR-12 | Route messages from Channel to Agent | P0 |
| FR-13 | Session management with tree structure (branching) | P0 |
| FR-14 | Agent scheduling with concurrency control | P0 |
| FR-15 | Command handler (/reset /help /status /branch /merge /feedback) | P0 |
| FR-16 | Heartbeat scheduler for background tasks | P1 |

### 2.3 Agent Runtime (Claude CLI + Workspace)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-20 | Invoke Claude CLI via subprocess pipe (stdin/stdout) | P0 |
| FR-21 | SOUL.md — immutable personality/values/identity (created once, never modified) | P0 |
| FR-22 | AGENTS.md — behavior rules and capabilities | P0 |
| FR-23 | Per-user USER.md + MEMORY.md (isolated between users) | P0 |
| FR-24 | Each Agent has independent filesystem workspace directory | P0 |
| FR-25 | 4 core tools only: Read, Write, Edit, Bash | P0 |
| FR-26 | L0/L1/L2 tiered context loading (reduce token consumption) | P0 |
| FR-27 | Self-extending skills (agent writes/tests/reloads skills) | P1 |
| FR-28 | Skill metadata with versioning and confidence scoring | P1 |
| FR-29 | /feedback command triggers self-upgrade | P1 |

### 2.4 Session Management (Tree Structure)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-30 | Tree-structured sessions (not linear) | P0 |
| FR-31 | Fork side-quest: child session with own context window | P0 |
| FR-32 | Merge: summary injected into parent, parent resumes | P0 |
| FR-33 | Abort: discard child, parent resumes without injection | P0 |
| FR-34 | Auto-compress context when token count exceeds threshold | P0 |
| FR-35 | Session timeout and auto-cleanup | P0 |
| FR-36 | Concurrent session isolation | P0 |

### 2.5 Memory System

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-40 | Long-term memory in MEMORY.md per user per agent | P0 |
| FR-41 | Agent writes MEMORY.md autonomously (decisions, preferences, facts) | P0 |
| FR-42 | Memory compaction: merge duplicates, expire old (>30d), summarize | P1 |
| FR-43 | Daily append-only activity log (memory/YYYY-MM-DD.md) | P1 |
| FR-44 | Backup before compaction (.bak) | P1 |

### 2.6 Bash Security Sandbox

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-50 | Command-level parsing (not shell-level allowlist) | P0 |
| FR-51 | Hardcoded block: curl/wget/sudo/rm-rf/interpreter-bypass/shell-escape | P0 |
| FR-52 | Pipe/chain detection: split sub-commands, validate each | P0 |
| FR-53 | Resource limits: 30s timeout, 1MB output, network disabled | P0 |
| FR-54 | Configurable allow/deny per agent in AGENTS.md | P1 |
| FR-55 | Audit logging of all Bash executions | P1 |

### 2.7 Multi-Platform Deployment

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-60 | Run on Linux (Ubuntu 20.04+) | P0 |
| FR-61 | Run on Windows (Windows 10+) | P1 |
| FR-62 | Docker container deployment | P0 |
| FR-63 | Kubernetes deployment with Helm | P2 |
| FR-64 | Configuration via JSON + environment variables | P0 |
| FR-65 | Health check endpoint | P1 |
| FR-66 | Graceful shutdown | P1 |

## 3. Non-Functional Requirements

### 3.1 Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-01 | Message latency (excluding AI inference) | < 500ms |
| NFR-02 | Concurrent sessions | >= 50 |
| NFR-03 | Memory per session | < 50MB |

### 3.2 Reliability

- Claude CLI crash → auto-retry (configurable max_retries)
- Feishu WebSocket drop → auto-reconnect with exponential backoff
- Graceful degradation on AI failure

### 3.3 Security

- Bash command-level sandbox (not shell-level)
- SOUL.md immutability enforced at filesystem + tool layer
- No sensitive data in logs
- Per-user memory isolation

## 4. Technology Stack

| Component | Choice |
|-----------|--------|
| Language | Go (single binary, cross-platform) |
| AI Backend | Claude CLI (pipe mode) |
| IM Channel | Feishu WebSocket (first), extensible |
| WebSocket | gorilla/websocket |
| Config | JSON + env vars |
| Container | Docker |

## 5. Out of Scope (V1)

- Context Database (OpenViking) — deferred to V2
- Node module (camera, screen, system.run) — deferred to V2
- Channels beyond Feishu (interface ready, impl deferred)
- Web UI dashboard
- Multi-model switching
- Voice / file message support
- Redis session store
