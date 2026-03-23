import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface LocalSession {
  sessionId: string;
  cwd: string;
  mtime: number;
  gitBranch?: string;
  entrypoint?: string;
}

/** Root directory for Claude CLI project sessions. */
function projectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

/**
 * Search all project directories for a session JSONL file matching the given UUID.
 * Returns the full path to the `.jsonl` file, or null if not found.
 */
export function findSessionFile(sessionId: string): string | null {
  const root = projectsDir();
  if (!existsSync(root)) return null;

  for (const dir of readdirSync(root)) {
    const jsonlPath = join(root, dir, `${sessionId}.jsonl`);
    if (existsSync(jsonlPath)) return jsonlPath;
  }
  return null;
}

/**
 * Extract metadata (cwd, gitBranch, entrypoint) from a session JSONL file
 * by scanning the first lines for a progress entry containing these fields.
 */
export function extractSessionMeta(
  jsonlPath: string,
): { cwd: string; gitBranch?: string; entrypoint?: string } | null {
  try {
    const content = readFileSync(jsonlPath, "utf-8");
    const lines = content.split("\n").slice(0, 20); // scan first 20 lines
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.cwd) {
          return {
            cwd: entry.cwd,
            gitBranch: entry.gitBranch,
            entrypoint: entry.entrypoint,
          };
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file read error
  }
  return null;
}

/**
 * List recent local Claude CLI sessions across all projects,
 * sorted by modification time (most recent first).
 */
export function listRecentSessions(limit = 10): LocalSession[] {
  const root = projectsDir();
  if (!existsSync(root)) return [];

  const sessions: LocalSession[] = [];

  for (const dir of readdirSync(root)) {
    const dirPath = join(root, dir);
    try {
      if (!statSync(dirPath).isDirectory()) continue;
    } catch {
      continue;
    }

    for (const file of readdirSync(dirPath)) {
      if (!file.endsWith(".jsonl")) continue;
      const sessionId = file.replace(".jsonl", "");
      // basic UUID format check
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
        continue;
      }

      const fullPath = join(dirPath, file);
      try {
        const mtime = statSync(fullPath).mtimeMs;
        const meta = extractSessionMeta(fullPath);
        if (meta) {
          sessions.push({
            sessionId,
            cwd: meta.cwd,
            mtime,
            gitBranch: meta.gitBranch,
            entrypoint: meta.entrypoint,
          });
        }
      } catch {
        // skip inaccessible files
      }
    }
  }

  sessions.sort((a, b) => b.mtime - a.mtime);
  return sessions.slice(0, limit);
}
