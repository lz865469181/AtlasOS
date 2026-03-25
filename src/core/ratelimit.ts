export interface RateLimitConfig {
  maxMessages: number;
  windowMs: number;
}

interface RateBucket {
  timestamps: number[];
  lastAccess: number;
}

export class RateLimiter {
  private buckets = new Map<string, RateBucket>();
  private maxMessages: number;
  private windowMs: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: RateLimitConfig) {
    this.maxMessages = config.maxMessages;
    this.windowMs = config.windowMs;
    if (this.maxMessages > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }
  }

  allow(key: string): boolean {
    if (this.maxMessages <= 0) return true;
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [], lastAccess: now };
      this.buckets.set(key, bucket);
    }
    bucket.timestamps = bucket.timestamps.filter((ts) => now - ts < this.windowMs);
    bucket.lastAccess = now;
    if (bucket.timestamps.length >= this.maxMessages) return false;
    bucket.timestamps.push(now);
    return true;
  }

  remaining(key: string): number {
    if (this.maxMessages <= 0) return Infinity;
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket) return this.maxMessages;
    const recent = bucket.timestamps.filter((ts) => now - ts < this.windowMs);
    return Math.max(0, this.maxMessages - recent.length);
  }

  private cleanup(): void {
    const now = Date.now();
    const staleThreshold = this.windowMs * 2;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastAccess > staleThreshold) this.buckets.delete(key);
    }
  }

  dispose(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }
}

export interface UserRole {
  name: string;
  userIDs: string[];
  disabledCommands?: string[];
  rateLimit?: RateLimitConfig;
}

export class UserRoleManager {
  private roles: UserRole[] = [];
  private userMap = new Map<string, UserRole>();
  private roleLimiters = new Map<string, RateLimiter>();
  private defaultRole?: string;

  configure(roles: UserRole[], defaultRole?: string): void {
    this.roles = roles;
    this.defaultRole = defaultRole;
    for (const limiter of this.roleLimiters.values()) limiter.dispose();
    this.roleLimiters.clear();
    this.userMap.clear();
    for (const role of roles) {
      for (const uid of role.userIDs) this.userMap.set(uid.toLowerCase(), role);
      if (role.rateLimit) this.roleLimiters.set(role.name, new RateLimiter(role.rateLimit));
    }
  }

  resolveRole(userID: string): UserRole | undefined {
    const direct = this.userMap.get(userID.toLowerCase());
    if (direct) return direct;
    const wildcard = this.roles.find((r) => r.userIDs.includes("*"));
    if (wildcard) return wildcard;
    if (this.defaultRole) return this.roles.find((r) => r.name === this.defaultRole);
    return undefined;
  }

  allowRate(userID: string): { allowed: boolean; handled: boolean } {
    const role = this.resolveRole(userID);
    if (!role?.rateLimit) return { allowed: true, handled: false };
    const limiter = this.roleLimiters.get(role.name);
    if (!limiter) return { allowed: true, handled: false };
    return { allowed: limiter.allow(userID), handled: true };
  }

  isCommandDisabled(userID: string, command: string): boolean {
    const role = this.resolveRole(userID);
    if (!role?.disabledCommands) return false;
    const normalizedCmd = command.toLowerCase().replace(/^\//, "");
    return role.disabledCommands.includes(normalizedCmd) || role.disabledCommands.includes("*");
  }

  dispose(): void {
    for (const limiter of this.roleLimiters.values()) limiter.dispose();
  }
}
