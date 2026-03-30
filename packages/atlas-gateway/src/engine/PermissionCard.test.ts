import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  PermissionPayloadValidatorImpl,
  PermissionCardBuilderImpl,
  PermissionActionPayloadSchema,
} from './PermissionCard.js';
import type {
  PermissionActionPayload,
  PermissionAction,
  PermissionScope,
} from './PermissionCard.js';

// ── PayloadValidator ────────────────────────────────────────────────────────

describe('PermissionPayloadValidator', () => {
  let validator: PermissionPayloadValidatorImpl;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    validator = new PermissionPayloadValidatorImpl();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── createPayload ───────────────────────────────────────────────────────

  describe('createPayload', () => {
    it('creates a valid payload with default TTL', () => {
      const payload = validator.createPayload({
        action: 'approve',
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolName: 'Bash',
        toolCallId: 'tc-1',
        agentType: 'claude',
      });

      expect(payload.v).toBe(1);
      expect(payload.nonce).toBeTruthy();
      expect(payload.iat).toBe(1_000_000);
      expect(payload.exp).toBe(1_000_000 + 300_000); // 5 min default
      expect(payload.action).toBe('approve');
      expect(payload.sessionId).toBe('sess-1');
      expect(payload.requestId).toBe('req-1');
      expect(payload.toolName).toBe('Bash');
      expect(payload.toolCallId).toBe('tc-1');
      expect(payload.agentType).toBe('claude');
      expect(payload.scope).toBeUndefined();
    });

    it('creates a payload with custom TTL', () => {
      const payload = validator.createPayload({
        action: 'deny',
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolName: 'Edit',
        toolCallId: 'tc-2',
        agentType: 'codex',
        ttlMs: 60_000,
      });

      expect(payload.exp).toBe(1_000_000 + 60_000);
    });

    it('creates a payload with scope', () => {
      const scope: PermissionScope = { type: 'all_edits' };
      const payload = validator.createPayload({
        action: 'approve_scoped',
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolName: 'Edit',
        toolCallId: 'tc-3',
        agentType: 'claude',
        scope,
      });

      expect(payload.scope).toEqual({ type: 'all_edits' });
    });

    it('generates unique nonces for each call', () => {
      const p1 = validator.createPayload({
        action: 'approve',
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolName: 'Bash',
        toolCallId: 'tc-1',
        agentType: 'claude',
      });
      const p2 = validator.createPayload({
        action: 'approve',
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolName: 'Bash',
        toolCallId: 'tc-1',
        agentType: 'claude',
      });

      expect(p1.nonce).not.toBe(p2.nonce);
    });

    it('created payload passes Zod schema validation', () => {
      const payload = validator.createPayload({
        action: 'approve',
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolName: 'Bash',
        toolCallId: 'tc-1',
        agentType: 'claude',
      });

      const result = PermissionActionPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  // ── validate ────────────────────────────────────────────────────────────

  describe('validate', () => {
    function makeValidPayload(overrides?: Partial<PermissionActionPayload>): PermissionActionPayload {
      return validator.createPayload({
        action: 'approve',
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolName: 'Bash',
        toolCallId: 'tc-1',
        agentType: 'claude',
        ...overrides,
      });
    }

    it('accepts a valid payload', () => {
      const payload = makeValidPayload();
      const result = validator.validate(payload);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.action).toBe('approve');
      }
    });

    it('rejects payload with wrong version', () => {
      const payload = { ...makeValidPayload(), v: 2 };
      const result = validator.validate(payload);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Schema validation failed');
      }
    });

    it('rejects expired payload', () => {
      const payload = makeValidPayload();
      // Advance time past expiry
      vi.setSystemTime(1_000_000 + 300_001);
      const result = validator.validate(payload);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Payload expired');
      }
    });

    it('accepts payload exactly at expiry boundary', () => {
      const payload = makeValidPayload();
      // Set time exactly at exp
      vi.setSystemTime(payload.exp);
      const result = validator.validate(payload);
      expect(result.ok).toBe(true);
    });

    it('rejects payload one ms past expiry', () => {
      const payload = makeValidPayload();
      vi.setSystemTime(payload.exp + 1);
      const result = validator.validate(payload);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Payload expired');
      }
    });

    it('rejects replayed nonce', () => {
      const payload = makeValidPayload();
      // First validation succeeds
      const first = validator.validate(payload);
      expect(first.ok).toBe(true);

      // Second validation with same nonce fails
      const second = validator.validate(payload);
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.error).toContain('replay detected');
      }
    });

    it('rejects non-object payload', () => {
      const result = validator.validate('not an object');
      expect(result.ok).toBe(false);
    });

    it('rejects null payload', () => {
      const result = validator.validate(null);
      expect(result.ok).toBe(false);
    });

    it('rejects payload with missing fields', () => {
      const result = validator.validate({ v: 1 });
      expect(result.ok).toBe(false);
    });

    it('rejects payload with invalid action', () => {
      const payload = { ...makeValidPayload(), action: 'invalid_action' };
      const result = validator.validate(payload);
      expect(result.ok).toBe(false);
    });

    it('rejects payload with invalid agentType', () => {
      const payload = { ...makeValidPayload(), agentType: 'gpt' };
      const result = validator.validate(payload);
      expect(result.ok).toBe(false);
    });

    it('rejects payload with invalid nonce format', () => {
      const payload = { ...makeValidPayload(), nonce: 'not-a-uuid' };
      const result = validator.validate(payload);
      expect(result.ok).toBe(false);
    });

    it('rejects payload with empty sessionId', () => {
      const payload = { ...makeValidPayload(), sessionId: '' };
      const result = validator.validate(payload);
      expect(result.ok).toBe(false);
    });

    it('validates payload with this_tool scope', () => {
      const payload = validator.createPayload({
        action: 'approve_scoped',
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolName: 'Bash',
        toolCallId: 'tc-1',
        agentType: 'claude',
        scope: { type: 'this_tool', toolIdentifier: 'Bash' },
      });

      const result = validator.validate(payload);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.scope).toEqual({ type: 'this_tool', toolIdentifier: 'Bash' });
      }
    });

    it('validates payload with session scope', () => {
      const payload = validator.createPayload({
        action: 'approve_scoped',
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolName: 'Bash',
        toolCallId: 'tc-1',
        agentType: 'codex',
        scope: { type: 'session' },
      });

      const result = validator.validate(payload);
      expect(result.ok).toBe(true);
    });

    it('validates payload with command scope', () => {
      const payload = validator.createPayload({
        action: 'approve_scoped',
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolName: 'Bash',
        toolCallId: 'tc-1',
        agentType: 'claude',
        scope: { type: 'command', command: 'npm test' },
      });

      const result = validator.validate(payload);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.scope).toEqual({ type: 'command', command: 'npm test' });
      }
    });

    it('rejects invalid scope type', () => {
      const payload = {
        ...makeValidPayload(),
        scope: { type: 'unknown_scope' },
      };
      const result = validator.validate(payload);
      expect(result.ok).toBe(false);
    });
  });

  // ── cleanup ─────────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('removes expired nonces', () => {
      const p1 = validator.createPayload({
        action: 'approve',
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolName: 'Bash',
        toolCallId: 'tc-1',
        agentType: 'claude',
      });
      const p2 = validator.createPayload({
        action: 'deny',
        sessionId: 'sess-1',
        requestId: 'req-2',
        toolName: 'Bash',
        toolCallId: 'tc-2',
        agentType: 'claude',
      });

      // Validate both to register nonces
      validator.validate(p1);
      validator.validate(p2);

      // Advance time past nonce retention (10 minutes)
      vi.setSystemTime(1_000_000 + 600_001);

      const removed = validator.cleanup();
      expect(removed).toBe(2);
    });

    it('does not remove nonces that have not expired', () => {
      const payload = validator.createPayload({
        action: 'approve',
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolName: 'Bash',
        toolCallId: 'tc-1',
        agentType: 'claude',
      });

      validator.validate(payload);

      // Advance time but not past retention
      vi.setSystemTime(1_000_000 + 300_000);

      const removed = validator.cleanup();
      expect(removed).toBe(0);
    });

    it('returns 0 when no nonces are stored', () => {
      expect(validator.cleanup()).toBe(0);
    });

    it('after cleanup, a previously-used nonce can be reused (if re-created)', () => {
      const payload = validator.createPayload({
        action: 'approve',
        sessionId: 'sess-1',
        requestId: 'req-1',
        toolName: 'Bash',
        toolCallId: 'tc-1',
        agentType: 'claude',
      });

      // Validate to register nonce
      const first = validator.validate(payload);
      expect(first.ok).toBe(true);

      // Replay immediately fails
      const replay = validator.validate(payload);
      expect(replay.ok).toBe(false);

      // Advance past nonce retention and cleanup
      vi.setSystemTime(1_000_000 + 600_001);
      validator.cleanup();

      // Build a fresh payload that happens to overlap time-wise but has new nonce
      // The old nonce from `payload` is now cleaned up;
      // but payload itself is expired, so even if nonce is removed, it still fails on exp check
      const result = validator.validate(payload);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Payload expired');
      }
    });
  });
});

