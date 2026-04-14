# Watch/Focus Runtime Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "active + watching" runtime model per chat thread so one runtime stays interactive while a second runtime can be monitored and promoted on demand.

**Architecture:** Extend `ConversationBinding` with a single watch slot and light watch-state metadata, then expose that state through new slash commands and upgraded thread status commands. Keep tmux and managed runtime transport behavior unchanged; only chat-level routing and summaries change in this slice.

**Tech Stack:** TypeScript, Vitest, existing `codelink-gateway` command/runtime layers

---

### Task 1: Define Binding Watch State

**Files:**
- Modify: `packages/atlas-gateway/src/runtime/RuntimeModels.ts`
- Modify: `packages/atlas-gateway/src/runtime/BindingStore.ts`
- Test: `packages/atlas-gateway/src/engine/CommandRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('/watch marks a runtime as watching without replacing the active runtime', async () => {
  const ctx = await makeContext({
    runtimes: [makeRuntime({ id: 'runtime-a', displayName: 'main' }), makeRuntime({ id: 'runtime-b', displayName: 'lab' })],
    activeRuntimeId: 'runtime-a',
  });

  const result = registry.resolve('/watch');
  const output = await result!.command.execute('lab', ctx);

  expect(ctx.binding.activeRuntimeId).toBe('runtime-a');
  expect(ctx.binding.watchRuntimeId).toBe('runtime-b');
  expect(output).toContain('Watching **lab**');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace codelink-gateway test src/engine/CommandRegistry.test.ts`
