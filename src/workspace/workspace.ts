import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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
    return join(this.usersDir, userID);
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

  /** Check if a path is inside this workspace (security guard). */
  isPathInWorkspace(path: string): boolean {
    const resolved = resolve(path);
    return resolved.startsWith(this.root);
  }
}
