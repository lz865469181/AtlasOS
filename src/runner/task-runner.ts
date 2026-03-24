import { spawn } from "node:child_process";
import { getConfig, parseDuration } from "../config.js";
import { getCliPath, buildSpawnArgs, getStdinPrompt } from "../backend/index.js";
import { emit } from "../webui/events.js";
import type { PlatformSender } from "../platform/types.js";

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

export interface TaskDefinition {
  id: string;
  description: string;
  prompt: string;
  workDir: string;
}

export interface TaskResult {
  id: string;
  description: string;
  status: "success" | "error" | "timeout";
  result: string;
  durationMs: number;
}

export interface TaskRunnerConfig {
  maxConcurrent: number;
  timeoutMs: number;
  model?: string;
}

const DEFAULT_CONFIG: TaskRunnerConfig = {
  maxConcurrent: 3,
  timeoutMs: 15 * 60 * 1000, // 15 minutes
};

/**
 * Inline concurrency limiter (p-limit style, no external dependency).
 * Returns a function that wraps async work and ensures at most `limit`
 * tasks run concurrently.
 */
function createLimiter(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  function next(): void {
    if (queue.length > 0 && active < limit) {
      active++;
      const resolve = queue.shift()!;
      resolve();
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        } finally {
          active--;
          next();
        }
      };

      if (active < limit) {
        active++;
        run();
      } else {
        queue.push(() => { run(); });
      }
    });
  };
}

/**
 * Run a single CLI subprocess for a task definition.
 * Returns the result text or throws on failure.
 */
function runSingleTask(
  task: TaskDefinition,
  config: TaskRunnerConfig,
): Promise<TaskResult> {
  return new Promise<TaskResult>((resolve) => {
    const start = Date.now();
    const cliPath = getCliPath();

    const args = buildSpawnArgs({
      prompt: task.prompt,
      outputFormat: "json",
      model: config.model,
      addDirs: [task.workDir],
    });

    const child = spawn(cliPath, args, {
      cwd: task.workDir,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      timeout: config.timeoutMs,
    });

    const stdinPrompt = getStdinPrompt({ prompt: task.prompt });
    child.stdin?.write(stdinPrompt);
    child.stdin?.end();

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on("close", (code, signal) => {
      const durationMs = Date.now() - start;

      if (code === null) {
        // Killed by signal (timeout)
        resolve({
          id: task.id,
          description: task.description,
          status: "timeout",
          result: `Task timed out after ${Math.round(durationMs / 1000)}s${signal ? ` (signal: ${signal})` : ""}`,
          durationMs,
        });
        return;
      }

      if (code !== 0) {
        resolve({
          id: task.id,
          description: task.description,
          status: "error",
          result: stderr.trim() || `Process exited with code ${code}`,
          durationMs,
        });
        return;
      }

      // Parse JSON output
      let resultText: string;
      try {
        const parsed = JSON.parse(stdout.trim());
        resultText = parsed.result || stdout.trim();
      } catch {
        resultText = stdout.trim();
      }

      resolve({
        id: task.id,
        description: task.description,
        status: "success",
        result: resultText,
        durationMs,
      });
    });

    child.on("error", (err) => {
      resolve({
        id: task.id,
        description: task.description,
        status: "error",
        result: `Failed to spawn: ${String(err)}`,
        durationMs: Date.now() - start,
      });
    });
  });
}

export class TaskRunner {
  private config: TaskRunnerConfig;

  constructor(config?: Partial<TaskRunnerConfig>) {
    const appConfig = getConfig();
    this.config = {
      ...DEFAULT_CONFIG,
      maxConcurrent: appConfig.agent.max_concurrent_per_agent ?? DEFAULT_CONFIG.maxConcurrent,
      ...config,
    };
  }

  /**
   * Run multiple tasks concurrently with progress reporting to Feishu.
   * Uses a semaphore to limit concurrency.
   */
  async runParallel(
    tasks: TaskDefinition[],
    sender: PlatformSender,
    chatID: string,
    userID: string,
    chatType: "p2p" | "group",
  ): Promise<TaskResult[]> {
    const atPrefix = chatType === "group" ? `<at id=${userID}></at>\n` : "";
    const limiter = createLimiter(this.config.maxConcurrent);

    log("info", "TaskRunner starting parallel tasks", {
      userID,
      taskCount: tasks.length,
      maxConcurrent: this.config.maxConcurrent,
    });

    emit("task-runner", { status: "started", userID, taskCount: tasks.length });

    // Send initial progress card
    const taskList = tasks.map((t) => `- [ ] **${t.id}**: ${t.description}`).join("\n");
    await sender.sendMarkdown(
      chatID,
      `${atPrefix}**Running ${tasks.length} parallel tasks** (max ${this.config.maxConcurrent} concurrent)\n\n${taskList}`,
    );

    // Execute all tasks with concurrency limit
    const promises = tasks.map((task) =>
      limiter(async () => {
        log("info", "Task started", { taskId: task.id, userID });
        emit("task-runner", { status: "task-started", userID, taskId: task.id });

        const result = await runSingleTask(task, this.config);

        // Report individual task completion
        const icon = result.status === "success" ? "done" : "failed";
        const duration = `${(result.durationMs / 1000).toFixed(1)}s`;
        sender.sendMarkdown(
          chatID,
          `${atPrefix}**Task ${result.id}** — ${icon} (${duration})\n\n${result.result.slice(0, 1000)}`,
        ).catch(() => {});

        log("info", "Task completed", {
          taskId: task.id,
          status: result.status,
          durationMs: result.durationMs,
        });
        emit("task-runner", { status: "task-completed", userID, taskId: task.id, taskStatus: result.status });

        return result;
      }),
    );

    const results = await Promise.all(promises);

    // Send final summary
    const succeeded = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status !== "success").length;
    const totalDuration = Math.max(...results.map((r) => r.durationMs));

    const summaryLines = results.map((r) => {
      const icon = r.status === "success" ? "[x]" : "[ ]";
      const duration = `${(r.durationMs / 1000).toFixed(1)}s`;
      return `- ${icon} **${r.id}**: ${r.description} (${duration})`;
    });

    await sender.sendMarkdown(
      chatID,
      [
        `${atPrefix}**All Tasks Complete**`,
        "",
        `${succeeded}/${tasks.length} succeeded, ${failed} failed`,
        `Total wall time: ${(totalDuration / 1000).toFixed(1)}s`,
        "",
        ...summaryLines,
      ].join("\n"),
    );

    log("info", "TaskRunner completed all tasks", {
      userID,
      succeeded,
      failed,
      totalDurationMs: totalDuration,
    });
    emit("task-runner", { status: "completed", userID, succeeded, failed });

    return results;
  }
}
