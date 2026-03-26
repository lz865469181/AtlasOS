import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export interface WorkspaceBinding {
  channelName: string;
  workspace: string; // absolute path to workspace directory
  boundAt: string; // ISO timestamp
}

// Bindings keyed by channel identifier (e.g., "feishu:chatId" or "slack:channelId")
export type BindingsMap = Record<string, WorkspaceBinding>;

export class WorkspaceBindingStore {
  private bindings: BindingsMap = {};
  private filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  /** Get binding for a channel key */
  get(channelKey: string): WorkspaceBinding | undefined {
    return this.bindings[channelKey];
  }

  /** Set/update binding for a channel key */
  set(channelKey: string, binding: WorkspaceBinding): void {
    this.bindings[channelKey] = binding;
    this.scheduleSave();
  }

  /** Remove binding for a channel key */
  remove(channelKey: string): boolean {
    if (!(channelKey in this.bindings)) return false;
    delete this.bindings[channelKey];
    this.scheduleSave();
    return true;
  }

  /** List all bindings */
  list(): Array<{ channelKey: string } & WorkspaceBinding> {
    return Object.entries(this.bindings).map(([channelKey, binding]) => ({
      channelKey,
      ...binding,
    }));
  }

  /** Find binding by workspace path */
  findByWorkspace(
    workspace: string,
  ): { channelKey: string; binding: WorkspaceBinding } | undefined {
    for (const [channelKey, binding] of Object.entries(this.bindings)) {
      if (binding.workspace === workspace) return { channelKey, binding };
    }
    return undefined;
  }

  /**
   * Auto-resolve workspace from channel name.
   * Checks if base_dir/<channelName>/ exists.
   */
  static resolveByConvention(
    baseDir: string,
    channelName: string,
  ): string | null {
    const candidate = join(baseDir, channelName);
    return existsSync(candidate) ? candidate : null;
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        this.bindings = JSON.parse(raw);
      }
    } catch (err) {
      console.error(
        `[workspace] failed to load bindings from ${this.filePath}:`,
        err,
      );
      this.bindings = {};
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveSync(), 1000);
  }

  private saveSync(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(
        this.filePath,
        JSON.stringify(this.bindings, null, 2),
        "utf-8",
      );
    } catch (err) {
      console.error(
        `[workspace] failed to save bindings to ${this.filePath}:`,
        err,
      );
    }
  }

  /** Force immediate save (for shutdown) */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveSync();
  }
}
