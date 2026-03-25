import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { log } from "../logger.js";
import { atomicWriteFile } from "../utils.js";

export interface WorkspaceBinding {
  channelKey: string;
  workspace: string;
  boundAt: number;
}

export class WorkspaceBindingManager {
  private bindings = new Map<string, WorkspaceBinding>();
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  bind(channelKey: string, workspace: string): void {
    this.bindings.set(channelKey, { channelKey, workspace, boundAt: Date.now() });
    this.save();
  }

  unbind(channelKey: string): void {
    this.bindings.delete(channelKey);
    this.save();
  }

  lookup(channelKey: string): string | undefined {
    return this.bindings.get(channelKey)?.workspace;
  }

  list(): WorkspaceBinding[] {
    return [...this.bindings.values()];
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf-8"));
      for (const b of data) {
        this.bindings.set(b.channelKey, b);
      }
    } catch { /* ignore corrupt file */ }
  }

  private save(): void {
    atomicWriteFile(this.filePath, JSON.stringify([...this.bindings.values()], null, 2));
  }
}
