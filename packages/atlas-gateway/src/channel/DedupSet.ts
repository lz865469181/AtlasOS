// ── Dedup Set ────────────────────────────────────────────────────────────

/**
 * Bounded set for message deduplication.
 * Evicts the oldest entry when size exceeds max.
 */
export class DedupSet {
  private set = new Set<string>();
  private readonly max: number;

  constructor(max: number = 1000) {
    this.max = max;
  }

  has(id: string): boolean {
    return this.set.has(id);
  }

  add(id: string): void {
    this.set.add(id);
    if (this.set.size > this.max) {
      const first = this.set.values().next().value;
      if (first !== undefined) this.set.delete(first);
    }
  }

  get size(): number {
    return this.set.size;
  }

  clear(): void {
    this.set.clear();
  }
}

// ── Stale message filter ─────────────────────────────────────────────────

/**
 * Check if a message is stale (older than maxAgeMs).
 * @param createTimeMs - Message creation time in milliseconds
 * @param maxAgeMs - Maximum allowed age in milliseconds
 * @param nowMs - Current time in milliseconds (injectable for testing)
 */
export function isStaleMessage(createTimeMs: number, maxAgeMs: number, nowMs?: number): boolean {
  const now = nowMs ?? Date.now();
  const age = now - createTimeMs;
  return age > maxAgeMs;
}
