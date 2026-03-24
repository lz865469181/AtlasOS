import { parseCron, matchesCron } from "./cron-parser.js";
import type { CronFields } from "./cron-parser.js";

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

export interface ScheduledTask {
  /** Unique task name for logging/identification. */
  name: string;
  /** 5-field cron expression (minute hour dom month dow). */
  schedule: string;
  /** Whether this task is enabled. */
  enabled: boolean;
  /** The function to execute when the schedule fires. */
  handler: () => Promise<void>;
}

interface RegisteredTask extends ScheduledTask {
  cronFields: CronFields;
  lastRunMinute: number; // prevents double-fire within the same minute
}

/**
 * Lightweight in-process task scheduler.
 *
 * Checks every 30 seconds whether any registered task's cron expression
 * matches the current time. Each task fires at most once per matched minute.
 *
 * No external dependencies — uses a simple setInterval + cron matcher.
 */
export class Scheduler {
  private tasks: RegisteredTask[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Check interval in ms (default 30s — granularity is 1 minute anyway). */
  private readonly CHECK_INTERVAL_MS = 30_000;

  /**
   * Register a scheduled task.
   * The cron expression is parsed eagerly so errors surface at startup.
   */
  register(task: ScheduledTask): void {
    if (!task.enabled) {
      log("info", `Scheduled task "${task.name}" is disabled, skipping registration`);
      return;
    }

    const cronFields = parseCron(task.schedule);
    this.tasks.push({
      ...task,
      cronFields,
      lastRunMinute: -1,
    });

    log("info", `Scheduled task registered: "${task.name}"`, { schedule: task.schedule });
  }

  /** Start the scheduler loop. */
  start(): void {
    if (this.timer) return;

    log("info", "Scheduler started", { taskCount: this.tasks.length });

    // Do an immediate check on startup
    this.tick();

    this.timer = setInterval(() => this.tick(), this.CHECK_INTERVAL_MS);
  }

  /** Stop the scheduler and cancel pending timers. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log("info", "Scheduler stopped");
  }

  /** Number of registered (enabled) tasks. */
  get size(): number {
    return this.tasks.length;
  }

  private tick(): void {
    const now = new Date();
    // Encode current minute as YYYYMMDDHHMM to avoid repeat execution
    const minuteKey =
      now.getFullYear() * 100_000_000 +
      (now.getMonth() + 1) * 1_000_000 +
      now.getDate() * 10_000 +
      now.getHours() * 100 +
      now.getMinutes();

    for (const task of this.tasks) {
      if (task.lastRunMinute === minuteKey) continue;
      if (!matchesCron(now, task.cronFields)) continue;

      task.lastRunMinute = minuteKey;
      log("info", `Executing scheduled task: "${task.name}"`);

      task.handler().catch((err) => {
        log("error", `Scheduled task "${task.name}" failed`, { error: String(err) });
      });
    }
  }
}
