import { spawn } from "node:child_process";
import type { AgentSession, AgentEvent } from "../types.js";
import { createLineIterator } from "../../core/utils.js";

export class OpenCodeSession implements AgentSession {
  readonly sessionId: string;
  private cliPath: string;
  private workDir: string;
  private model?: string;
  private currentEvents: AgentEvent[] = [];
  private eventResolve?: () => void;

  constructor(sessionId: string, opts: { cliPath: string; workDir: string; model?: string }) {
    this.sessionId = sessionId;
    this.cliPath = opts.cliPath;
    this.workDir = opts.workDir;
    this.model = opts.model;
  }

  async send(prompt: string): Promise<void> {
    this.currentEvents = [];
    const args = ["run", "--format", "json"];
    if (this.model) args.push("--model", this.model);

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

      if (obj.type === "result" && obj.result) {
        this.currentEvents.push({ type: "result", content: obj.result });
      } else if (obj.type === "assistant" && obj.message?.content) {
        const texts = obj.message.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text);
        const text = texts.join("\n");
        if (text) { accText += text; this.currentEvents.push({ type: "text", content: text }); }
      } else if (obj.text) {
        accText += obj.text;
        this.currentEvents.push({ type: "text", content: obj.text });
      } else if (obj.type === "error") {
        this.currentEvents.push({ type: "error", message: obj.message ?? "OpenCode error" });
      }
    }

    if (!this.currentEvents.some(e => e.type === "result" || e.type === "error")) {
      this.currentEvents.push({ type: "result", content: accText || "(no output)" });
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
}
