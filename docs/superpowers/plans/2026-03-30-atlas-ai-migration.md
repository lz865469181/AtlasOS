# Atlas AI Migration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate happy-main's agent/CLI/wire architecture into feishu-ai-assistant as a channel-agnostic monorepo called atlas-ai.

**Architecture:** Yarn workspaces monorepo with 4 packages: `atlas-wire` (Zod schemas), `atlas-agent` (agent backends ported from happy-main), `atlas-gateway` (core engine + channel adapters), `atlas-cli` (CLI + daemon), plus `atlas-app-logs` (HTTP log receiver). All runs as a single local process. No cloud server relay.

**Tech Stack:** TypeScript 5.x (strict ESM), Node.js >= 18, Yarn workspaces, Vitest, Zod, @agentclientprotocol/sdk, @larksuiteoapi/node-sdk

**Spec:** `docs/superpowers/specs/2026-03-30-atlas-ai-migration-design.md`

---

## Chunk 1: Monorepo Scaffold + atlas-wire

### Task 1: Initialize Yarn Workspaces Monorepo

**Files:**
- Create: `package.json` (root — replace existing)
- Create: `tsconfig.base.json`
- Create: `packages/atlas-wire/package.json`
- Create: `packages/atlas-wire/tsconfig.json`
- Create: `packages/atlas-agent/package.json`
- Create: `packages/atlas-agent/tsconfig.json`
- Create: `packages/atlas-gateway/package.json`
- Create: `packages/atlas-gateway/tsconfig.json`
- Create: `packages/atlas-cli/package.json`
- Create: `packages/atlas-cli/tsconfig.json`
- Create: `packages/atlas-app-logs/package.json`
- Create: `packages/atlas-app-logs/tsconfig.json`

**Important:** Back up the existing `package.json` to `package.json.v1.bak` before overwriting. The existing `src/` directory stays intact during migration — it will be moved into packages in later tasks.

- [ ] **Step 1: Back up existing files**

```bash
cp package.json package.json.v1.bak
cp tsconfig.json tsconfig.json.v1.bak
```

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "atlas-ai",
  "private": true,
  "scripts": {
    "build": "yarn workspaces foreach -pt run build",
    "test": "yarn workspaces foreach -pt run test",
    "dev": "yarn workspace atlas-gateway dev",
    "start": "yarn workspace atlas-cli start"
  },
  "workspaces": [
    "packages/*"
  ],
  "packageManager": "yarn@1.22.22"
}
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  }
}
```

- [ ] **Step 4: Create package directories**

```bash
mkdir -p packages/atlas-wire/src
mkdir -p packages/atlas-agent/src
mkdir -p packages/atlas-gateway/src
mkdir -p packages/atlas-cli/src
mkdir -p packages/atlas-app-logs/src
```

- [ ] **Step 5: Create atlas-wire/package.json**

```json
{
  "name": "atlas-wire",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "typescript": "^5.7.0",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 6: Create atlas-wire/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

- [ ] **Step 7: Create atlas-agent/package.json**

```json
{
  "name": "atlas-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "atlas-wire": "0.1.0",
    "@agentclientprotocol/sdk": "^0.14.1",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "typescript": "^5.7.0",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 8: Create atlas-agent/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "references": [
    { "path": "../atlas-wire" }
  ],
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

- [ ] **Step 9: Create atlas-gateway/package.json**

```json
{
  "name": "atlas-gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "dev": "tsx watch src/index.ts"
  },
  "dependencies": {
    "atlas-wire": "0.1.0",
    "atlas-agent": "0.1.0",
    "@larksuiteoapi/node-sdk": "^1.38.0",
    "express": "^4.21.2",
    "dotenv": "^16.4.7",
    "qrcode": "^1.5.4",
    "zod": "^3.23.0"
  },
  "optionalDependencies": {
    "node-telegram-bot-api": "^0.66.0",
    "discord.js": "^14.16.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.13.0",
    "@types/node-telegram-bot-api": "^0.64.0",
    "@types/qrcode": "^1.5.6",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 10: Create atlas-gateway/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "references": [
    { "path": "../atlas-wire" },
    { "path": "../atlas-agent" }
  ],
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

- [ ] **Step 11: Create atlas-cli/package.json**

```json
{
  "name": "atlas-cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "atlas": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "atlas-gateway": "0.1.0",
    "atlas-agent": "0.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 12: Create atlas-cli/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "references": [
    { "path": "../atlas-gateway" },
    { "path": "../atlas-agent" }
  ],
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 13: Create atlas-app-logs/package.json**

```json
{
  "name": "atlas-app-logs",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "typescript": "^5.7.0",
    "vitest": "^4.1.0"
  }
}
```

- [ ] **Step 14: Create atlas-app-logs/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

- [ ] **Step 15: Create vitest workspace config**

Create `vitest.workspace.ts` at root:

```ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*/vitest.config.ts',
]);
```

Create `packages/atlas-wire/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

Copy same vitest.config.ts to: `packages/atlas-agent/`, `packages/atlas-gateway/`, `packages/atlas-app-logs/`.

- [ ] **Step 16: Install dependencies and verify build**

```bash
yarn install
```

Expected: Clean install, workspaces linked.

- [ ] **Step 17: Commit scaffold**

```bash
git add -A
git commit -m "chore: initialize atlas-ai monorepo scaffold with yarn workspaces"
```

---

### Task 2: Implement atlas-wire — messageMeta schema

**Files:**
- Create: `packages/atlas-wire/src/messageMeta.ts`
- Create: `packages/atlas-wire/src/messageMeta.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/atlas-wire/src/messageMeta.test.ts
import { describe, it, expect } from 'vitest';
import { MessageMetaSchema, type MessageMeta } from './messageMeta.js';

describe('MessageMetaSchema', () => {
  it('should parse valid full metadata', () => {
    const input = {
      sentFrom: 'feishu',
      permissionMode: 'yolo',
      model: 'claude-sonnet-4-5-20250514',
      fallbackModel: null,
      customSystemPrompt: 'You are helpful',
      appendSystemPrompt: null,
      allowedTools: ['Read', 'Write'],
      disallowedTools: null,
      displayText: 'Testing',
    };
    const result = MessageMetaSchema.parse(input);
    expect(result.permissionMode).toBe('yolo');
    expect(result.allowedTools).toEqual(['Read', 'Write']);
  });

  it('should parse empty object', () => {
    const result = MessageMetaSchema.parse({});
    expect(result).toEqual({});
  });

  it('should reject invalid permission mode', () => {
    expect(() =>
      MessageMetaSchema.parse({ permissionMode: 'invalid' })
    ).toThrow();
  });

  it('should accept all 7 permission modes', () => {
    const modes = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'read-only', 'safe-yolo', 'yolo'];
    for (const mode of modes) {
      const result = MessageMetaSchema.parse({ permissionMode: mode });
      expect(result.permissionMode).toBe(mode);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/atlas-wire && npx vitest run src/messageMeta.test.ts
```

