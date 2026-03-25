import { spawn, type ChildProcess } from "node:child_process";
import type { AgentSession, AgentEvent } from "../types.js";
import { createLineIterator } from "../../core/utils.js";

export class CodexSession implements AgentSession {
  readonly sessionId: string;
  private cliPath: string;
  private workDir: string;
  private mode: string;
  private model?: string;
  private threadId?: string;
  private currentEvents: AgentEvent[] = [];
  private eventResolve?: () => void;

  constructor(sessionId: string, opts: { cliPath: string; workDir: string; mode: string; model?: string }) {
    this.sessionId = sessionId;
    this.cliPath = opts.cliPath;
    this.workDir = opts.workDir;
    this.mode = opts.mode;
    this.model = opts.model;
  }

  async send(prompt: string): Promise<void> {
    this.currentEvents = [];
    const args = this.buildArgs();
    const child = spawn(this.cliPath, args, {
      cwd: this.workDir, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    child.stdin?.write(prompt);
    child.stdin?.end();

    let accText = "";
    for await (const line of createLineIterator(child.stdout!)) {
      if (!line.trim()) continue;
      let obj: any;
      try { obj = JSON.parse(line); } catch { continue; }

      if (obj.type === "thread.started" && obj.thread_id) {
        this.threadId = obj.thread_id;
      } else if (obj.type === "item.completed" && obj.item?.role === "assistant") {
        const text = obj.item.content?.map((c: any) => c.text ?? "").join("") ?? "";
        if (text) { accText += text; this.currentEvents.push({ type: "text", content: text }); }
      } else if (obj.type === "item.started" && obj.item?.type === "function_call") {
        this.currentEvents.push({ type: "tool_use", tool: obj.item.name ?? "tool", input: "" });
      } else if (obj.type === "turn.completed") {
        this.currentEvents.push({ type: "result", content: accText });
      } else if (obj.type === "error") {
        this.currentEvents.push({ type: "error", message: obj.message ?? "Codex error" });
      }
    }
    if (!this.currentEvents.some(e => e.type === "result") && accText) {
      this.currentEvents.push({ type: "result", content: accText });
    }
    this.eventResolve?.();
  }

  respondPermission(): void { /* no-op */ }

  async *events(): AsyncIterable<AgentEvent> {
    if (this.currentEvents.length === 0) {
      await new Promise<void>(r => { this.eventResolve = r; });
    }
    for (const ev of this.currentEvents) yield ev;
  }

  async close(): Promise<void> { /* subprocess already exited */ }

  private buildArgs(): string[] {
    const args: string[] = [];
    if (this.threadId) {
      args.push("exec", "resume", this.threadId, "--json");
    } else {
      args.push("exec", "--json");
    }
    const modeFlags: Record<string, string[]> = {
      suggest: [], "auto-edit": ["--full-auto"], "full-auto": ["--full-auto"],
      yolo: ["--dangerously-bypass-approvals-and-sandbox"],
    };
    args.push(...(modeFlags[this.mode] ?? []));
    if (this.model) args.push("--model", this.model);
    return args;
  }
}
