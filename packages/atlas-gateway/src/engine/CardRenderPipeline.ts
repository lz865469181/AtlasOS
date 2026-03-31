import type { CardModel } from '../cards/CardModel.js';
import type { SenderFactory } from '../channel/ChannelSender.js';
import type { CardStateStoreImpl, CardState } from './CardStateStore.js';
import type { MessageCorrelationStore } from './MessageCorrelationStore.js';

// ── Interfaces ─────────────────────────────────────────────────────────────

export interface CardRenderer {
  render(
    card: CardModel,
    context: { status: string; type: string },
  ): CardModel;
}

// ── Internal types ─────────────────────────────────────────────────────────

interface QueueEntry {
  cardId: string;
  version: number;
  state: CardState;
}

interface CardQueue {
  /** Items waiting to be sent (excluding the one currently in-flight). */
  pending: QueueEntry[];
  /** Whether a send is currently in-flight for this card. */
  inflight: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_QUEUE_DEPTH = 5;

// ── Implementation ─────────────────────────────────────────────────────────

export class CardRenderPipeline {
  private readonly store: CardStateStoreImpl;
  private readonly renderer: CardRenderer;
  private readonly senderFactory: SenderFactory;
  private readonly correlationStore: MessageCorrelationStore;

  /** Per-card serial send queues. */
  private queues = new Map<string, CardQueue>();

  /** Unsubscribe handle returned by store.onChange. */
  private unsubscribe: (() => void) | null = null;

  /** Whether dispose() has been called. */
  private disposed = false;

  constructor(
    store: CardStateStoreImpl,
    renderer: CardRenderer,
    senderFactory: SenderFactory,
    correlationStore: MessageCorrelationStore,
  ) {
    this.store = store;
    this.renderer = renderer;
    this.senderFactory = senderFactory;
    this.correlationStore = correlationStore;

    this.unsubscribe = this.store.onChange(
      (cardId: string, state: CardState) => {
        this.enqueue(cardId, state);
      },
    );
  }

  // ── Public API ───────────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.queues.clear();
  }

  // ── Queue management ─────────────────────────────────────────────────────

  private getOrCreateQueue(cardId: string): CardQueue {
    let queue = this.queues.get(cardId);
    if (!queue) {
      queue = { pending: [], inflight: false };
      this.queues.set(cardId, queue);
    }
    return queue;
  }

  private enqueue(cardId: string, state: CardState): void {
    if (this.disposed) return;

    const queue = this.getOrCreateQueue(cardId);
    const entry: QueueEntry = {
      cardId,
      version: state.version,
      state,
    };

    queue.pending.push(entry);

    // Enforce max queue depth: drop oldest entries (keep newest).
    while (queue.pending.length > MAX_QUEUE_DEPTH) {
      queue.pending.shift();
    }

    // If nothing is in-flight, start processing immediately.
    if (!queue.inflight) {
      void this.processNext(cardId);
    }
  }

  private async processNext(cardId: string): Promise<void> {
    if (this.disposed) return;

    const queue = this.queues.get(cardId);
    if (!queue || queue.pending.length === 0) {
      if (queue) {
        queue.inflight = false;
      }
      return;
    }

    queue.inflight = true;
    const entry = queue.pending.shift()!;

    // Stale version check: if the store already has a newer version,
    // skip this entry and move on to the next one.
    const currentState = this.store.get(cardId);
    if (currentState && currentState.version > entry.version) {
      void this.processNext(cardId);
      return;
    }

    try {
      await this.send(entry);
    } catch (err) {
      // Log but don't crash. The pipeline is resilient to send failures.
      console.error(
        `[CardRenderPipeline] send failed for card=${cardId} version=${entry.version}:`,
        err,
      );
    }

    // Process next queued item (if any).
    void this.processNext(cardId);
  }

  // ── Send logic ───────────────────────────────────────────────────────────

  private async send(entry: QueueEntry): Promise<void> {
    const { cardId, state } = entry;
    const sender = this.senderFactory(state.chatId);

    const rendered = this.renderer.render(state.content, {
      status: state.status,
      type: state.type,
    });

    // Re-read messageId from the store (it may have been set by a prior send).
    const latestState = this.store.get(cardId);
    const messageId = latestState?.messageId ?? state.messageId;

    if (messageId) {
      // Card already has a message — update (PATCH).
      await sender.updateCard(messageId, rendered);
    } else {
      // Card is new — send and record the messageId.
      const newMessageId = await sender.sendCard(rendered);
      this.correlationStore.setMessageId(cardId, newMessageId);
      this.store.setMessageId(cardId, newMessageId);
    }
  }
}
