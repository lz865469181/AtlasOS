import { Buffer } from 'node:buffer';

// ── Types ──────────────────────────────────────────────────────────────────

export type StreamingState =
  | 'idle'
  | 'buffering'
  | 'sending'
  | 'paused'
  | 'draining'
  | 'completed'
  | 'cancelled'
  | 'error';

export type BufferPressure = 'normal' | 'high' | 'truncated';

export interface StreamBufferConfig {
  maxBufferBytes: number;
  highWaterMark: number;
  lowWaterMark: number;
  truncationStrategy: 'tail';
}

export interface StreamingStateMachineConfig {
  throttleMs: number;
  buffer?: Partial<StreamBufferConfig>;
}

export type FlushHandler = (content: string, cardId: string) => Promise<void>;
export type StateChangeHandler = (from: StreamingState, to: StreamingState) => void;

export interface StreamingStateMachine {
  readonly state: StreamingState;
  readonly buffer: StreamBuffer;
  readonly cardId: string;
  readonly pauseReason: 'permission' | 'rate-limit' | null;

  start(cardId: string): void;
  append(text: string): void;
  pause(reason: 'permission' | 'rate-limit'): void;
  resume(): void;
  finish(): Promise<string>;
  cancel(): void;
  error(err: Error): void;

  onSendComplete(): void;
  onSendError(err: Error): void;
  onFlush(handler: FlushHandler): void;
  onStateChange(handler: StateChangeHandler): void;
}

// ── StreamBuffer ───────────────────────────────────────────────────────────

const TRUNCATION_PREFIX = '... (truncated)\n';

const DEFAULT_BUFFER_CONFIG: StreamBufferConfig = {
  maxBufferBytes: 65536,       // 64KB
  highWaterMark: 49152,        // 75%
  lowWaterMark: 16384,         // 25%
  truncationStrategy: 'tail',
};

export class StreamBuffer {
  private chunks: string[] = [];
  private byteSize = 0;
  private config: StreamBufferConfig;
  private wasTruncated = false;
  /** Tracks all content ever appended (for finish() to return full history). */
  private allContent: string[] = [];

  constructor(config?: Partial<StreamBufferConfig>) {
    this.config = { ...DEFAULT_BUFFER_CONFIG, ...config };

    if (this.config.highWaterMark >= this.config.maxBufferBytes) {
      throw new Error('highWaterMark must be less than maxBufferBytes');
    }
    if (this.config.lowWaterMark >= this.config.highWaterMark) {
      throw new Error('lowWaterMark must be less than highWaterMark');
    }
  }

  /**
   * Append text to the buffer.
   * Returns the current pressure level after appending.
   */
  append(text: string): BufferPressure {
    if (text.length === 0) return this.pressure;

    this.chunks.push(text);
    this.byteSize += Buffer.byteLength(text, 'utf8');
    this.allContent.push(text);

    // Truncate if over max
    if (this.byteSize > this.config.maxBufferBytes) {
      this.truncate();
    }

    return this.pressure;
  }

  /**
   * Flush the buffer and return accumulated content.
   * Resets the buffer (but not allContent history).
   */
  flush(): string {
    const content = this.chunks.join('');
    this.chunks = [];
    this.byteSize = 0;
    this.wasTruncated = false;
    return content;
  }

  /** Current buffer byte size. */
  get size(): number {
    return this.byteSize;
  }

  /** Whether the buffer has any content. */
  get hasContent(): boolean {
    return this.byteSize > 0;
  }

  /** Current pressure level. */
  get pressure(): BufferPressure {
    if (this.wasTruncated) return 'truncated';
    if (this.byteSize >= this.config.highWaterMark) return 'high';
    return 'normal';
  }

  /** Return the full accumulated content from all appends since creation/reset. */
  get fullContent(): string {
    return this.allContent.join('');
  }

  /** Clear buffer and all history. */
  clear(): void {
    this.chunks = [];
    this.byteSize = 0;
    this.wasTruncated = false;
    this.allContent = [];
  }

