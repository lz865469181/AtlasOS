import { spawn, type ChildProcess } from "node:child_process";
import type { AgentSession, AgentEvent, AskQuestion } from "../types.js";
import { createLineIterator } from "../../core/utils.js";
import { log } from "../../core/logger.js";

export class ClaudeSession implements AgentSession {
  readonly sessionId: string;
  private process: ChildProcess;
  private eventQueue: AgentEvent[] = [];
  private waiters: ((done: boolean) => void)[] = [];
  private closed = false;

  constructor(sessionId: string, process: ChildProcess) {
    this.sessionId = sessionId;
    this.process = process;
    this.startReading();
  }

  async send(prompt: string): Promise<void> {
    const msg = JSON.stringify({
      type: "user",
      content: [{ type: "text", text: prompt }],
    });
    this.process.stdin?.write(msg + "\n");
  }

  respondPermission(allowed: boolean, message?: string): void {
    // Find the most recent permission request ID
    const pendingId = this.lastPermissionId;
    if (!pendingId) return;

    const resp = JSON.stringify({
      type: "control_response",
      id: pendingId,
      permission: { allow: allowed },
      ...(message ? { message } : {}),
    });
    this.process.stdin?.write(resp + "\n");
    this.lastPermissionId = undefined;
  }

  async *events(): AsyncIterable<AgentEvent> {
    while (!this.closed) {
      if (this.eventQueue.length > 0) {
        const ev = this.eventQueue.shift()!;
        yield ev;
        if (ev.type === "result" || ev.type === "error") return;
      } else {
        await new Promise<boolean>((resolve) => {
          this.waiters.push(resolve);
        });
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.process.kill("SIGTERM");
    for (const w of this.waiters) w(true);
    this.waiters = [];
  }

  private lastPermissionId?: string;

  private async startReading(): Promise<void> {
    if (!this.process.stdout) return;

    try {
      for await (const line of createLineIterator(this.process.stdout)) {
        if (!line.trim()) continue;
        let obj: any;
        try { obj = JSON.parse(line); } catch { continue; }

        const event = this.parseEvent(obj);
        if (event) {
          this.eventQueue.push(event);
          for (const w of this.waiters) w(false);
          this.waiters = [];
        }
      }
    } catch (err) {
      this.pushEvent({ type: "error", message: String(err) });
    }

    // Process ended
    this.closed = true;
    for (const w of this.waiters) w(true);
    this.waiters = [];
  }

  private pushEvent(event: AgentEvent): void {
    this.eventQueue.push(event);
    for (const w of this.waiters) w(false);
    this.waiters = [];
  }

  private parseEvent(obj: any): AgentEvent | null {
    switch (obj.type) {
      case "assistant":
        if (obj.message?.content) {
          for (const part of obj.message.content) {
            if (part.type === "text" && part.text) {
              return { type: "text", content: part.text };
            }
          }
        }
        // Streaming content delta
        if (obj.content_block?.type === "text" && obj.content_block?.text) {
          return { type: "text", content: obj.content_block.text };
        }
        return null;

      case "content_block_delta":
        if (obj.delta?.type === "text_delta" && obj.delta?.text) {
          return { type: "text", content: obj.delta.text };
        }
        if (obj.delta?.type === "thinking_delta" && obj.delta?.thinking) {
          return { type: "thinking", content: obj.delta.thinking };
        }
        return null;

      case "tool_use":
        return { type: "tool_use", tool: obj.name ?? "tool", input: JSON.stringify(obj.input ?? {}) };

      case "tool_result":
        return { type: "tool_result", tool: obj.tool_use_id ?? "", output: obj.content ?? "" };

      case "control_request":
        if (obj.permission) {
          this.lastPermissionId = obj.id;
          const questions: AskQuestion[] | undefined = obj.questions?.map((q: any) => ({
            question: q.question ?? q.text ?? "",
            options: q.options,
            multiSelect: q.multiSelect,
          }));
          return {
            type: "permission_request",
            id: obj.id,
            tool: obj.permission.tool ?? obj.tool ?? "unknown",
            input: JSON.stringify(obj.permission.input ?? obj.input ?? {}),
            questions,
          };
        }
        return null;

      case "result":
        return {
          type: "result",
          content: obj.result ?? "",
          sessionId: obj.session_id,
          usage: obj.usage ? {
            inputTokens: obj.usage.input_tokens ?? 0,
            outputTokens: obj.usage.output_tokens ?? 0,
          } : undefined,
        };

      case "error":
        return { type: "error", message: obj.error ?? obj.message ?? "Unknown error" };

      default:
        return null;
    }
  }
}
