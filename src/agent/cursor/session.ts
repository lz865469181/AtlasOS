import { spawn } from "node:child_process";
import type { AgentSession, AgentEvent } from "../types.js";
import { createLineIterator } from "../../core/utils.js";

export class CursorSession implements AgentSession {
  readonly sessionId: string;
  private cliPath: string;
  private workDir: string;
  private mode: string;
  private model?: string;
  private chatId?: string;
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

      if (obj.type === "system" && obj.session_id) {
        this.chatId = obj.session_id;
      } else if (obj.type === "assistant") {
        const text = obj.content ?? "";
        if (text) { accText += text; this.currentEvents.push({ type: "text", content: text }); }
      } else if (obj.type === "thinking") {
        if (obj.content) this.currentEvents.push({ type: "thinking", content: obj.content });
      } else if (obj.type === "tool_call" && obj.subtype === "started") {
        this.currentEvents.push({ type: "tool_use", tool: obj.tool ?? "tool", input: "" });
      } else if (obj.type === "result") {
        const content = obj.result ?? accText;
        if (obj.is_error) {
          this.currentEvents.push({ type: "error", message: content });
        } else {
          this.currentEvents.push({ type: "result", content });
        }
      } else if (obj.type === "error") {
        this.currentEvents.push({ type: "error", message: obj.message ?? "Cursor error" });
      }
    }
    if (!this.currentEvents.some(e => e.type === "result" || e.type === "error") && accText) {
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

  async close(): Promise<void> {}

  private buildArgs(): string[] {
    const args = ["--print", "--output-format", "stream-json", "--trust"];
    if (this.chatId) args.push("--resume", this.chatId);
    const modeFlags: Record<string, string[]> = {
      default: [], force: ["--force"],
      plan: ["--mode", "plan"], ask: ["--mode", "ask"],
    };
    args.push(...(modeFlags[this.mode] ?? []));
    if (this.model) args.push("--model", this.model);
    return args;
  }
}
