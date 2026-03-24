import { readFileSync, writeFileSync, statSync } from "node:fs";
import { ask } from "../backend/index.js";
import type { Workspace } from "../workspace/workspace.js";

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

export interface MemoryConfig {
  /** Model for fact extraction (cheap/fast). */
  model: string;
  /** Max file size in bytes before compaction is triggered. */
  maxFileSizeBytes: number;
  /** Max entries before summarization is triggered. */
  summarizeThreshold: number;
  /** Days after which overridden entries expire. */
  expireDays: number;
}

const DEFAULT_CONFIG: MemoryConfig = {
  model: "",
  maxFileSizeBytes: 50 * 1024, // 50KB
  summarizeThreshold: 20,
  expireDays: 30,
};

const EXTRACTION_PROMPT = `You are a memory extraction assistant. Given a conversation turn between a user and an AI assistant, extract 0-3 facts worth remembering long-term about the user.

Focus on:
- User preferences (tools, languages, workflows)
- Key decisions or choices made
- Important context (projects, team, role)
- Technical skills or expertise

Output ONLY a JSON array of objects with "fact" and "category" fields.
Categories: "preference", "decision", "context", "skill"
If nothing is noteworthy, output an empty array [].

Example output:
[{"fact": "Prefers Go over Python for backend work", "category": "preference"}]`;

export class MemoryExtractor {
  private workspace: Workspace;
  private config: MemoryConfig;

  constructor(workspace: Workspace, config?: Partial<MemoryConfig>) {
    this.workspace = workspace;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Extract facts from a conversation turn and append to MEMORY.md.
   * Async, fire-and-forget — never blocks the main response path.
   */
  async extract(userID: string, userMessage: string, assistantReply: string): Promise<void> {
    try {
      const turnText = `User: ${userMessage.slice(0, 1000)}\nAssistant: ${assistantReply.slice(0, 1000)}`;

      const result = await ask({
        prompt: `${EXTRACTION_PROMPT}\n\nConversation turn:\n${turnText}`,
        model: this.config.model || undefined,
        maxRetries: 1,
      });

      const responseText = result.result?.trim();
      if (!responseText) return;

      // Parse JSON array from response
      let facts: Array<{ fact: string; category: string }>;
      try {
        // Handle markdown code blocks wrapping
        const jsonStr = responseText.replace(/^```json?\s*\n?|\n?```$/g, "").trim();
        facts = JSON.parse(jsonStr);
      } catch {
        return; // unparseable response, skip
      }

      if (!Array.isArray(facts) || facts.length === 0) return;

      // Append to MEMORY.md
      const memoryPath = this.workspace.userMemoryPath(userID);
      let existing = "";
      try {
        existing = readFileSync(memoryPath, "utf-8");
      } catch { /* file may not exist */ }

      const date = new Date().toISOString().split("T")[0];
      const newEntries = facts
        .filter((f) => f.fact && f.category)
        .map((f) => `- [${f.category}] ${f.fact}`)
        .join("\n");

      if (!newEntries) return;

      const append = `\n## Extracted ${date}\n${newEntries}\n`;
      writeFileSync(memoryPath, existing + append, "utf-8");

      log("info", "Memory facts extracted", { userID, count: facts.length });
    } catch (err) {
      log("warn", "Memory extraction failed", { userID, error: String(err) });
    }
  }

  /**
   * Compact MEMORY.md — merge duplicates, summarize if too many entries.
   * Called on a schedule (e.g., daily).
   */
  async compact(userID: string): Promise<void> {
    const memoryPath = this.workspace.userMemoryPath(userID);

    let content: string;
    try {
      content = readFileSync(memoryPath, "utf-8");
    } catch {
      return; // no memory file
    }

    // Check file size
    try {
      const stats = statSync(memoryPath);
      if (stats.size < this.config.maxFileSizeBytes) return;
    } catch {
      return;
    }

    log("info", "Compacting memory", { userID, contentLen: content.length });

    try {
      const result = await ask({
        prompt: `You are a memory compaction assistant. Given a user's long-term memory file, merge duplicate entries, remove outdated information, and produce a clean, deduplicated version. Keep the same markdown format with category tags [preference], [decision], [context], [skill]. Group by category.\n\nCurrent memory:\n${content}`,
        model: this.config.model || undefined,
        maxRetries: 1,
      });

      const compacted = result.result?.trim();
      if (compacted && compacted.length > 50) {
        writeFileSync(memoryPath, `# Long-term Memory\n\n${compacted}\n`, "utf-8");
        log("info", "Memory compacted", { userID, beforeLen: content.length, afterLen: compacted.length });
      }
    } catch (err) {
      log("warn", "Memory compaction failed", { userID, error: String(err) });
    }
  }
}