Expected: FAIL — cannot find module `./messageMeta.js`

- [ ] **Step 3: Write implementation**

```ts
// packages/atlas-wire/src/messageMeta.ts
import * as z from 'zod';

export const MessageMetaSchema = z.object({
  sentFrom: z.string().optional(),
  permissionMode: z.enum([
    'default', 'acceptEdits', 'bypassPermissions',
    'plan', 'read-only', 'safe-yolo', 'yolo',
  ]).optional(),
  model: z.string().nullable().optional(),
  fallbackModel: z.string().nullable().optional(),
  customSystemPrompt: z.string().nullable().optional(),
  appendSystemPrompt: z.string().nullable().optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
  disallowedTools: z.array(z.string()).nullable().optional(),
  displayText: z.string().optional(),
});

export type MessageMeta = z.infer<typeof MessageMetaSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/atlas-wire && npx vitest run src/messageMeta.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-wire/src/messageMeta.ts packages/atlas-wire/src/messageMeta.test.ts
git commit -m "feat(wire): add MessageMeta schema with permission modes"
```

---

### Task 3: Implement atlas-wire — legacyProtocol schema

**Files:**
- Create: `packages/atlas-wire/src/legacyProtocol.ts`
- Create: `packages/atlas-wire/src/legacyProtocol.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/atlas-wire/src/legacyProtocol.test.ts
import { describe, it, expect } from 'vitest';
import {
  UserMessageSchema, AgentMessageSchema,
  LegacyMessageContentSchema,
  type UserMessage, type AgentMessage,
} from './legacyProtocol.js';

describe('UserMessageSchema', () => {
  it('should parse valid user message', () => {
    const msg = {
      role: 'user',
      content: { type: 'text', text: 'Hello' },
    };
    const result = UserMessageSchema.parse(msg);
    expect(result.role).toBe('user');
    expect(result.content.text).toBe('Hello');
  });

  it('should parse with meta and localKey', () => {
    const msg = {
      role: 'user',
      content: { type: 'text', text: 'Hi' },
      localKey: 'local-123',
      meta: { permissionMode: 'yolo' },
    };
    const result = UserMessageSchema.parse(msg);
    expect(result.localKey).toBe('local-123');
    expect(result.meta?.permissionMode).toBe('yolo');
  });

  it('should reject non-user role', () => {
    expect(() =>
      UserMessageSchema.parse({ role: 'agent', content: { type: 'text', text: 'Hi' } })
    ).toThrow();
  });
});

describe('AgentMessageSchema', () => {
  it('should parse agent message with passthrough content', () => {
    const msg = {
      role: 'agent',
      content: { type: 'model-output', textDelta: 'Hello', extra: 42 },
    };
    const result = AgentMessageSchema.parse(msg);
    expect(result.role).toBe('agent');
    expect(result.content.type).toBe('model-output');
    expect((result.content as Record<string, unknown>).textDelta).toBe('Hello');
  });
});

describe('LegacyMessageContentSchema', () => {
  it('should discriminate by role', () => {
    const userMsg = LegacyMessageContentSchema.parse({
      role: 'user', content: { type: 'text', text: 'test' },
    });
    expect(userMsg.role).toBe('user');

    const agentMsg = LegacyMessageContentSchema.parse({
      role: 'agent', content: { type: 'status' },
    });
    expect(agentMsg.role).toBe('agent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/atlas-wire && npx vitest run src/legacyProtocol.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write implementation**

```ts
// packages/atlas-wire/src/legacyProtocol.ts
import * as z from 'zod';
import { MessageMetaSchema } from './messageMeta.js';

export const UserMessageSchema = z.object({
  role: z.literal('user'),
  content: z.object({
    type: z.literal('text'),
    text: z.string(),
  }),
  localKey: z.string().optional(),
  meta: MessageMetaSchema.optional(),
});
export type UserMessage = z.infer<typeof UserMessageSchema>;