Expected: FAIL because `watch` command and `watchRuntimeId` do not exist yet

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ConversationBinding {
  // existing fields...
  watchRuntimeId: string | null;
  watchState: Record<string, { unreadCount: number; lastStatus?: string; lastSummary?: string; lastNotifiedAt?: number }>;
}
```

```ts
const binding: ConversationBinding = {
  // existing fields...
  watchRuntimeId: null,
  watchState: {},
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace codelink-gateway test src/engine/CommandRegistry.test.ts`
Expected: PASS for the new watch-state assertion

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-gateway/src/runtime/RuntimeModels.ts packages/atlas-gateway/src/runtime/BindingStore.ts packages/atlas-gateway/src/engine/CommandRegistry.test.ts
git commit -m "feat: add watch state to conversation bindings"
```

### Task 2: Add Watch/Unwatch/Focus Commands

**Files:**
- Create: `packages/atlas-gateway/src/engine/commands/WatchCommand.ts`
- Create: `packages/atlas-gateway/src/engine/commands/UnwatchCommand.ts`
- Create: `packages/atlas-gateway/src/engine/commands/FocusCommand.ts`
- Modify: `packages/atlas-gateway/src/engine/commands/SwitchCommand.ts`
- Modify: `packages/atlas-gateway/src/engine/commands/index.ts`
- Modify: `packages/atlas-gateway/src/engine/CommandRegistry.ts`
- Test: `packages/atlas-gateway/src/engine/CommandRegistry.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('/focus promotes the watching runtime to active and demotes the previous active runtime to watching', async () => {
  const ctx = await makeContext({
    runtimes: [makeRuntime({ id: 'runtime-a', displayName: 'main' }), makeRuntime({ id: 'runtime-b', displayName: 'lab' })],
    activeRuntimeId: 'runtime-a',
  });
  ctx.bindingStore.setWatching(ctx.binding.bindingId, 'runtime-b');

  const result = registry.resolve('/focus');
  const output = await result!.command.execute('lab', ctx);

  expect(ctx.binding.activeRuntimeId).toBe('runtime-b');
  expect(ctx.binding.watchRuntimeId).toBe('runtime-a');
  expect(output).toContain('Focused **lab**');
});
```

```ts
it('/switch resolves to the focus behavior', async () => {
  const result = registry.resolve('/switch lab');
  expect(result?.command.name).toBe('focus');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace codelink-gateway test src/engine/CommandRegistry.test.ts`
Expected: FAIL because `focus`, `watch`, `unwatch`, and the switch alias behavior are missing

- [ ] **Step 3: Write minimal implementation**

```ts
export const FocusCommand: Command = {
  name: 'focus',
  aliases: ['switch'],
  // resolve attached runtime, swap active/watch ids, and return a focused message
};
```

```ts
export const WatchCommand: Command = {
  name: 'watch',
  // resolve attached runtime, reject the active runtime, and set the watch slot
};
```

```ts
export const UnwatchCommand: Command = {
  name: 'unwatch',
  // clear watch slot or remove the specified watched runtime
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace codelink-gateway test src/engine/CommandRegistry.test.ts`
Expected: PASS for the new command behavior

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-gateway/src/engine/commands/WatchCommand.ts packages/atlas-gateway/src/engine/commands/UnwatchCommand.ts packages/atlas-gateway/src/engine/commands/FocusCommand.ts packages/atlas-gateway/src/engine/commands/SwitchCommand.ts packages/atlas-gateway/src/engine/commands/index.ts packages/atlas-gateway/src/engine/CommandRegistry.ts packages/atlas-gateway/src/engine/CommandRegistry.test.ts
git commit -m "feat: add watch and focus runtime commands"
```

### Task 3: Expose Roles In Sessions And Status Views

**Files:**
- Modify: `packages/atlas-gateway/src/engine/commands/SessionsCommand.ts`
- Modify: `packages/atlas-gateway/src/engine/commands/StatusCommand.ts`
- Modify: `packages/atlas-gateway/src/engine/commands/ListCommand.ts`
- Test: `packages/atlas-gateway/src/engine/CommandRegistry.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('/sessions separates active, watching, and attached runtimes', async () => {
  const ctx = await makeContext({
    runtimes: [makeRuntime({ id: 'runtime-a', displayName: 'main' }), makeRuntime({ id: 'runtime-b', displayName: 'lab', transport: 'tmux', source: 'external' })],
    activeRuntimeId: 'runtime-a',
  });
  ctx.bindingStore.setWatching(ctx.binding.bindingId, 'runtime-b');

  const output = await registry.resolve('/sessions')!.command.execute('', ctx);

  expect(output).toContain('Active: **main**');
  expect(output).toContain('Watching: **lab**');
});
```

```ts
it('/status includes the watching runtime summary when present', async () => {
  const ctx = await makeContext({
    runtimes: [makeRuntime({ id: 'runtime-a', displayName: 'main' }), makeRuntime({ id: 'runtime-b', displayName: 'lab', status: 'running' })],
    activeRuntimeId: 'runtime-a',
  });
  ctx.bindingStore.setWatching(ctx.binding.bindingId, 'runtime-b');

  const output = await registry.resolve('/status')!.command.execute('', ctx);

  expect(output).toContain('Watching: lab [claude/sdk] - running');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace codelink-gateway test src/engine/CommandRegistry.test.ts`
Expected: FAIL because role-aware output has not been added

- [ ] **Step 3: Write minimal implementation**

```ts
lines.push(`Active: **${activeLabel}** [${active.provider}/${active.transport}]`);
if (watchRuntime) {
  lines.push(`Watching: **${watchLabel}** [${watchRuntime.provider}/${watchRuntime.transport}]`);
}
```

```ts
if (watchRuntime) {
  lines.push(`Watching: ${watchLabel} [${watchRuntime.provider}/${watchRuntime.transport}] - ${watchRuntime.status}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace codelink-gateway test src/engine/CommandRegistry.test.ts`
Expected: PASS for the upgraded summaries

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-gateway/src/engine/commands/SessionsCommand.ts packages/atlas-gateway/src/engine/commands/StatusCommand.ts packages/atlas-gateway/src/engine/commands/ListCommand.ts packages/atlas-gateway/src/engine/CommandRegistry.test.ts
git commit -m "feat: show watch roles in runtime summaries"
```

### Task 4: Verify End-To-End

**Files:**
- Modify: `README.md`
- Test: `packages/atlas-gateway/src/engine/CommandRegistry.test.ts`

- [ ] **Step 1: Update command documentation**

```md
| `/watch <name|id>` | Mark an attached runtime as the watching runtime |
| `/unwatch [name|id]` | Clear the current watching runtime |
| `/focus <number|name|id>` | Promote an attached or watching runtime to active |
```

- [ ] **Step 2: Run targeted and full verification**

Run: `yarn workspace codelink-gateway test`
Expected: PASS

Run: `yarn test`
Expected: PASS

Run: `yarn build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add README.md packages/atlas-gateway/src/engine/CommandRegistry.test.ts
git commit -m "docs: document watch and focus runtime roles"
```