// ── PermissionCardBuilder ───────────────────────────────────────────────────

describe('PermissionCardBuilder', () => {
  let validator: PermissionPayloadValidatorImpl;
  let builder: PermissionCardBuilderImpl;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    validator = new PermissionPayloadValidatorImpl();
    builder = new PermissionCardBuilderImpl(validator);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseParams = {
    toolName: 'Bash',
    toolCallId: 'tc-1',
    sessionId: 'sess-1',
    requestId: 'req-1',
  };

  // ── Card structure ──────────────────────────────────────────────────────

  describe('card structure', () => {
    it('has correct header', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'claude',
      });

      expect(card.header).toBeDefined();
      expect(card.header!.title).toBe('Permission Request: Bash');
      expect(card.header!.status).toBe('waiting');
    });

    it('includes description when provided', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'claude',
        description: 'This tool wants to run `rm -rf /`',
      });

      expect(card.sections[0]).toEqual({
        type: 'markdown',
        content: 'This tool wants to run `rm -rf /`',
      });
    });

    it('includes tool/agent fields section', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'gemini',
      });

      const fieldsSection = card.sections.find((s) => s.type === 'fields');
      expect(fieldsSection).toBeDefined();
      if (fieldsSection && fieldsSection.type === 'fields') {
        expect(fieldsSection.fields).toEqual([
          { label: 'Tool', value: 'Bash', short: true },
          { label: 'Agent', value: 'gemini', short: true },
        ]);
      }
    });
  });

  // ── Claude buttons ──────────────────────────────────────────────────────

  describe('Claude buttons', () => {
    it('builds 4 buttons for mutable tools', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'claude',
        isMutable: true,
      });

      expect(card.actions).toHaveLength(4);
      const labels = card.actions!.map((a) => a.label);
      expect(labels).toEqual([
        'Yes',
        'Yes, allow all edits',
        'Yes, for this tool',
        'No, tell Claude',
      ]);
    });

    it('builds 3 buttons for non-mutable tools (no "allow all edits")', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'claude',
        isMutable: false,
      });

      expect(card.actions).toHaveLength(3);
      const labels = card.actions!.map((a) => a.label);
      expect(labels).toEqual([
        'Yes',
        'Yes, for this tool',
        'No, tell Claude',
      ]);
    });

    it('defaults isMutable to false', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'claude',
      });

      expect(card.actions).toHaveLength(3);
    });

    it('"Yes" button has approve action', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'claude',
        isMutable: true,
      });

      const yesButton = card.actions![0]!;
      const payload: PermissionActionPayload = JSON.parse(yesButton.value);
      expect(payload.action).toBe('approve');
      expect(payload.scope).toBeUndefined();
    });

    it('"Yes, allow all edits" button has all_edits scope', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'claude',
        isMutable: true,
      });

      const allEditsButton = card.actions![1]!;
      const payload: PermissionActionPayload = JSON.parse(allEditsButton.value);
      expect(payload.action).toBe('approve_scoped');
      expect(payload.scope).toEqual({ type: 'all_edits' });
    });

    it('"Yes, for this tool" button has this_tool scope', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'claude',
        isMutable: true,
      });

      const thisToolButton = card.actions![2]!;
      const payload: PermissionActionPayload = JSON.parse(thisToolButton.value);
      expect(payload.action).toBe('approve_scoped');
      expect(payload.scope).toEqual({ type: 'this_tool', toolIdentifier: 'Bash' });
    });

    it('"No, tell Claude" button has deny action', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'claude',
        isMutable: true,
      });

      const denyButton = card.actions![3]!;
      const payload: PermissionActionPayload = JSON.parse(denyButton.value);
      expect(payload.action).toBe('deny');
    });
  });

  // ── Codex buttons ───────────────────────────────────────────────────────

  describe('Codex buttons', () => {
    it('builds 3 buttons', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'codex',
      });

      expect(card.actions).toHaveLength(3);
      const labels = card.actions!.map((a) => a.label);
      expect(labels).toEqual([
        'Yes',
        "Yes, don't ask for session",
        'Stop and explain',
      ]);
    });

    it('"Yes" button has approve action', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'codex',
      });

      const payload: PermissionActionPayload = JSON.parse(card.actions![0]!.value);
      expect(payload.action).toBe('approve');
      expect(payload.agentType).toBe('codex');
    });

    it('"Yes, don\'t ask for session" has session scope', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'codex',
      });

      const payload: PermissionActionPayload = JSON.parse(card.actions![1]!.value);
      expect(payload.action).toBe('approve_scoped');
      expect(payload.scope).toEqual({ type: 'session' });
    });

    it('"Stop and explain" button has abort action', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'codex',
      });

      const payload: PermissionActionPayload = JSON.parse(card.actions![2]!.value);
      expect(payload.action).toBe('abort');
    });
  });

  // ── Gemini buttons ──────────────────────────────────────────────────────

  describe('Gemini buttons', () => {
    it('builds 2 buttons', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'gemini',
      });

      expect(card.actions).toHaveLength(2);
      const labels = card.actions!.map((a) => a.label);
      expect(labels).toEqual(['Approve', 'Deny']);
    });

    it('"Approve" button has approve action', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'gemini',
      });

      const payload: PermissionActionPayload = JSON.parse(card.actions![0]!.value);
      expect(payload.action).toBe('approve');
      expect(payload.agentType).toBe('gemini');
    });

    it('"Deny" button has deny action', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'gemini',
      });

      const payload: PermissionActionPayload = JSON.parse(card.actions![1]!.value);
      expect(payload.action).toBe('deny');
    });
  });

  // ── Payload integrity ─────────────────────────────────────────────────

  describe('payload integrity', () => {
    it('all button values are valid JSON-serialized PermissionActionPayloads', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'claude',
        isMutable: true,
      });

      for (const action of card.actions!) {
        const parsed = JSON.parse(action.value);
        const result = PermissionActionPayloadSchema.safeParse(parsed);
        expect(result.success).toBe(true);
      }
    });

    it('all button payloads have correct session/request/tool metadata', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'claude',
        isMutable: true,
      });

      for (const action of card.actions!) {
        const payload: PermissionActionPayload = JSON.parse(action.value);
        expect(payload.sessionId).toBe('sess-1');
        expect(payload.requestId).toBe('req-1');
        expect(payload.toolName).toBe('Bash');
        expect(payload.toolCallId).toBe('tc-1');
        expect(payload.agentType).toBe('claude');
        expect(payload.v).toBe(1);
      }
    });

    it('each button has a unique nonce', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'claude',
        isMutable: true,
      });

      const nonces = card.actions!.map((a) => {
        const payload: PermissionActionPayload = JSON.parse(a.value);
        return payload.nonce;
      });
      const unique = new Set(nonces);
      expect(unique.size).toBe(nonces.length);
    });

    it('button payloads pass validator.validate()', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'claude',
        isMutable: true,
      });

      // Each should validate successfully (unique nonces)
      for (const action of card.actions!) {
        const payload = JSON.parse(action.value);
        const result = validator.validate(payload);
        expect(result.ok).toBe(true);
      }
    });

    it('button payloads fail replay on second validation', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'claude',
      });

      const firstPayload = JSON.parse(card.actions![0]!.value);

      // First validation succeeds
      expect(validator.validate(firstPayload).ok).toBe(true);

      // Replay fails
      expect(validator.validate(firstPayload).ok).toBe(false);
    });
  });

  // ── Button styles ─────────────────────────────────────────────────────

  describe('button styles', () => {
    it('Claude: Yes is primary, deny is danger', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'claude',
        isMutable: true,
      });

      expect(card.actions![0]!.style).toBe('primary');  // Yes
      expect(card.actions![1]!.style).toBe('primary');  // Yes, allow all edits
      expect(card.actions![2]!.style).toBe('default');  // Yes, for this tool
      expect(card.actions![3]!.style).toBe('danger');   // No, tell Claude
    });

    it('Codex: Yes is primary, stop is danger', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'codex',
      });

      expect(card.actions![0]!.style).toBe('primary');  // Yes
      expect(card.actions![1]!.style).toBe('default');  // Yes, don't ask
      expect(card.actions![2]!.style).toBe('danger');   // Stop and explain
    });

    it('Gemini: Approve is primary, Deny is danger', () => {
      const card = builder.buildPermissionCard({
        ...baseParams,
        agentType: 'gemini',
      });

      expect(card.actions![0]!.style).toBe('primary');  // Approve
      expect(card.actions![1]!.style).toBe('danger');   // Deny
    });
  });
});
