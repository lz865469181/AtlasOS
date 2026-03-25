// src/core/cron.ts
// Proper cron scheduler: field-level matching (replaces setInterval approximation).
// Merges scheduler/cron-parser.ts + cron/manager.ts into one file.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "./logger.js";

// ─── Cron Parser ────────────────────────────────────────────────────────────

export interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2]!, 10) : 1;
    const range = stepMatch ? stepMatch[1]! : part;

    let start: number;
    let end: number;

    if (range === "*") {
      start = min;
      end = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      start = a!;
      end = b!;
    } else {
      start = parseInt(range, 10);
      end = start;
    }

    for (let i = start; i <= end; i += step) {
      if (i >= min && i <= max) values.add(i);
    }
  }
  return values;
}

/** Parse a 5-field cron expression. */
export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }
  return {
    minutes: parseField(parts[0]!, 0, 59),
    hours: parseField(parts[1]!, 0, 23),
    daysOfMonth: parseField(parts[2]!, 1, 31),
    months: parseField(parts[3]!, 1, 12),
    daysOfWeek: parseField(parts[4]!, 0, 6),
  };
}

/** Check if a Date matches the given cron fields. */
export function matchesCron(date: Date, fields: CronFields): boolean {
  return (
    fields.minutes.has(date.getMinutes()) &&
    fields.hours.has(date.getHours()) &&
    fields.daysOfMonth.has(date.getDate()) &&
    fields.months.has(date.getMonth() + 1) &&
    fields.daysOfWeek.has(date.getDay())
  );
}

// ─── Cron Job Manager ───────────────────────────────────────────────────────

export interface CronJob {
  id: string;
  userID: string;
  chatID: string;
  platform: string;
  cronExpr: string;
  prompt: string;
  description?: string;
  enabled: boolean;
  silent?: boolean;
  newSessionPerRun?: boolean;
  timeoutMins?: number;
  createdAt: string;
  lastRun?: string;
  lastError?: string;
}

export class CronManager {
  private jobs: CronJob[] = [];
  private parsedFields = new Map<string, CronFields>();
  private tickTimer?: NodeJS.Timeout;
  private filePath: string;
  private triggerHandler?: (job: CronJob) => Promise<void>;
  private lastTickMinute = -1;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  setTriggerHandler(handler: (job: CronJob) => Promise<void>): void {
    this.triggerHandler = handler;
  }

  /** Start the minute-resolution tick loop. */
  startAll(): void {
    // Pre-parse all cron expressions
    for (const job of this.jobs) {
      if (job.enabled) {
        try {
          this.parsedFields.set(job.id, parseCron(job.cronExpr));
        } catch {
          log("warn", "Invalid cron expression, skipping", { id: job.id, expr: job.cronExpr });
        }
      }
    }

    // Tick every 30s to avoid missing minute boundaries
    this.tickTimer = setInterval(() => this.tick(), 30_000);
    log("info", "Cron manager started (field-level matching)", { jobCount: this.jobs.length });
  }

  stopAll(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
    this.parsedFields.clear();
  }

  add(job: Omit<CronJob, "id" | "createdAt" | "enabled">): CronJob {
    const newJob: CronJob = {
      ...job,
      id: `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    this.jobs.push(newJob);
    try {
      this.parsedFields.set(newJob.id, parseCron(newJob.cronExpr));
    } catch {
      log("warn", "Invalid cron expression for new job", { id: newJob.id });
    }
    this.save();
    return newJob;
  }

  remove(id: string): boolean {
    const idx = this.jobs.findIndex((j) => j.id === id);
    if (idx === -1) return false;
    this.jobs.splice(idx, 1);
    this.parsedFields.delete(id);
    this.save();
    return true;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return false;
    job.enabled = enabled;
    if (enabled) {
      try { this.parsedFields.set(id, parseCron(job.cronExpr)); } catch { /* skip */ }
    } else {
      this.parsedFields.delete(id);
    }
    this.save();
    return true;
  }

  list(userID?: string): CronJob[] {
    if (userID) return this.jobs.filter((j) => j.userID === userID);
    return [...this.jobs];
  }

  get(id: string): CronJob | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private tick(): void {
    if (!this.triggerHandler) return;

    const now = new Date();
    const currentMinute = now.getHours() * 60 + now.getMinutes();

    // Avoid double-firing in the same minute
    if (currentMinute === this.lastTickMinute) return;
    this.lastTickMinute = currentMinute;

    for (const job of this.jobs) {
      if (!job.enabled) continue;
      const fields = this.parsedFields.get(job.id);
      if (!fields) continue;

      if (matchesCron(now, fields)) {
        job.lastRun = now.toISOString();
        this.triggerHandler(job).catch((err) => {
          job.lastError = String(err);
          log("error", "Cron job failed", { id: job.id, error: job.lastError });
        });
        this.save();
      }
    }
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const data = JSON.parse(readFileSync(this.filePath, "utf-8"));
        this.jobs = data.jobs ?? [];
      }
    } catch {
      this.jobs = [];
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify({ jobs: this.jobs }, null, 2), "utf-8");
    } catch (err) {
      log("error", "Failed to save cron jobs", { error: String(err) });
    }
  }
}

/** Convert cron expression to human-readable string. */
export function cronToHuman(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [minute, hour, dom, month, dow] = parts;

  if (minute?.startsWith("*/")) return `Every ${minute.slice(2)} minutes`;
  if (hour === "*" && minute && !minute.includes("*")) return `Every hour at :${minute.padStart(2, "0")}`;
  if (!minute?.includes("*") && !hour?.includes("*") && dom === "*" && month === "*") {
    if (dow === "*") return `Daily at ${hour}:${minute!.padStart(2, "0")}`;
    return `At ${hour}:${minute!.padStart(2, "0")} on days ${dow}`;
  }
  return expr;
}
