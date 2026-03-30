import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import type { CardModel, CardAction } from '../cards/CardModel.js';

// ── Zod Schemas ─────────────────────────────────────────────────────────────

export const PermissionActionSchema = z.enum(['approve', 'approve_scoped', 'deny', 'abort']);

export const PermissionScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('this_tool'), toolIdentifier: z.string() }),
  z.object({ type: z.literal('all_edits') }),
  z.object({ type: z.literal('session'), toolIdentifier: z.string().optional() }),
  z.object({ type: z.literal('command'), command: z.string() }),
]);

export const PermissionActionPayloadSchema = z.object({
  v: z.literal(1),
  nonce: z.string().uuid(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
  action: PermissionActionSchema,
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  toolName: z.string().min(1),
  toolCallId: z.string().min(1),
  agentType: z.enum(['claude', 'codex', 'gemini']),
  scope: PermissionScopeSchema.optional(),
});

// ── TypeScript types (inferred from Zod) ────────────────────────────────────

export type PermissionAction = z.infer<typeof PermissionActionSchema>;
export type PermissionScope = z.infer<typeof PermissionScopeSchema>;
export type PermissionActionPayload = z.infer<typeof PermissionActionPayloadSchema>;

// ── Payload Validator ───────────────────────────────────────────────────────

/** Default TTL for payloads: 5 minutes. */
const DEFAULT_TTL_MS = 300_000;

/** Nonces are kept for 10 minutes before cleanup evicts them. */
const NONCE_RETENTION_MS = 600_000;

export interface PermissionPayloadValidator {
  validate(payload: unknown): { ok: true; data: PermissionActionPayload } | { ok: false; error: string };
  createPayload(params: {
    action: PermissionAction;
    sessionId: string;
    requestId: string;
    toolName: string;
    toolCallId: string;
    agentType: 'claude' | 'codex' | 'gemini';
    scope?: PermissionScope;
    ttlMs?: number;
  }): PermissionActionPayload;
  cleanup(): number;
}

interface NonceEntry {
  expiresAt: number;
}

export class PermissionPayloadValidatorImpl implements PermissionPayloadValidator {
  /** Map of nonce -> expiry timestamp (used for replay detection). */
  private usedNonces = new Map<string, NonceEntry>();

  validate(payload: unknown): { ok: true; data: PermissionActionPayload } | { ok: false; error: string } {
    // 1. Structural validation via Zod
    const parsed = PermissionActionPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, error: `Schema validation failed: ${parsed.error.issues.map((i) => i.message).join('; ')}` };
    }

    const data = parsed.data;

    // 2. Version check (belt-and-suspenders; Zod literal already enforces this)
    if (data.v !== 1) {
      return { ok: false, error: `Unsupported payload version: ${data.v}` };
    }

    // 3. Expiry check
    if (Date.now() > data.exp) {
      return { ok: false, error: 'Payload expired' };
    }

    // 4. Nonce replay check
    if (this.usedNonces.has(data.nonce)) {
      return { ok: false, error: 'Nonce already used (replay detected)' };
    }

    // Mark nonce as used — retain for NONCE_RETENTION_MS from now
    this.usedNonces.set(data.nonce, { expiresAt: Date.now() + NONCE_RETENTION_MS });

    return { ok: true, data };
  }

  createPayload(params: {
    action: PermissionAction;
    sessionId: string;
    requestId: string;
    toolName: string;
    toolCallId: string;
    agentType: 'claude' | 'codex' | 'gemini';
    scope?: PermissionScope;
    ttlMs?: number;
  }): PermissionActionPayload {
    const now = Date.now();
    const ttl = params.ttlMs ?? DEFAULT_TTL_MS;

    return {
      v: 1,
      nonce: randomUUID(),
      iat: now,
      exp: now + ttl,
      action: params.action,
      sessionId: params.sessionId,
      requestId: params.requestId,
      toolName: params.toolName,
      toolCallId: params.toolCallId,
      agentType: params.agentType,
      scope: params.scope,
    };
  }

  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [nonce, entry] of this.usedNonces) {
      if (entry.expiresAt <= now) {
        this.usedNonces.delete(nonce);
        removed++;
      }
    }

    return removed;
  }
}

