# Watch Runtime Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the secondary watching runtime accumulate unread state and send lightweight notifications for completion, errors, and approval-needed events.

**Architecture:** Keep transport adapters transport-focused and route runtime messages into `Engine`, which already knows bindings, senders, and per-thread state. Extend `BindingStore` watch-state handling just enough to accumulate unread counts and summaries, then surface that state through `Engine` and `/sessions`.

**Tech Stack:** TypeScript, Vitest, existing `codelink-gateway` engine/runtime layers

---

### Task 1: Add Engine-Level Watch Event Tests

**Files:**
- Modify: `packages/atlas-gateway/src/engine/Engine.test.ts`
- Modify: `packages/atlas-gateway/src/engine/CommandRegistry.test.ts`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run targeted tests to verify they fail**
- [ ] **Step 3: Implement minimal engine hooks and watch-state updates**
- [ ] **Step 4: Re-run targeted tests to verify they pass**
- [ ] **Step 5: Commit**

### Task 2: Wire Adapter Message Flow Into Engine

**Files:**
- Modify: `packages/atlas-gateway/src/engine/Engine.ts`
- Modify: `packages/atlas-cli/src/createApp.ts`

- [ ] **Step 1: Write the failing integration-shaped test for runtime message handling**
- [ ] **Step 2: Run targeted tests to verify they fail**
- [ ] **Step 3: Register adapter `onMessage` handlers that call into engine**
- [ ] **Step 4: Re-run targeted tests to verify they pass**
- [ ] **Step 5: Commit**

### Task 3: Surface Unread Watch State In Session Output

**Files:**
- Modify: `packages/atlas-gateway/src/engine/commands/SessionsCommand.ts`
- Modify: `packages/atlas-gateway/src/runtime/BindingStore.ts`
- Test: `packages/atlas-gateway/src/engine/CommandRegistry.test.ts`

- [ ] **Step 1: Write the failing output test for unread counts and summaries**
- [ ] **Step 2: Run targeted tests to verify they fail**
- [ ] **Step 3: Implement minimal output formatting and state resets**
- [ ] **Step 4: Re-run targeted tests to verify they pass**
- [ ] **Step 5: Commit**

### Task 4: Verify

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README for watching-runtime notifications**
- [ ] **Step 2: Run `yarn workspace codelink-gateway test`**
- [ ] **Step 3: Run `yarn test`**
- [ ] **Step 4: Run `yarn build`**
- [ ] **Step 5: Commit**
