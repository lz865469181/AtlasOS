import { randomUUID } from 'node:crypto';
import type { CardModel } from '../cards/CardModel.js';

export interface CardState {
  cardId: string;
  messageId: string | null;
  chatId: string;
  /** When set, the first send of this card will reply to this message, creating a Feishu thread. */
  replyToMessageId?: string;
  type: 'streaming' | 'tool' | 'permission' | 'status';
  status: 'active' | 'frozen' | 'completed' | 'error' | 'expired';
  content: CardModel;
  version: number;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

export interface CardStateStoreConfig {
  maxRenderRateMs: number;
  coalesceWindowMs: number;
  maxPendingUpdates: number;
}

export type CardChangeHandler = (cardId: string, state: CardState) => void;

export interface SerializedCardStore {
  cards: Array<CardState & { messageId: string | null }>;
}

const DEFAULT_CONFIG: CardStateStoreConfig = {
  maxRenderRateMs: 500,
  coalesceWindowMs: 100,
  maxPendingUpdates: 50,
};

export class CardStateStoreImpl {
  private states = new Map<string, CardState>();
  private messageIdIndex = new Map<string, string>(); // messageId -> cardId
  private handlers = new Set<CardChangeHandler>();
  private pendingRenders = new Map<string, ReturnType<typeof setTimeout>>();
  private nextAllowedRender = new Map<string, number>();
  private config: CardStateStoreConfig;

  constructor(config?: Partial<CardStateStoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  create(chatId: string, type: CardState['type'], initial: CardModel, replyToMessageId?: string): CardState {
    const state: CardState = {
      cardId: randomUUID(),
      messageId: null,
      chatId,
      replyToMessageId,
      type,
      status: 'active',
      content: initial,
      version: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {},
    };
    this.states.set(state.cardId, state);
    // Immediately notify listeners so the card is sent right away
    this.scheduleRender(state.cardId);
    return state;
  }

  get(cardId: string): CardState | undefined {
    return this.states.get(cardId);
  }

  getByMessageId(messageId: string): CardState | undefined {
    const cardId = this.messageIdIndex.get(messageId);
    return cardId ? this.states.get(cardId) : undefined;
  }

  getActiveByChatId(chatId: string): CardState[] {
    const result: CardState[] = [];
    for (const state of this.states.values()) {
      if (state.chatId === chatId && (state.status === 'active' || state.status === 'frozen')) {
        result.push(state);
      }
    }
    return result;
  }

  update(cardId: string, mutator: (state: CardState) => void): CardState {
    const state = this.states.get(cardId);
    if (!state) throw new Error(`Card not found: ${cardId}`);

    mutator(state);
    state.version++;
    state.updatedAt = Date.now();

    this.scheduleRender(cardId);
    return state;
  }

  transition(cardId: string, to: CardState['status']): CardState {
    return this.update(cardId, (state) => {
      state.status = to;
    });
  }

  setMessageId(cardId: string, messageId: string): void {
    const state = this.states.get(cardId);
    if (!state) return;
    state.messageId = messageId;
    this.messageIdIndex.set(messageId, cardId);
  }

  dispose(cardId: string): void {
    const state = this.states.get(cardId);
    if (state?.messageId) {
      this.messageIdIndex.delete(state.messageId);
    }
    this.states.delete(cardId);
    const timer = this.pendingRenders.get(cardId);
    if (timer) {
      clearTimeout(timer);
      this.pendingRenders.delete(cardId);
    }
  }

  onChange(handler: CardChangeHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  snapshot(): SerializedCardStore {
    return {
      cards: Array.from(this.states.values()).map((s) => ({ ...s })),
    };
  }

  restore(data: SerializedCardStore): void {
    this.states.clear();
    this.messageIdIndex.clear();
    for (const card of data.cards) {
      this.states.set(card.cardId, card);
      if (card.messageId) {
        this.messageIdIndex.set(card.messageId, card.cardId);
      }
    }
  }

  private scheduleRender(cardId: string): void {
    // If already pending, skip (latest state wins when timer fires)
    if (this.pendingRenders.has(cardId)) return;

    const now = Date.now();
    const nextAllowed = this.nextAllowedRender.get(cardId);
    const delay = nextAllowed === undefined
      ? this.config.maxRenderRateMs
      : Math.max(this.config.coalesceWindowMs, nextAllowed - now);

    const timer = setTimeout(() => {
      this.pendingRenders.delete(cardId);
      this.nextAllowedRender.set(cardId, Date.now() + this.config.maxRenderRateMs);
      const current = this.states.get(cardId);
      if (current) {
        for (const handler of this.handlers) {
          handler(cardId, current);
        }
      }
    }, delay);

    this.pendingRenders.set(cardId, timer);
  }
}