  /**
   * Tail-truncation: keep the most recent content that fits within
   * maxBufferBytes, prepending the truncation prefix.
   */
  private truncate(): void {
    const joined = this.chunks.join('');
    const prefixBytes = Buffer.byteLength(TRUNCATION_PREFIX, 'utf8');
    const targetBytes = this.config.maxBufferBytes - prefixBytes;

    // Walk backwards through the string to find the cut point that keeps
    // at most targetBytes of the tail.
    const fullBuf = Buffer.from(joined, 'utf8');
    const keep = fullBuf.subarray(fullBuf.length - targetBytes);
    const tail = keep.toString('utf8');

    this.chunks = [TRUNCATION_PREFIX + tail];
    this.byteSize = Buffer.byteLength(this.chunks[0], 'utf8');
    this.wasTruncated = true;
  }
}

// ── StreamingStateMachineImpl ──────────────────────────────────────────────

const TERMINAL_STATES: ReadonlySet<StreamingState> = new Set<StreamingState>([
  'completed',
  'cancelled',
  'error',
]);

const DEFAULT_SM_CONFIG: StreamingStateMachineConfig = {
  throttleMs: 300,
};

export class StreamingStateMachineImpl implements StreamingStateMachine {
  private _state: StreamingState = 'idle';
  private _cardId = '';
  private _pauseReason: 'permission' | 'rate-limit' | null = null;
  private _buffer: StreamBuffer;
  private _config: StreamingStateMachineConfig;

  private flushHandlers: FlushHandler[] = [];
  private stateChangeHandlers: StateChangeHandler[] = [];

  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private highPressurePending = false;

  /** Promise + resolver for the finish() call. */
  private drainResolve: ((content: string) => void) | null = null;
  private drainPromise: Promise<string> | null = null;

  constructor(config?: Partial<StreamingStateMachineConfig>) {
    this._config = { ...DEFAULT_SM_CONFIG, ...config };
    this._buffer = new StreamBuffer(this._config.buffer);
  }

  // ── Readonly accessors ──

  get state(): StreamingState {
    return this._state;
  }

  get buffer(): StreamBuffer {
    return this._buffer;
  }

  get cardId(): string {
    return this._cardId;
  }

  get pauseReason(): 'permission' | 'rate-limit' | null {
    return this._pauseReason;
  }

  // ── Lifecycle methods ──

  start(cardId: string): void {
    this.assertState('start', 'idle');
    this._cardId = cardId;
    this.transition('buffering');
    this.startThrottleTimer();
  }

  append(text: string): void {
    this.assertNonTerminal('append');
    if (this._state === 'idle') {
      throw new Error('Cannot append in idle state; call start() first');
    }

    const pressure = this._buffer.append(text);

    if (pressure === 'high' || pressure === 'truncated') {
      this.highPressurePending = true;

      // If we are in BUFFERING and have high pressure, flush immediately
      if (this._state === 'buffering') {
        this.clearThrottleTimer();
        this.doFlush();
      }
      // If SENDING, the flag will trigger immediate re-flush on send complete
    }
  }

  pause(reason: 'permission' | 'rate-limit'): void {
    this.assertNonTerminal('pause');
    if (this._state === 'idle') {
      throw new Error('Cannot pause in idle state');
    }
    this.clearThrottleTimer();
    this._pauseReason = reason;
    this.transition('paused');
  }

  resume(): void {
    this.assertState('resume', 'paused');
    this._pauseReason = null;
    this.transition('buffering');

    if (this._buffer.hasContent) {
      // Flush immediately on resume if there is buffered content
      this.doFlush();
    } else {
      this.startThrottleTimer();
    }
  }

  finish(): Promise<string> {
    this.assertNonTerminal('finish');
    if (this._state === 'idle') {
      throw new Error('Cannot finish in idle state');
    }

    // If already draining, return existing promise
    if (this.drainPromise) {
      return this.drainPromise;
    }

    this.drainPromise = new Promise<string>((resolve) => {
      this.drainResolve = resolve;
    });

    this.clearThrottleTimer();

    if (this._state === 'sending') {
      // We are mid-send. Transition to draining. When send completes,
      // we will flush remaining and resolve.
      this.transition('draining');
    } else {
      // BUFFERING or PAUSED — go to draining and flush remaining
      this.transition('draining');
      if (this._buffer.hasContent) {
        this.doFlush();
      } else {
        // No content to flush — complete immediately
        this.completeDrain();
      }
    }

    return this.drainPromise;
  }

