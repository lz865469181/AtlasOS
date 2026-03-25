/** Message deduplication with TTL-based expiry. */
export class MessageDedup {
  private seen = new Map<string, number>();
  private timer: ReturnType<typeof setInterval>;

  constructor(private ttlMs: number = 60_000) {
    this.timer = setInterval(() => this.cleanup(), 30_000);
  }

  /** Returns true if this message ID has been seen within TTL. */
  isDuplicate(messageID: string): boolean {
    const now = Date.now();
    if (this.seen.has(messageID)) return true;
    this.seen.set(messageID, now);
    return false;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(id);
    }
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}

/** Check if a message timestamp is from before the process started. */
const processStartTime = Date.now();

export function isOldMessage(timestampMs: number, graceMs: number = 2000): boolean {
  return timestampMs < processStartTime - graceMs;
}
