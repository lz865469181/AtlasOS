import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

/**
 * Return the default workspace root path: `.atlasOS` under the user's
 * home directory on all platforms.
 *
 * - Windows  → C:\Users\<user>\.atlasOS
 * - macOS    → ~/.atlasOS
 * - Linux    → ~/.atlasOS
 */
export function getDefaultWorkspaceRoot(): string {
  return join(homedir(), ".atlasOS");
}

const DEFAULT_SOUL = `# Default AI Assistant
## Values
- Be helpful and accurate
`;

const DEFAULT_AGENTS = `# Agent Collaboration
`;

const DEFAULT_USER_CLAUDE = `# User Memory

## Identity
- New user

## Preferences
- (none yet)

## Key Context
- (none yet)
`;

export class Workspace {
  readonly root: string;
  readonly agentID: string;

  constructor(root: string, agentID: string) {
    this.root = resolve(root);
    this.agentID = agentID;
  }

  get agentDir(): string {
    return join(this.root, "agents", this.agentID);
  }

  get usersDir(): string {
    return join(this.agentDir, "users");
  }

  soulPath(): string {
    return join(this.agentDir, "SOUL.md");
  }

  agentsFilePath(): string {
    return join(this.agentDir, "AGENTS.md");
  }

  userDir(userID: string): string {
    const sanitized = this.sanitizeUserID(userID);
    return join(this.usersDir, sanitized);
  }

  userClaudePath(userID: string): string {
    return join(this.userDir(userID), "CLAUDE.md");
  }

  userMemoryPath(userID: string): string {
    return join(this.userDir(userID), "MEMORY.md");
  }

  userProfilePath(userID: string): string {
    return join(this.userDir(userID), "USER.md");
  }

  /** Per-user uploads directory for downloaded images/files. */
  uploadsDir(userID: string): string {
    return join(this.userDir(userID), "uploads");
  }

  /** Per-user inbox file for CLI polling (Feishu → CLI bridge). */
  inboxPath(userID: string): string {
    return join(this.userDir(userID), "inbox.jsonl");
  }

  /** Initialize agent workspace directories and default files. */
  init(soulContent?: string, agentsContent?: string): void {
    const dirs = [
      this.agentDir,
      join(this.agentDir, "skills"),
      join(this.agentDir, "memory"),
      this.usersDir,
    ];
    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true });
    }

    // SOUL.md — always overwrite (source of truth)
    writeFileSync(this.soulPath(), soulContent ?? DEFAULT_SOUL, "utf-8");

    // AGENTS.md — always overwrite
    writeFileSync(this.agentsFilePath(), agentsContent ?? DEFAULT_AGENTS, "utf-8");

    // sessions.json — only if missing
    const sessionsPath = join(this.agentDir, "sessions.json");
    if (!existsSync(sessionsPath)) {
      writeFileSync(sessionsPath, "{}", "utf-8");
    }
  }

  /** Initialize per-user directory and default files (no-clobber). */
  initUser(userID: string): string {
    const dir = this.userDir(userID);
    mkdirSync(dir, { recursive: true });

    const defaults: [string, string][] = [
      [this.userProfilePath(userID), "# User Profile\n"],
      [this.userMemoryPath(userID), "# Long-term Memory\n"],
      [this.userClaudePath(userID), DEFAULT_USER_CLAUDE],
    ];

    for (const [path, content] of defaults) {
      if (!existsSync(path)) {
        writeFileSync(path, content, "utf-8");
      }
    }

    return dir;
  }

  /** Read SOUL.md content. */
  readSoul(): string {
    try {
      return readFileSync(this.soulPath(), "utf-8");
    } catch {
      return DEFAULT_SOUL;
    }
  }

  /** Read AGENTS.md content. */
  readAgents(): string {
    try {
      return readFileSync(this.agentsFilePath(), "utf-8");
    } catch {
      return "";
    }
  }

  /** Read per-user MEMORY.md. */
  readUserMemory(userID: string): string {
    try {
      return readFileSync(this.userMemoryPath(userID), "utf-8");
    } catch {
      return "";
    }
  }

  /**
   * Sanitize a userID to prevent path traversal.
   * Strips path separators and ensures the result stays within the users directory.
   */
  private sanitizeUserID(userID: string): string {
    // Remove any path separators and parent-directory references
    const sanitized = userID.replace(/[\\/]/g, "_").replace(/\.\./g, "_");
    // Verify the resulting path stays within the users directory
    const resolved = resolve(this.usersDir, sanitized);
    if (!resolved.startsWith(this.usersDir)) {
      throw new Error(`Invalid userID: path traversal detected`);
    }
    return sanitized;
  }

  /** Check if a path is inside this workspace (security guard). */
  isPathInWorkspace(path: string): boolean {
    const resolved = resolve(path);
    return resolved.startsWith(this.root);
  }

  /** List all user IDs under this agent's workspace. */
  listUsers(): string[] {
    const dir = this.usersDir;
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  }

  // --- Multi-agent management ---

  /** Get the agents root directory. */
  get agentsRoot(): string {
    return join(this.root, "agents");
  }

  /** List all available agent IDs. */
  listAgents(): Array<{ id: string; description: string }> {
    const agentsDir = this.agentsRoot;
    if (!existsSync(agentsDir)) return [];

    const entries = readdirSync(agentsDir, { withFileTypes: true });
    const agents: Array<{ id: string; description: string }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const soulPath = join(agentsDir, entry.name, "SOUL.md");
      let description = "";
      try {
        const content = readFileSync(soulPath, "utf-8");
        // Extract first non-heading non-empty line as description
        const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
        description = lines[0]?.trim().slice(0, 100) ?? "";
      } catch { /* no SOUL.md */ }
      agents.push({ id: entry.name, description });
    }

    return agents;
  }

  /** Check if an agent exists. */
  agentExists(agentID: string): boolean {
    return existsSync(join(this.agentsRoot, agentID, "SOUL.md"));
  }

  /**
   * Create a new agent with the given SOUL.md content.
   * Returns the new Workspace instance for the agent.
   */
  createAgent(agentID: string, soulContent: string, description?: string): Workspace {
    const agentDir = join(this.agentsRoot, agentID);
    if (existsSync(agentDir)) {
      throw new Error(`Agent "${agentID}" already exists`);
    }

    const newWorkspace = new Workspace(this.root, agentID);
    const header = description ? `# ${agentID}\n\n> ${description}\n\n` : "";
    newWorkspace.init(header + soulContent);
    return newWorkspace;
  }

  /** Create a Workspace instance pointing to a different agent. */
  forAgent(agentID: string): Workspace {
    return new Workspace(this.root, agentID);
  }
}