// ── Permission Card Builder ─────────────────────────────────────────────────

export interface PermissionCardBuilder {
  buildPermissionCard(params: {
    toolName: string;
    toolCallId: string;
    sessionId: string;
    requestId: string;
    agentType: 'claude' | 'codex' | 'gemini';
    description?: string;
    isMutable?: boolean;
  }): CardModel;
}

interface ButtonDef {
  label: string;
  action: PermissionAction;
  scope?: PermissionScope;
  style?: 'primary' | 'danger' | 'default';
}

/**
 * Shared params passed to every payload created for a card's buttons.
 */
interface CardPayloadParams {
  sessionId: string;
  requestId: string;
  toolName: string;
  toolCallId: string;
  agentType: 'claude' | 'codex' | 'gemini';
}

function buildClaudeButtons(toolName: string, isMutable: boolean): ButtonDef[] {
  const buttons: ButtonDef[] = [
    { label: 'Yes', action: 'approve', style: 'primary' },
  ];

  if (isMutable) {
    buttons.push({
      label: 'Yes, allow all edits',
      action: 'approve_scoped',
      scope: { type: 'all_edits' },
      style: 'primary',
    });
  }

  buttons.push({
    label: 'Yes, for this tool',
    action: 'approve_scoped',
    scope: { type: 'this_tool', toolIdentifier: toolName },
    style: 'default',
  });

  buttons.push({
    label: 'No, tell Claude',
    action: 'deny',
    style: 'danger',
  });

  return buttons;
}

function buildCodexButtons(_toolName: string): ButtonDef[] {
  return [
    { label: 'Yes', action: 'approve', style: 'primary' },
    {
      label: "Yes, don't ask for session",
      action: 'approve_scoped',
      scope: { type: 'session' },
      style: 'default',
    },
    { label: 'Stop and explain', action: 'abort', style: 'danger' },
  ];
}

function buildGeminiButtons(_toolName: string): ButtonDef[] {
  return [
    { label: 'Approve', action: 'approve', style: 'primary' },
    { label: 'Deny', action: 'deny', style: 'danger' },
  ];
}

export class PermissionCardBuilderImpl implements PermissionCardBuilder {
  private validator: PermissionPayloadValidator;

  constructor(validator?: PermissionPayloadValidator) {
    this.validator = validator ?? new PermissionPayloadValidatorImpl();
  }

  buildPermissionCard(params: {
    toolName: string;
    toolCallId: string;
    sessionId: string;
    requestId: string;
    agentType: 'claude' | 'codex' | 'gemini';
    description?: string;
    isMutable?: boolean;
  }): CardModel {
    const { toolName, toolCallId, sessionId, requestId, agentType, description, isMutable } = params;

    const payloadParams: CardPayloadParams = {
      sessionId,
      requestId,
      toolName,
      toolCallId,
      agentType,
    };

    // Select button definitions per agent type
    let buttonDefs: ButtonDef[];
    switch (agentType) {
      case 'claude':
        buttonDefs = buildClaudeButtons(toolName, isMutable ?? false);
        break;
      case 'codex':
        buttonDefs = buildCodexButtons(toolName);
        break;
      case 'gemini':
      default:
        buttonDefs = buildGeminiButtons(toolName);
        break;
    }

    // Build card actions: each button's value is a JSON-serialized PermissionActionPayload
    const actions: CardAction[] = buttonDefs.map((def) => {
      const payload = this.validator.createPayload({
        ...payloadParams,
        action: def.action,
        scope: def.scope,
      });

      return {
        type: 'button' as const,
        label: def.label,
        value: JSON.stringify(payload),
        style: def.style,
      };
    });

    // Build card sections
    const sections: CardModel['sections'] = [];

    if (description) {
      sections.push({ type: 'markdown', content: description });
    }

    sections.push({
      type: 'fields',
      fields: [
        { label: 'Tool', value: toolName, short: true },
        { label: 'Agent', value: agentType, short: true },
      ],
    });

    return {
      header: {
        title: `Permission Request: ${toolName}`,
        icon: '\u{1F512}', // lock
        status: 'waiting',
      },
      sections,
      actions,
    };
  }
}