  cancel(): void {
    if (TERMINAL_STATES.has(this._state)) return; // idempotent for terminal
    this.clearThrottleTimer();
    this._buffer.clear();
    this.transition('cancelled');
  }

  error(err: Error): void {
    if (TERMINAL_STATES.has(this._state)) return;
    this.clearThrottleTimer();
    this.transition('error');
  }

  // ── Send lifecycle callbacks ──

  onSendComplete(): void {
    if (this._state === 'draining') {
      // We were draining. If buffer still has content, flush again.
      if (this._buffer.hasContent) {
        this.doFlush();
      } else {
        this.completeDrain();
      }
      return;
    }

    if (this._state !== 'sending') return;

    // Back to buffering
    this.transition('buffering');

    if (this._buffer.hasContent) {
      if (this.highPressurePending) {
        // Flush immediately — don't wait for throttle
        this.highPressurePending = false;
        this.doFlush();
      } else {
        // Normal: start throttle timer, will flush when it fires
        this.startThrottleTimer();
      }
    } else {
      this.highPressurePending = false;
      this.startThrottleTimer();
    }
  }

  onSendError(err: Error): void {
    if (this._state !== 'sending' && this._state !== 'draining') return;
    this.clearThrottleTimer();
    if (this.drainResolve) {
      this.drainResolve(this._buffer.fullContent);
      this.drainResolve = null;
      this.drainPromise = null;
    }
    this.transition('error');
  }

  onFlush(handler: FlushHandler): void {
    this.flushHandlers.push(handler);
  }

  onStateChange(handler: StateChangeHandler): void {
    this.stateChangeHandlers.push(handler);
  }

  // ── Private helpers ──

  private transition(to: StreamingState): void {
    const from = this._state;
    if (from === to) return;
    this._state = to;
    for (const handler of this.stateChangeHandlers) {
      handler(from, to);
    }
  }

  private assertState(action: string, expected: StreamingState): void {
    if (this._state !== expected) {
      throw new Error(
        `Cannot ${action} in state "${this._state}" (expected "${expected}")`
      );
    }
  }

  private assertNonTerminal(action: string): void {
    if (TERMINAL_STATES.has(this._state)) {
      throw new Error(
        `Cannot ${action} in terminal state "${this._state}"`
      );
    }
  }

  private startThrottleTimer(): void {
    this.clearThrottleTimer();
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null;
      this.onThrottleTick();
    }, this._config.throttleMs);
  }

  private clearThrottleTimer(): void {
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
  }

  private onThrottleTick(): void {
    // Only flush if in buffering state with content
    if (this._state === 'buffering' && this._buffer.hasContent) {
      this.doFlush();
    } else if (this._state === 'buffering') {
      // No content yet, restart timer
      this.startThrottleTimer();
    }
  }

  /**
   * Flush the buffer and invoke flush handlers.
   * Transitions to SENDING (or stays in DRAINING if draining).
   */
  private doFlush(): void {
    const content = this._buffer.flush();
    if (content.length === 0) return;

    // Transition to sending unless we are draining
    if (this._state !== 'draining') {
      this.transition('sending');
    }

    for (const handler of this.flushHandlers) {
      // Fire-and-forget from the FSM's perspective.
      // The caller is responsible for calling onSendComplete / onSendError.
      handler(content, this._cardId).catch((err) => {
        // If the handler throws synchronously via the promise, treat as send error
        this.onSendError(err instanceof Error ? err : new Error(String(err)));
      });
    }
  }

  private completeDrain(): void {
    const fullContent = this._buffer.fullContent;
    this.transition('completed');
    if (this.drainResolve) {
      this.drainResolve(fullContent);
      this.drainResolve = null;
    }
  }
}
