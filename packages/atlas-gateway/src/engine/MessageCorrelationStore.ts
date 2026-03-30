import { randomUUID } from 'node:crypto';
import type { CardState } from './CardStateStore.js';
import type { CardStateStoreImpl } from './CardStateStore.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CorrelationEntry {
  cardId: string;
  messageId: string | null;
  chatId: string;
  sessionId: string;
  toolCallId?: string;
  permissionRequestId?: string;
  createdAt: number;
  status: 'active' | 'completed' | 'expired';
}

/**
 * Minimal payload type for resolveCardAction.
 * Task 6 will create the full Zod-validated version.
 */
export interface PermissionActionPayload {
  v: 1;
  nonce: string;
  iat: number;
  exp: number;
  action: 'approve' | 'approve_scoped' | 'deny' | 'abort';
  sessionId: string;
  requestId: string;
  toolName: string;
  toolCallId: string;
  agentType: 'claude' | 'codex' | 'gemini';
  scope?: { type: string; [key: string]: unknown };
}

export interface SerializedCorrelationStore {
  entries: CorrelationEntry[];
}

export interface MessageCorrelationStore {
  create(entry: Omit<CorrelationEntry, 'createdAt' | 'status'>): string;
  getByCardId(cardId: string): CorrelationEntry | undefined;
  getByMessageId(messageId: string): CorrelationEntry | undefined;
  getByToolCallId(sessionId: string, toolCallId: string): CorrelationEntry | undefined;
  getByPermissionId(sessionId: string, requestId: string): CorrelationEntry | undefined;
  resolveCardAction(messageId: string, payload: PermissionActionPayload): {
    card: CardState; entry: CorrelationEntry;
  } | null;
  setMessageId(cardId: string, messageId: string): void;
  complete(cardId: string): void;
  expire(olderThanMs: number): number;
  snapshot(): SerializedCorrelationStore;
  restore(data: SerializedCorrelationStore): void;
}

// ── Implementation ─────────────────────────────────────────────────────────

/**
 * Builds a composite key for tool-call lookups: `${sessionId}:${toolCallId}`.
 */
function toolCallKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

/**
 * Builds a composite key for permission-request lookups: `${sessionId}:${requestId}`.
 */
function permissionKey(sessionId: string, requestId: string): string {
  return `${sessionId}:${requestId}`;
}

export class MessageCorrelationStoreImpl implements MessageCorrelationStore {
  /** Primary storage: cardId -> CorrelationEntry */
  private entries = new Map<string, CorrelationEntry>();

  /** Secondary index: messageId -> cardId */
  private messageIdIndex = new Map<string, string>();

  /** Secondary index: composite toolCallKey -> cardId */
  private toolCallIndex = new Map<string, string>();

  /** Secondary index: composite permissionKey -> cardId */
  private permissionIndex = new Map<string, string>();

  private cardStore: CardStateStoreImpl;

  constructor(cardStore: CardStateStoreImpl) {
    this.cardStore = cardStore;
  }

  create(entry: Omit<CorrelationEntry, 'createdAt' | 'status'>): string {
    const cardId = entry.cardId || randomUUID();
    const full: CorrelationEntry = {
      ...entry,
      cardId,
      createdAt: Date.now(),
      status: 'active',
    };

    this.entries.set(cardId, full);

    // Build secondary indexes
    if (full.messageId) {
      this.messageIdIndex.set(full.messageId, cardId);
    }
    if (full.toolCallId) {
      this.toolCallIndex.set(toolCallKey(full.sessionId, full.toolCallId), cardId);
    }
    if (full.permissionRequestId) {
      this.permissionIndex.set(permissionKey(full.sessionId, full.permissionRequestId), cardId);
    }

    return cardId;
  }

  getByCardId(cardId: string): CorrelationEntry | undefined {
    return this.entries.get(cardId);
  }

  getByMessageId(messageId: string): CorrelationEntry | undefined {
    const cardId = this.messageIdIndex.get(messageId);
    return cardId ? this.entries.get(cardId) : undefined;
  }

  getByToolCallId(sessionId: string, toolCallId: string): CorrelationEntry | undefined {
    const cardId = this.toolCallIndex.get(toolCallKey(sessionId, toolCallId));
    return cardId ? this.entries.get(cardId) : undefined;
  }

  getByPermissionId(sessionId: string, requestId: string): CorrelationEntry | undefined {
    const cardId = this.permissionIndex.get(permissionKey(sessionId, requestId));
    return cardId ? this.entries.get(cardId) : undefined;
  }

  resolveCardAction(
    messageId: string,
    _payload: PermissionActionPayload,
  ): { card: CardState; entry: CorrelationEntry } | null {
    const entry = this.getByMessageId(messageId);
    if (!entry) return null;
    if (entry.status !== 'active') return null;

    const card = this.cardStore.get(entry.cardId);
    if (!card) return null;

    return { card, entry };
  }

  setMessageId(cardId: string, messageId: string): void {
    const entry = this.entries.get(cardId);
    if (!entry) return;

    // Remove old messageId from index if one existed
    if (entry.messageId) {
      this.messageIdIndex.delete(entry.messageId);
    }

    entry.messageId = messageId;
    this.messageIdIndex.set(messageId, cardId);
  }

  complete(cardId: string): void {
    const entry = this.entries.get(cardId);
    if (!entry) return;
    entry.status = 'completed';
    // Indexes are not removed on completion so that lookups
    // still resolve (they just get a completed entry).
  }

  expire(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    let count = 0;

    for (const entry of this.entries.values()) {
      if (entry.status === 'active' && entry.createdAt < cutoff) {
        entry.status = 'expired';
        this.removeIndexes(entry);
        count++;
      }
    }

    return count;
  }

  snapshot(): SerializedCorrelationStore {
    return {
      entries: Array.from(this.entries.values()).map((e) => ({ ...e })),
    };
  }

  restore(data: SerializedCorrelationStore): void {
    this.entries.clear();
    this.messageIdIndex.clear();
    this.toolCallIndex.clear();
    this.permissionIndex.clear();

    for (const entry of data.entries) {
      this.entries.set(entry.cardId, { ...entry });

      // Rebuild secondary indexes (only for non-expired entries
      // since expire() cleans indexes)
      if (entry.status !== 'expired') {
        if (entry.messageId) {
          this.messageIdIndex.set(entry.messageId, entry.cardId);
        }
        if (entry.toolCallId) {
          this.toolCallIndex.set(toolCallKey(entry.sessionId, entry.toolCallId), entry.cardId);
        }
        if (entry.permissionRequestId) {
          this.permissionIndex.set(permissionKey(entry.sessionId, entry.permissionRequestId), entry.cardId);
        }
      }
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private removeIndexes(entry: CorrelationEntry): void {
    if (entry.messageId) {
      this.messageIdIndex.delete(entry.messageId);
    }
    if (entry.toolCallId) {
      this.toolCallIndex.delete(toolCallKey(entry.sessionId, entry.toolCallId));
    }
    if (entry.permissionRequestId) {
      this.permissionIndex.delete(permissionKey(entry.sessionId, entry.permissionRequestId));
    }
  }
}
