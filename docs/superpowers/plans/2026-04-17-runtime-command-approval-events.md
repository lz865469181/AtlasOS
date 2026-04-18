# Runtime Command And Approval Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add command-level runtime state recognition for PTY sessions and wire structured approval events through the existing runtime and card pipeline.

**Architecture:** Keep transport adapters responsible for converting raw backend or terminal signals into normalized runtime messages. Extend the shared agent/runtime message model with command lifecycle events, parse PTY markers before forwarding visible output, and let the existing engine/card flow render command status and approval state without inventing a second UI path.

**Tech Stack:** TypeScript, Vitest, `codelink-agent`, `codelink-gateway`, existing runtime/card engine

---

### Task 1: Normalize Runtime Command Lifecycle Messages

**Files:**
- Modify: `packages/atlas-agent/src/core/AgentMessage.ts`
- Modify: `packages/atlas-agent/src/core/AgentMessage.test.ts`
- Modify: `packages/atlas-gateway/src/engine/CardEngine.test.ts`

- [ ] **Step 1: Write failing tests for new command lifecycle message types and card expectations**
- [ ] **Step 2: Run targeted tests to verify they fail for the missing message handling**
- [ ] **Step 3: Add the minimal shared message types for command start, command exit, and cwd change**
- [ ] **Step 4: Re-run targeted tests to verify they pass**

### Task 2: Parse PTY Terminal Markers Into Structured Events

**Files:**
- Create: `packages/atlas-gateway/src/runtime/adapters/TerminalEventParser.ts`
- Create: `packages/atlas-gateway/src/runtime/adapters/TerminalEventParser.test.ts`
- Modify: `packages/atlas-gateway/src/runtime/adapters/PtyRuntimeAdapter.ts`
- Modify: `packages/atlas-gateway/src/runtime/adapters/PtyRuntimeAdapter.test.ts`

- [ ] **Step 1: Write failing parser tests for command start, command exit, cwd changes, and plain output passthrough**
- [ ] **Step 2: Run targeted parser tests to verify they fail**
- [ ] **Step 3: Implement the parser and minimal PTY adapter changes to emit structured messages plus cleaned terminal output**
- [ ] **Step 4: Re-run targeted PTY tests to verify they pass**

### Task 3: Surface Command Status In Cards And Watch Summaries

**Files:**
- Modify: `packages/atlas-gateway/src/engine/CardEngine.ts`
- Modify: `packages/atlas-gateway/src/engine/CardEngine.test.ts`
- Modify: `packages/atlas-gateway/src/engine/Engine.ts`
- Modify: `packages/atlas-gateway/src/engine/Engine.test.ts`

- [ ] **Step 1: Write failing tests for command lifecycle rendering and watch summaries**
- [ ] **Step 2: Run targeted engine tests to verify they fail**
- [ ] **Step 3: Implement minimal card metadata and summary handling for running command, cwd, and exit status**
- [ ] **Step 4: Re-run targeted engine tests to verify they pass**

### Task 4: Map Structured Approval Events From Backends

**Files:**
- Modify: `packages/atlas-agent/src/backends/codex/CodexBackend.ts`
- Modify: `packages/atlas-agent/src/backends/codex/CodexBackend.test.ts`

- [ ] **Step 1: Write failing backend tests for approval event mapping when provider emits approval-required items**
- [ ] **Step 2: Run targeted backend tests to verify they fail**
- [ ] **Step 3: Implement minimal event mapping into existing permission request messages**
- [ ] **Step 4: Re-run targeted backend tests to verify they pass**

### Task 5: Verify End-To-End Runtime Behavior

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update runtime behavior notes for command state and approval events if the user-facing behavior changed**
- [ ] **Step 2: Run focused package tests for `codelink-agent` and `codelink-gateway`**
- [ ] **Step 3: Run repository verification commands needed to support the final claim**