export const AgentMessageSchema = z.object({
  role: z.literal('agent'),
  content: z.object({
    type: z.string(),
  }).passthrough(),
  meta: MessageMetaSchema.optional(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const LegacyMessageContentSchema = z.discriminatedUnion('role', [
  UserMessageSchema,
  AgentMessageSchema,
]);
export type LegacyMessageContent = z.infer<typeof LegacyMessageContentSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/atlas-wire && npx vitest run src/legacyProtocol.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-wire/src/legacyProtocol.ts packages/atlas-wire/src/legacyProtocol.test.ts
git commit -m "feat(wire): add legacy protocol schemas (UserMessage, AgentMessage)"
```

---

### Task 4: Implement atlas-wire — sessionProtocol schema

**Files:**
- Create: `packages/atlas-wire/src/sessionProtocol.ts`
- Create: `packages/atlas-wire/src/sessionProtocol.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/atlas-wire/src/sessionProtocol.test.ts
import { describe, it, expect } from 'vitest';
import {
  sessionEventSchema, sessionEnvelopeSchema, createEnvelope,
  type SessionEvent, type SessionEnvelope,
} from './sessionProtocol.js';

describe('sessionEventSchema', () => {
  it('should parse text event', () => {
    const ev = sessionEventSchema.parse({ t: 'text', text: 'Hello' });
    expect(ev.t).toBe('text');
  });

  it('should parse tool-call-start event', () => {
    const ev = sessionEventSchema.parse({
      t: 'tool-call-start',
      call: 'call-1',
      name: 'Read',
      title: 'Reading file',
      description: 'Read a file',
      args: { path: '/foo' },
    });
    expect(ev.t).toBe('tool-call-start');
  });

  it('should parse all 9 event types', () => {
    const events = [
      { t: 'text', text: 'hi' },
      { t: 'service', text: 'info' },
      { t: 'tool-call-start', call: 'c', name: 'n', title: 't', description: 'd', args: {} },
      { t: 'tool-call-end', call: 'c' },
      { t: 'file', ref: 'r', name: 'n', size: 100 },
      { t: 'turn-start' },
      { t: 'start' },
      { t: 'turn-end', status: 'completed' },
      { t: 'stop' },
    ];
    for (const ev of events) {
      expect(() => sessionEventSchema.parse(ev)).not.toThrow();
    }
  });

  it('should reject unknown event type', () => {
    expect(() => sessionEventSchema.parse({ t: 'unknown' })).toThrow();
  });
});

describe('sessionEnvelopeSchema', () => {
  it('should parse valid envelope', () => {
    const env = sessionEnvelopeSchema.parse({
      id: 'test-id',
      time: Date.now(),
      role: 'user',
      ev: { t: 'text', text: 'hello' },
    });
    expect(env.role).toBe('user');
  });

  it('should reject service event with user role', () => {
    expect(() => sessionEnvelopeSchema.parse({
      id: 'test-id',
      time: Date.now(),
      role: 'user',
      ev: { t: 'service', text: 'info' },
    })).toThrow();
  });

  it('should reject start event with user role', () => {
    expect(() => sessionEnvelopeSchema.parse({
      id: 'test-id',
      time: Date.now(),
      role: 'user',
      ev: { t: 'start' },
    })).toThrow();
  });
});

describe('createEnvelope', () => {
  it('should create envelope with defaults', () => {
    const env = createEnvelope('agent', { t: 'text', text: 'hello' });
    expect(env.id).toBeDefined();
    expect(env.time).toBeGreaterThan(0);
    expect(env.role).toBe('agent');
    expect(env.ev.t).toBe('text');
  });

  it('should accept custom id and time', () => {
    const env = createEnvelope('user', { t: 'text', text: 'hi' }, {
      id: 'custom-id',
      time: 12345,
    });
    expect(env.id).toBe('custom-id');
    expect(env.time).toBe(12345);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/atlas-wire && npx vitest run src/sessionProtocol.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write implementation**

Port from `happy-wire/src/sessionProtocol.ts`. Replace `@paralleldrive/cuid2` with a simple `crypto.randomUUID()` to avoid the extra dependency (cuid2 validation on subagent field is dropped — it adds complexity for minimal value in our local-only architecture).

```ts
// packages/atlas-wire/src/sessionProtocol.ts
import { randomUUID } from 'node:crypto';
import * as z from 'zod';

export const sessionRoleSchema = z.enum(['user', 'agent']);
export type SessionRole = z.infer<typeof sessionRoleSchema>;

export const sessionTextEventSchema = z.object({
  t: z.literal('text'),
  text: z.string(),
  thinking: z.boolean().optional(),
});

export const sessionServiceMessageEventSchema = z.object({
  t: z.literal('service'),
  text: z.string(),
});

export const sessionToolCallStartEventSchema = z.object({
  t: z.literal('tool-call-start'),
  call: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string(),
  args: z.record(z.string(), z.unknown()),
});

export const sessionToolCallEndEventSchema = z.object({
  t: z.literal('tool-call-end'),
  call: z.string(),
});

export const sessionFileEventSchema = z.object({
  t: z.literal('file'),
  ref: z.string(),
  name: z.string(),
  size: z.number(),
  mimeType: z.string().optional(),
  image: z.object({
    width: z.number(),
    height: z.number(),
    thumbhash: z.string(),
  }).optional(),
});

export const sessionTurnStartEventSchema = z.object({
  t: z.literal('turn-start'),
});

export const sessionStartEventSchema = z.object({
  t: z.literal('start'),
  title: z.string().optional(),
});

export const sessionTurnEndStatusSchema = z.enum(['completed', 'failed', 'cancelled']);
export type SessionTurnEndStatus = z.infer<typeof sessionTurnEndStatusSchema>;

export const sessionTurnEndEventSchema = z.object({
  t: z.literal('turn-end'),
  status: sessionTurnEndStatusSchema,
});

export const sessionStopEventSchema = z.object({
  t: z.literal('stop'),
});

export const sessionEventSchema = z.discriminatedUnion('t', [
  sessionTextEventSchema,
  sessionServiceMessageEventSchema,
  sessionToolCallStartEventSchema,
  sessionToolCallEndEventSchema,
  sessionFileEventSchema,
  sessionTurnStartEventSchema,
  sessionStartEventSchema,
  sessionTurnEndEventSchema,
  sessionStopEventSchema,
]);

export type SessionEvent = z.infer<typeof sessionEventSchema>;

export const sessionEnvelopeSchema = z.object({
  id: z.string(),
  time: z.number(),
  role: sessionRoleSchema,
  turn: z.string().optional(),
  subagent: z.string().optional(),
  ev: sessionEventSchema,
}).superRefine((envelope, ctx) => {
  if (envelope.ev.t === 'service' && envelope.role !== 'agent') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'service events must use role "agent"',
      path: ['role'],
    });
  }
  if ((envelope.ev.t === 'start' || envelope.ev.t === 'stop') && envelope.role !== 'agent') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${envelope.ev.t} events must use role "agent"`,
      path: ['role'],
    });
  }
});

export type SessionEnvelope = z.infer<typeof sessionEnvelopeSchema>;

export type CreateEnvelopeOptions = {
  id?: string;
  time?: number;
  turn?: string;
  subagent?: string;
};

export function createEnvelope(
  role: SessionRole,
  ev: SessionEvent,
  opts: CreateEnvelopeOptions = {},
): SessionEnvelope {
  return sessionEnvelopeSchema.parse({
    id: opts.id ?? randomUUID(),
    time: opts.time ?? Date.now(),
    role,
    ...(opts.turn ? { turn: opts.turn } : {}),
    ...(opts.subagent ? { subagent: opts.subagent } : {}),
    ev,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/atlas-wire && npx vitest run src/sessionProtocol.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-wire/src/sessionProtocol.ts packages/atlas-wire/src/sessionProtocol.test.ts
git commit -m "feat(wire): add session protocol schemas with 9 event types"
```

---

### Task 5: Implement atlas-wire — messages schema

**Files:**
- Create: `packages/atlas-wire/src/messages.ts`
- Create: `packages/atlas-wire/src/messages.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/atlas-wire/src/messages.test.ts
import { describe, it, expect } from 'vitest';
import {
  SessionMessageSchema, MessageContentSchema,
  CoreUpdateBodySchema, CoreUpdateContainerSchema,
  type SessionMessage, type MessageContent,
} from './messages.js';

describe('SessionMessageSchema', () => {
  it('should parse valid session message', () => {
    const msg = SessionMessageSchema.parse({
      id: 'msg-1',
      seq: 1,
      content: { c: 'encrypted-data', t: 'encrypted' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(msg.id).toBe('msg-1');
    expect(msg.content.t).toBe('encrypted');
  });

  it('should accept null localId', () => {
    const msg = SessionMessageSchema.parse({
      id: 'msg-1',
      seq: 1,
      localId: null,
      content: { c: 'data', t: 'encrypted' },
      createdAt: 0,
      updatedAt: 0,
    });
    expect(msg.localId).toBeNull();
  });
});

describe('MessageContentSchema', () => {
  it('should parse user message', () => {
    const result = MessageContentSchema.parse({
      role: 'user',
      content: { type: 'text', text: 'Hello' },
    });
    expect(result.role).toBe('user');
  });

  it('should parse agent message', () => {
    const result = MessageContentSchema.parse({
      role: 'agent',
      content: { type: 'model-output' },
    });
    expect(result.role).toBe('agent');
  });

  it('should parse session protocol message', () => {
    const result = MessageContentSchema.parse({
      role: 'session',
      content: {
        id: 'env-1',
        time: Date.now(),
        role: 'agent',
        ev: { t: 'text', text: 'hello' },
      },
    });
    expect(result.role).toBe('session');
  });
});

describe('CoreUpdateBodySchema', () => {
  it('should parse new-message update', () => {
    const body = CoreUpdateBodySchema.parse({
      t: 'new-message',
      sid: 'session-1',
      message: {
        id: 'msg-1',
        seq: 1,
        content: { c: 'data', t: 'encrypted' },
        createdAt: 0,
        updatedAt: 0,
      },
    });
    expect(body.t).toBe('new-message');
  });

  it('should parse update-session', () => {
    const body = CoreUpdateBodySchema.parse({
      t: 'update-session',
      id: 'session-1',
    });
    expect(body.t).toBe('update-session');
  });
});

describe('CoreUpdateContainerSchema', () => {
  it('should parse full container', () => {
    const container = CoreUpdateContainerSchema.parse({
      id: 'update-1',
      seq: 42,
      body: { t: 'update-session', id: 'session-1' },
      createdAt: Date.now(),
    });
    expect(container.seq).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/atlas-wire && npx vitest run src/messages.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write implementation**

Port from `happy-wire/src/messages.ts`. Drop `VersionedEncryptedValueSchema` and machine-related schemas (not needed without cloud server). Keep the core message schemas.

```ts
// packages/atlas-wire/src/messages.ts
import * as z from 'zod';
import { sessionEnvelopeSchema } from './sessionProtocol.js';
import { MessageMetaSchema, type MessageMeta } from './messageMeta.js';
import { AgentMessageSchema, UserMessageSchema } from './legacyProtocol.js';

export const SessionMessageContentSchema = z.object({
  c: z.string(),
  t: z.literal('encrypted'),
});
export type SessionMessageContent = z.infer<typeof SessionMessageContentSchema>;

export const SessionMessageSchema = z.object({
  id: z.string(),
  seq: z.number(),
  localId: z.string().nullish(),
  content: SessionMessageContentSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type SessionMessage = z.infer<typeof SessionMessageSchema>;

export { MessageMetaSchema };
export type { MessageMeta };

export const SessionProtocolMessageSchema = z.object({
  role: z.literal('session'),
  content: sessionEnvelopeSchema,
  meta: MessageMetaSchema.optional(),
});
export type SessionProtocolMessage = z.infer<typeof SessionProtocolMessageSchema>;

export const MessageContentSchema = z.discriminatedUnion('role', [
  UserMessageSchema,
  AgentMessageSchema,
  SessionProtocolMessageSchema,
]);
export type MessageContent = z.infer<typeof MessageContentSchema>;

// Core update types (simplified — no machine/encrypted value schemas)

export const UpdateNewMessageBodySchema = z.object({
  t: z.literal('new-message'),
  sid: z.string(),
  message: SessionMessageSchema,
});
export type UpdateNewMessageBody = z.infer<typeof UpdateNewMessageBodySchema>;

export const UpdateSessionBodySchema = z.object({
  t: z.literal('update-session'),
  id: z.string(),
  metadata: z.unknown().optional(),
  agentState: z.unknown().optional(),
});
export type UpdateSessionBody = z.infer<typeof UpdateSessionBodySchema>;

export const CoreUpdateBodySchema = z.discriminatedUnion('t', [
  UpdateNewMessageBodySchema,
  UpdateSessionBodySchema,
]);
export type CoreUpdateBody = z.infer<typeof CoreUpdateBodySchema>;

export const CoreUpdateContainerSchema = z.object({
  id: z.string(),
  seq: z.number(),
  body: CoreUpdateBodySchema,
  createdAt: z.number(),
});
export type CoreUpdateContainer = z.infer<typeof CoreUpdateContainerSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/atlas-wire && npx vitest run src/messages.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-wire/src/messages.ts packages/atlas-wire/src/messages.test.ts
git commit -m "feat(wire): add core message schemas (SessionMessage, MessageContent, CoreUpdate)"
```

---

### Task 6: Implement atlas-wire — sessionControl schema

**Files:**
- Create: `packages/atlas-wire/src/sessionControl.ts`
- Create: `packages/atlas-wire/src/sessionControl.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/atlas-wire/src/sessionControl.test.ts
import { describe, it, expect } from 'vitest';
import { SessionControlEventSchema, type SessionControlEvent } from './sessionControl.js';

describe('SessionControlEventSchema', () => {
  it('should parse create event', () => {
    const ev = SessionControlEventSchema.parse({
      type: 'session-create',
      sessionId: 's-1',
      agentId: 'claude',
      cwd: '/workspace',
    });
    expect(ev.type).toBe('session-create');
  });

  it('should parse pause event', () => {
    const ev = SessionControlEventSchema.parse({
      type: 'session-pause',
      sessionId: 's-1',
    });
    expect(ev.type).toBe('session-pause');
  });

  it('should parse resume event', () => {
    const ev = SessionControlEventSchema.parse({
      type: 'session-resume',
      sessionId: 's-1',
    });
    expect(ev.type).toBe('session-resume');
  });

  it('should parse destroy event', () => {
    const ev = SessionControlEventSchema.parse({
      type: 'session-destroy',
      sessionId: 's-1',
      reason: 'user-requested',
    });
    expect(ev.type).toBe('session-destroy');
  });

  it('should reject unknown type', () => {
    expect(() =>
      SessionControlEventSchema.parse({ type: 'session-unknown', sessionId: 's-1' })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/atlas-wire && npx vitest run src/sessionControl.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write implementation**

```ts
// packages/atlas-wire/src/sessionControl.ts
import * as z from 'zod';

export const SessionCreateEventSchema = z.object({
  type: z.literal('session-create'),
  sessionId: z.string(),
  agentId: z.string(),
  cwd: z.string(),
  env: z.record(z.string(), z.string()).optional(),
});

export const SessionPauseEventSchema = z.object({
  type: z.literal('session-pause'),
  sessionId: z.string(),
});

export const SessionResumeEventSchema = z.object({
  type: z.literal('session-resume'),
  sessionId: z.string(),
});

export const SessionDestroyEventSchema = z.object({
  type: z.literal('session-destroy'),
  sessionId: z.string(),
  reason: z.string().optional(),
});

export const SessionControlEventSchema = z.discriminatedUnion('type', [
  SessionCreateEventSchema,
  SessionPauseEventSchema,
  SessionResumeEventSchema,
  SessionDestroyEventSchema,
]);

export type SessionControlEvent = z.infer<typeof SessionControlEventSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/atlas-wire && npx vitest run src/sessionControl.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-wire/src/sessionControl.ts packages/atlas-wire/src/sessionControl.test.ts
git commit -m "feat(wire): add session control events (create, pause, resume, destroy)"
```

---

### Task 7: Implement atlas-wire — barrel export + full test

**Files:**
- Create: `packages/atlas-wire/src/index.ts`
- Create: `packages/atlas-wire/src/voice.ts` (optional, low priority)

- [ ] **Step 1: Create barrel export**

```ts
// packages/atlas-wire/src/index.ts
export * from './messages.js';
export * from './messageMeta.js';
export * from './legacyProtocol.js';
export * from './sessionProtocol.js';
export * from './sessionControl.js';
```

- [ ] **Step 2: Create voice schema (optional, stub)**

```ts
// packages/atlas-wire/src/voice.ts
import * as z from 'zod';

export const VoiceTokenAllowedSchema = z.object({
  allowed: z.literal(true),
  token: z.string(),
  agentId: z.string(),
});

export const VoiceTokenDeniedSchema = z.object({
  allowed: z.literal(false),
  reason: z.enum(['voice_limit_reached', 'subscription_required']),
  agentId: z.string(),
});

export const VoiceTokenResponseSchema = z.discriminatedUnion('allowed', [
  VoiceTokenAllowedSchema,
  VoiceTokenDeniedSchema,
]);

export type VoiceTokenResponse = z.infer<typeof VoiceTokenResponseSchema>;
```

- [ ] **Step 3: Run full test suite for atlas-wire**

```bash
cd packages/atlas-wire && npx vitest run
```

Expected: ALL PASS (all test files)

- [ ] **Step 4: Build atlas-wire**

```bash
cd packages/atlas-wire && npx tsc
```

Expected: Clean build, `dist/` generated with `.js` + `.d.ts` files

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-wire/src/index.ts packages/atlas-wire/src/voice.ts
git commit -m "feat(wire): complete atlas-wire package with barrel export"
```

---

## Chunk 2: atlas-agent — Agent Layer

### Task 8: Implement atlas-agent — AgentMessage types

**Files:**
- Create: `packages/atlas-agent/src/core/AgentMessage.ts`
- Create: `packages/atlas-agent/src/core/AgentMessage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/atlas-agent/src/core/AgentMessage.test.ts
import { describe, it, expect } from 'vitest';
import {
  isModelOutputMessage, isStatusMessage, isToolCallMessage,
  isPermissionRequestMessage, getMessageText,
  type AgentMessage, type ModelOutputMessage,
} from './AgentMessage.js';

describe('AgentMessage type guards', () => {
  it('isModelOutputMessage', () => {
    const msg: AgentMessage = { type: 'model-output', textDelta: 'hi' };
    expect(isModelOutputMessage(msg)).toBe(true);
    expect(isStatusMessage(msg)).toBe(false);
  });

  it('isStatusMessage', () => {
    const msg: AgentMessage = { type: 'status', status: 'running' };
    expect(isStatusMessage(msg)).toBe(true);
  });

  it('isToolCallMessage', () => {
    const msg: AgentMessage = { type: 'tool-call', toolName: 'Read', args: {}, callId: 'c1' };
    expect(isToolCallMessage(msg)).toBe(true);
  });

  it('isPermissionRequestMessage', () => {
    const msg: AgentMessage = { type: 'permission-request', id: 'p1', reason: 'test', payload: {} };
    expect(isPermissionRequestMessage(msg)).toBe(true);
  });
});

describe('getMessageText', () => {
  it('should return textDelta', () => {
    const msg: ModelOutputMessage = { type: 'model-output', textDelta: 'hello' };
    expect(getMessageText(msg)).toBe('hello');
  });

  it('should return fullText when no delta', () => {
    const msg: ModelOutputMessage = { type: 'model-output', fullText: 'complete' };
    expect(getMessageText(msg)).toBe('complete');
  });

  it('should return empty string when no text', () => {
    const msg: ModelOutputMessage = { type: 'model-output' };
    expect(getMessageText(msg)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/atlas-agent && npx vitest run src/core/AgentMessage.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write implementation**

Port directly from `happy-main/packages/happy-cli/src/agent/core/AgentMessage.ts`. This is a direct copy — the 13-type union with interfaces and type guards.

```ts
// packages/atlas-agent/src/core/AgentMessage.ts

export type SessionId = string;
export type ToolCallId = string;
export type AgentStatus = 'starting' | 'running' | 'idle' | 'stopped' | 'error';

export interface ModelOutputMessage {
  type: 'model-output';
  textDelta?: string;
  fullText?: string;
}

export interface StatusMessage {
  type: 'status';
  status: AgentStatus;
  detail?: string;
}

export interface ToolCallMessage {
  type: 'tool-call';
  toolName: string;
  args: Record<string, unknown>;
  callId: ToolCallId;
}

export interface ToolResultMessage {
  type: 'tool-result';
  toolName: string;
  result: unknown;
  callId: ToolCallId;
}

export interface PermissionRequestMessage {
  type: 'permission-request';
  id: string;
  reason: string;
  payload: unknown;
}

export interface PermissionResponseMessage {
  type: 'permission-response';
  id: string;
  approved: boolean;
}

export interface FsEditMessage {
  type: 'fs-edit';
  description: string;
  diff?: string;
  path?: string;
}

export interface TerminalOutputMessage {
  type: 'terminal-output';
  data: string;
}

export interface EventMessage {
  type: 'event';
  name: string;
  payload: unknown;
}

export interface TokenCountMessage {
  type: 'token-count';
  [key: string]: unknown;
}

export interface ExecApprovalRequestMessage {
  type: 'exec-approval-request';
  call_id: string;
  [key: string]: unknown;
}

export interface PatchApplyBeginMessage {
  type: 'patch-apply-begin';
  call_id: string;
  auto_approved?: boolean;
  changes: Record<string, unknown>;
}

export interface PatchApplyEndMessage {
  type: 'patch-apply-end';
  call_id: string;
  stdout?: string;
  stderr?: string;
  success: boolean;
}

export type AgentMessage =
  | ModelOutputMessage
  | StatusMessage
  | ToolCallMessage
  | ToolResultMessage
  | PermissionRequestMessage
  | PermissionResponseMessage
  | FsEditMessage
  | TerminalOutputMessage
  | EventMessage
  | TokenCountMessage
  | ExecApprovalRequestMessage
  | PatchApplyBeginMessage
  | PatchApplyEndMessage;

export type AgentMessageHandler = (msg: AgentMessage) => void;

export function isModelOutputMessage(msg: AgentMessage): msg is ModelOutputMessage {
  return msg.type === 'model-output';
}

export function isStatusMessage(msg: AgentMessage): msg is StatusMessage {
  return msg.type === 'status';
}

export function isToolCallMessage(msg: AgentMessage): msg is ToolCallMessage {
  return msg.type === 'tool-call';
}

export function isToolResultMessage(msg: AgentMessage): msg is ToolResultMessage {
  return msg.type === 'tool-result';
}

export function isPermissionRequestMessage(msg: AgentMessage): msg is PermissionRequestMessage {
  return msg.type === 'permission-request';
}

export function getMessageText(msg: ModelOutputMessage): string {
  return msg.textDelta ?? msg.fullText ?? '';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/atlas-agent && npx vitest run src/core/AgentMessage.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-agent/src/core/AgentMessage.ts packages/atlas-agent/src/core/AgentMessage.test.ts
git commit -m "feat(agent): add 13-type AgentMessage union with type guards"
```

---

### Task 9: Implement atlas-agent — AgentBackend interface + AgentRegistry

**Files:**
- Create: `packages/atlas-agent/src/core/AgentBackend.ts`
- Create: `packages/atlas-agent/src/core/AgentRegistry.ts`
- Create: `packages/atlas-agent/src/core/AgentRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/atlas-agent/src/core/AgentRegistry.test.ts
import { describe, it, expect } from 'vitest';
import { AgentRegistry } from './AgentRegistry.js';
import type { AgentBackend } from './AgentBackend.js';

function createMockBackend(): AgentBackend {
  return {
    startSession: async () => ({ sessionId: 'mock-session' }),
    sendPrompt: async () => {},
    cancel: async () => {},
    onMessage: () => {},
    dispose: async () => {},
  };
}

describe('AgentRegistry', () => {
  it('should register and create agents', () => {
    const registry = new AgentRegistry();
    registry.register('claude', () => createMockBackend());
    expect(registry.has('claude')).toBe(true);
    const backend = registry.create('claude', { cwd: '/tmp' });
    expect(backend).toBeDefined();
  });

  it('should list registered agents', () => {
    const registry = new AgentRegistry();
    registry.register('claude', () => createMockBackend());
    registry.register('gemini', () => createMockBackend());
    expect(registry.list()).toEqual(['claude', 'gemini']);
  });

  it('should throw on unknown agent', () => {
    const registry = new AgentRegistry();
    expect(() => registry.create('codex', { cwd: '/tmp' })).toThrow('Unknown agent: codex');
  });

  it('should report has=false for unregistered', () => {
    const registry = new AgentRegistry();
    expect(registry.has('claude')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/atlas-agent && npx vitest run src/core/AgentRegistry.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write AgentBackend interface**

```ts
// packages/atlas-agent/src/core/AgentBackend.ts
import type { AgentMessage, AgentMessageHandler, SessionId } from './AgentMessage.js';

export type { SessionId };

export type AgentId =
  | 'claude' | 'claude-acp'
  | 'codex' | 'codex-acp'
  | 'gemini'
  | 'opencode'
  | 'openclaw'
  | 'cursor';

export type AgentTransport = 'native-claude' | 'mcp-codex' | 'acp';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentBackendConfig {
  cwd: string;
  agentName: AgentId;
  transport: AgentTransport;
  env?: Record<string, string>;
  mcpServers?: Record<string, McpServerConfig>;
}

export interface StartSessionResult {
  sessionId: SessionId;
}

export interface AgentBackend {
  startSession(initialPrompt?: string): Promise<StartSessionResult>;
  sendPrompt(sessionId: SessionId, prompt: string): Promise<void>;
  cancel(sessionId: SessionId): Promise<void>;
  onMessage(handler: AgentMessageHandler): void;
  offMessage?(handler: AgentMessageHandler): void;
  respondToPermission?(requestId: string, approved: boolean): Promise<void>;
  waitForResponseComplete?(timeoutMs?: number): Promise<void>;
  dispose(): Promise<void>;
}
```

- [ ] **Step 4: Write AgentRegistry**

```ts
// packages/atlas-agent/src/core/AgentRegistry.ts
import type { AgentBackend, AgentId } from './AgentBackend.js';

export interface AgentFactoryOptions {
  cwd: string;
  env?: Record<string, string>;
}

export type AgentFactory = (opts: AgentFactoryOptions) => AgentBackend;

export class AgentRegistry {
  private factories = new Map<string, AgentFactory>();

  register(id: AgentId, factory: AgentFactory): void {
    this.factories.set(id, factory);
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  list(): string[] {
    return Array.from(this.factories.keys());
  }

  create(id: string, opts: AgentFactoryOptions): AgentBackend {
    const factory = this.factories.get(id);
    if (!factory) {
      const available = this.list().join(', ') || 'none';
      throw new Error(`Unknown agent: ${id}. Available agents: ${available}`);
    }
    return factory(opts);
  }
}

export const agentRegistry = new AgentRegistry();
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/atlas-agent && npx vitest run src/core/AgentRegistry.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/atlas-agent/src/core/
git commit -m "feat(agent): add AgentBackend interface, AgentId types, and AgentRegistry"
```

---

### Task 10: Implement atlas-agent — TransportHandler + DefaultTransport

**Files:**
- Create: `packages/atlas-agent/src/transport/TransportHandler.ts`
- Create: `packages/atlas-agent/src/transport/DefaultTransport.ts`
- Create: `packages/atlas-agent/src/transport/DefaultTransport.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/atlas-agent/src/transport/DefaultTransport.test.ts
import { describe, it, expect } from 'vitest';
import { DefaultTransport } from './DefaultTransport.js';

describe('DefaultTransport', () => {
  const transport = new DefaultTransport('test-agent');

  it('should have correct agent name', () => {
    expect(transport.agentName).toBe('test-agent');
  });

  it('should return 60s init timeout', () => {
    expect(transport.getInitTimeout()).toBe(60_000);
  });

  it('should filter non-JSON stdout lines', () => {
    expect(transport.filterStdoutLine('debug: something')).toBeNull();
    expect(transport.filterStdoutLine('')).toBeNull();
    expect(transport.filterStdoutLine('  ')).toBeNull();
  });

  it('should pass valid JSON lines', () => {
    expect(transport.filterStdoutLine('{"type":"test"}')).toBe('{"type":"test"}');
    expect(transport.filterStdoutLine('[1,2,3]')).toBe('[1,2,3]');
  });

  it('should filter invalid JSON that looks like JSON', () => {
    expect(transport.filterStdoutLine('{invalid json}')).toBeNull();
  });

  it('should return empty tool patterns', () => {
    expect(transport.getToolPatterns()).toEqual([]);
  });

  it('should return 2min default tool call timeout', () => {
    expect(transport.getToolCallTimeout('any')).toBe(120_000);
  });

  it('should return 30s think timeout', () => {
    expect(transport.getToolCallTimeout('any', 'think')).toBe(30_000);
  });

  it('should not identify investigation tools', () => {
    expect(transport.isInvestigationTool('any')).toBe(false);
  });

  it('should pass through tool name', () => {
    expect(transport.determineToolName('Read', 'c1', {}, {
      recentPromptHadChangeTitle: false,
      toolCallCountSincePrompt: 0,
    })).toBe('Read');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/atlas-agent && npx vitest run src/transport/DefaultTransport.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write TransportHandler interface**

```ts
// packages/atlas-agent/src/transport/TransportHandler.ts
import type { AgentMessage } from '../core/AgentMessage.js';

export interface ToolPattern {
  name: string;
  patterns: string[];
}

export interface StderrContext {
  activeToolCalls: Set<string>;
  hasActiveInvestigation: boolean;
}

export interface ToolNameContext {
  recentPromptHadChangeTitle: boolean;
  toolCallCountSincePrompt: number;
}

export interface StderrResult {
  message: AgentMessage | null;
  suppress?: boolean;
}

export interface TransportHandler {
  readonly agentName: string;
  getInitTimeout(): number;
  filterStdoutLine?(line: string): string | null;
  handleStderr?(text: string, context: StderrContext): StderrResult;
  getToolPatterns(): ToolPattern[];
  isInvestigationTool?(toolCallId: string, toolKind?: string): boolean;
  getToolCallTimeout?(toolCallId: string, toolKind?: string): number;
  extractToolNameFromId?(toolCallId: string): string | null;
  determineToolName?(
    toolName: string,
    toolCallId: string,
    input: Record<string, unknown>,
    context: ToolNameContext,
  ): string;
  getIdleTimeout?(): number;
}
```

- [ ] **Step 4: Write DefaultTransport**

```ts
// packages/atlas-agent/src/transport/DefaultTransport.ts
import type {
  TransportHandler, ToolPattern, StderrContext, StderrResult, ToolNameContext,
} from './TransportHandler.js';

const DEFAULT_TIMEOUTS = {
  init: 60_000,
  toolCall: 120_000,
  investigation: 600_000,
  think: 30_000,
} as const;

export class DefaultTransport implements TransportHandler {
  readonly agentName: string;

  constructor(agentName: string = 'generic-acp') {
    this.agentName = agentName;
  }

  getInitTimeout(): number {
    return DEFAULT_TIMEOUTS.init;
  }

  filterStdoutLine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null) return null;
      return line;
    } catch {
      return null;
    }
  }

  handleStderr(_text: string, _context: StderrContext): StderrResult {
    return { message: null };
  }

  getToolPatterns(): ToolPattern[] {
    return [];
  }

  isInvestigationTool(_toolCallId: string, _toolKind?: string): boolean {
    return false;
  }

  getToolCallTimeout(_toolCallId: string, toolKind?: string): number {
    if (toolKind === 'think') return DEFAULT_TIMEOUTS.think;
    return DEFAULT_TIMEOUTS.toolCall;
  }

  extractToolNameFromId(_toolCallId: string): string | null {
    return null;
  }

  determineToolName(
    toolName: string,
    _toolCallId: string,
    _input: Record<string, unknown>,
    _context: ToolNameContext,
  ): string {
    return toolName;
  }
}

export const defaultTransport = new DefaultTransport();
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/atlas-agent && npx vitest run src/transport/DefaultTransport.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/atlas-agent/src/transport/
git commit -m "feat(agent): add TransportHandler interface and DefaultTransport"
```

---

### Task 11: Implement atlas-agent — barrel exports + build verification

**Files:**
- Create: `packages/atlas-agent/src/core/index.ts`
- Create: `packages/atlas-agent/src/transport/index.ts`
- Create: `packages/atlas-agent/src/index.ts`

- [ ] **Step 1: Create barrel exports**

```ts
// packages/atlas-agent/src/core/index.ts
export * from './AgentMessage.js';
export * from './AgentBackend.js';
export * from './AgentRegistry.js';
```

```ts
// packages/atlas-agent/src/transport/index.ts
export * from './TransportHandler.js';
export * from './DefaultTransport.js';
```

```ts
// packages/atlas-agent/src/index.ts
export * from './core/index.js';
export * from './transport/index.js';
```

- [ ] **Step 2: Run full test suite**

```bash
cd packages/atlas-agent && npx vitest run
```

Expected: ALL PASS

- [ ] **Step 3: Build atlas-agent**

```bash
cd packages/atlas-wire && npx tsc && cd ../atlas-agent && npx tsc
```

Expected: Clean build for both packages

- [ ] **Step 4: Commit**

```bash
git add packages/atlas-agent/src/core/index.ts packages/atlas-agent/src/transport/index.ts packages/atlas-agent/src/index.ts
git commit -m "feat(agent): complete atlas-agent core package with barrel exports"
```

---

## Chunk 3: atlas-gateway — Core Engine + Channel Interfaces

### Task 12: Implement atlas-gateway — ChannelAdapter + ChannelSender interfaces

**Files:**
- Create: `packages/atlas-gateway/src/channel/ChannelAdapter.ts`
- Create: `packages/atlas-gateway/src/channel/ChannelSender.ts`
- Create: `packages/atlas-gateway/src/channel/channelEvent.ts`

- [ ] **Step 1: Write ChannelAdapter interface**

```ts
// packages/atlas-gateway/src/channel/ChannelAdapter.ts
import type { ChannelEvent } from './channelEvent.js';

export type MessageHandler = (event: ChannelEvent) => Promise<void>;

export interface ChannelAdapter {
  readonly id: string;
  start(handler: MessageHandler): Promise<void>;
  stop(): Promise<void>;
  getSender(chatId: string): import('./ChannelSender.js').ChannelSender;
}
```

- [ ] **Step 2: Write ChannelSender interface**

```ts
// packages/atlas-gateway/src/channel/ChannelSender.ts
import type { CardModel } from '../cards/CardModel.js';

export interface ChannelSender {
  sendText(text: string, replyTo?: string): Promise<string>;
  sendMarkdown(md: string, replyTo?: string): Promise<string>;
  sendCard(card: CardModel, replyTo?: string): Promise<string>;
  updateCard(messageId: string, card: CardModel): Promise<void>;
  addReaction?(messageId: string, emoji: string): Promise<void>;
  removeReaction?(messageId: string, emoji: string): Promise<void>;
  sendImage?(imageData: Buffer, replyTo?: string): Promise<string>;
  sendFile?(fileData: Buffer, filename: string, replyTo?: string): Promise<string>;
  showTyping?(chatId: string): Promise<void>;
}
```

- [ ] **Step 3: Write channelEvent schema**

```ts
// packages/atlas-gateway/src/channel/channelEvent.ts
import * as z from 'zod';

export const ChannelEventSchema = z.object({
  channelId: z.string(),
  chatId: z.string(),
  userId: z.string(),
  userName: z.string(),
  messageId: z.string(),
  content: z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({ type: z.literal('image'), url: z.string(), mimeType: z.string().optional() }),
    z.object({ type: z.literal('file'), url: z.string(), filename: z.string(), mimeType: z.string().optional() }),
    z.object({ type: z.literal('audio'), url: z.string(), duration: z.number().optional() }),
  ]),
  timestamp: z.number(),
  replyToId: z.string().optional(),
});

export type ChannelEvent = z.infer<typeof ChannelEventSchema>;
export type UserMessageContent = ChannelEvent['content'];
```

- [ ] **Step 4: Commit**

```bash
git add packages/atlas-gateway/src/channel/
git commit -m "feat(gateway): add ChannelAdapter, ChannelSender interfaces and ChannelEvent schema"
```

---

### Task 13: Implement atlas-gateway — CardModel

**Files:**
- Create: `packages/atlas-gateway/src/cards/CardModel.ts`
- Create: `packages/atlas-gateway/src/cards/CardModel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/atlas-gateway/src/cards/CardModel.test.ts
import { describe, it, expect } from 'vitest';
import { CardModelSchema, type CardModel } from './CardModel.js';

describe('CardModelSchema', () => {
  it('should parse minimal card', () => {
    const card = CardModelSchema.parse({ sections: [] });
    expect(card.sections).toEqual([]);
  });

  it('should parse full card', () => {
    const card: CardModel = {
      header: { title: 'Test', status: 'running' },
      sections: [
        { type: 'markdown', content: '**hello**' },
        { type: 'divider' },
        { type: 'fields', fields: [{ label: 'Agent', value: 'Claude', short: true }] },
      ],
      actions: [
        { type: 'button', label: 'Allow', value: 'allow', style: 'primary' },
        { type: 'button', label: 'Deny', value: 'deny', style: 'danger' },
      ],
    };
    const result = CardModelSchema.parse(card);
    expect(result.header?.status).toBe('running');
    expect(result.sections).toHaveLength(3);
    expect(result.actions).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/atlas-gateway && npx vitest run src/cards/CardModel.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write implementation**

```ts
// packages/atlas-gateway/src/cards/CardModel.ts
import * as z from 'zod';

export const CardHeaderSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  icon: z.string().optional(),
  status: z.enum(['running', 'done', 'error', 'waiting']).optional(),
});

export const CardFieldSchema = z.object({
  label: z.string(),
  value: z.string(),
  short: z.boolean().optional(),
});

export const CardSectionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('markdown'), content: z.string() }),
  z.object({ type: z.literal('fields'), fields: z.array(CardFieldSchema) }),
  z.object({ type: z.literal('divider') }),
  z.object({ type: z.literal('note'), content: z.string() }),
]);

export const CardActionSchema = z.object({
  type: z.enum(['button', 'select']),
  label: z.string(),
  value: z.string(),
  style: z.enum(['primary', 'danger', 'default']).optional(),
});

export const CardModelSchema = z.object({
  header: CardHeaderSchema.optional(),
  sections: z.array(CardSectionSchema),
  actions: z.array(CardActionSchema).optional(),
});

export type CardHeader = z.infer<typeof CardHeaderSchema>;
export type CardField = z.infer<typeof CardFieldSchema>;
export type CardSection = z.infer<typeof CardSectionSchema>;
export type CardAction = z.infer<typeof CardActionSchema>;
export type CardModel = z.infer<typeof CardModelSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/atlas-gateway && npx vitest run src/cards/CardModel.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-gateway/src/cards/
git commit -m "feat(gateway): add CardModel abstract card representation"
```

---

### Task 14: Implement atlas-app-logs — HTTP Log Receiver

**Files:**
- Create: `packages/atlas-app-logs/src/format.ts`
- Create: `packages/atlas-app-logs/src/writer.ts`
- Create: `packages/atlas-app-logs/src/server.ts`
- Create: `packages/atlas-app-logs/src/index.ts`
- Create: `packages/atlas-app-logs/src/server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/atlas-app-logs/src/server.test.ts
import { describe, it, expect } from 'vitest';
import { formatLogEntry, type LogEntry } from './format.js';

describe('formatLogEntry', () => {
  it('should format log entry', () => {
    const entry: LogEntry = {
      timestamp: '2026-03-30T10:30:45.123Z',
      level: 'INFO',
      message: 'Server started',
      source: 'gateway',
      platform: 'feishu',
    };
    const result = formatLogEntry(entry);
    expect(result).toContain('[INFO]');
    expect(result).toContain('[gateway/feishu]');
    expect(result).toContain('Server started');
  });

  it('should handle missing platform', () => {
    const entry: LogEntry = {
      timestamp: '2026-03-30T10:30:45.123Z',
      level: 'ERROR',
      message: 'Failed',
      source: 'agent',
    };
    const result = formatLogEntry(entry);
    expect(result).toContain('[agent]');
    expect(result).not.toContain('undefined');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/atlas-app-logs && npx vitest run
```

Expected: FAIL

- [ ] **Step 3: Write format.ts**

```ts
// packages/atlas-app-logs/src/format.ts
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  source: string;
  platform?: string;
}

export function formatLogEntry(entry: LogEntry): string {
  const date = new Date(entry.timestamp);
  const time = [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join(':') + '.' + String(date.getMilliseconds()).padStart(3, '0');

  const source = entry.platform
    ? `${entry.source}/${entry.platform}`
    : entry.source;

  return `[${time}] [${entry.level}] [${source}] ${entry.message}`;
}
```

- [ ] **Step 4: Write writer.ts**

```ts
// packages/atlas-app-logs/src/writer.ts
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class LogWriter {
  private logDir: string;
  private logFile: string;

  constructor(logDir?: string) {
    this.logDir = logDir ?? join(homedir(), '.atlasOS', 'app-logs');
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
    const date = new Date().toISOString().slice(0, 10);
    this.logFile = join(this.logDir, `${date}.log`);
  }

  write(formatted: string): void {
    console.log(formatted);
    appendFileSync(this.logFile, formatted + '\n');
  }
}
```

- [ ] **Step 5: Write server.ts**

```ts
// packages/atlas-app-logs/src/server.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { formatLogEntry, type LogEntry } from './format.js';
import { LogWriter } from './writer.js';

export function startLogServer(port: number = 8787): ReturnType<typeof createServer> {
  const writer = new LogWriter();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url === '/logs') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const entry: LogEntry = JSON.parse(body);
          const formatted = formatLogEntry(entry);
          writer.write(formatted);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"invalid JSON"}');
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    console.log(`atlas-app-logs listening on port ${port}`);
  });

  return server;
}
```

- [ ] **Step 6: Write index.ts**

```ts
// packages/atlas-app-logs/src/index.ts
export { startLogServer } from './server.js';
export { formatLogEntry, type LogEntry } from './format.js';
export { LogWriter } from './writer.js';
```

- [ ] **Step 7: Run test to verify it passes**

```bash
cd packages/atlas-app-logs && npx vitest run
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/atlas-app-logs/src/
git commit -m "feat(app-logs): add HTTP log receiver with file writer"
```

---

## Chunk 4: Remaining Gateway + CLI (follow-on plan)

Tasks 15+ cover:
- **CardEngine** — mapping AgentMessage → CardModel for each message type
- **StreamingCard** — batched live-updating card output
- **PermissionCard** — interactive permission request card
- **SessionManager** — session lifecycle with file persistence
- **SessionQueue** — per-session serial async queue
- **CommandRegistry** — slash commands with prefix matching
- **Engine** — central orchestrator wiring channels to agents
- **Feishu channel adapter** — port from current `src/platform/feishu/`
- **Telegram/DingTalk/Discord adapters** — port from current `src/platform/`
- **atlas-cli** — entry point, daemon, auth, session commands
- **Config migration** — v1 → v2 config format

These will be detailed in a follow-on plan (`2026-03-30-atlas-ai-migration-phase2.md`) after Chunk 1-3 are implemented and validated.

---

## Summary

| Chunk | Tasks | Packages | Commits |
|-------|-------|----------|---------|
| 1: Scaffold + Wire | 1-7 | atlas-wire | ~7 |
| 2: Agent Layer | 8-11 | atlas-agent | ~4 |
| 3: Gateway Core | 12-14 | atlas-gateway, atlas-app-logs | ~3 |
| 4: Gateway + CLI (phase 2) | 15+ | atlas-gateway, atlas-cli | TBD |

**Total Phase 1:** 14 tasks, ~14 commits, 4 packages with tests.
