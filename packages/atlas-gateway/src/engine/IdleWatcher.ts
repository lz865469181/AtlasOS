// ── Types ──────────────────────────────────────────────────────────────────

export interface IdleWatcherConfig {
  /** Idle timeout in milliseconds. Default: 10 minutes. */
  timeoutMs: number;
  /** Called when a session has been idle for timeoutMs. */
  onIdle: (sessionId: string, chatId: string) => Promise<void>;
}

interface WatchEntry {
  chatId: string;
  timer: ReturnType<typeof setTimeout>;
}

// ── Implementation ─────────────────────────────────────────────────────────

export class IdleWatcher {
  private readonly timeoutMs: number;
  private readonly onIdle: IdleWatcherConfig['onIdle'];
  private readonly entries = new Map<string, WatchEntry>();

  constructor(config: IdleWatcherConfig) {
    this.timeoutMs = config.timeoutMs;
    this.onIdle = config.onIdle;
  }

  /**
   * Reset the idle timer for a session.
   * Call this on every user message / prompt.
   */
  touch(sessionId: string, chatId: string): void {
    this.remove(sessionId);

    const timer = setTimeout(() => {
      this.entries.delete(sessionId);
      void this.onIdle(sessionId, chatId);
    }, this.timeoutMs);

    // Unref so the timer doesn't prevent Node from exiting
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }

    this.entries.set(sessionId, { chatId, timer });
  }

  /**
   * Stop watching a session (e.g. when it's destroyed).
   */
  remove(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) {
      clearTimeout(entry.timer);
      this.entries.delete(sessionId);
    }
  }

  /**
   * Clear all timers. Call on shutdown.
   */
  dispose(): void {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
    }
    this.entries.clear();
  }
}
