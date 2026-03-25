import { readFileSync, writeFileSync } from "node:fs";
import { log } from "./logger.js";

export interface MemoryConfig {
  maxFileSizeBytes: number;
  summarizeThreshold: number;
  expireDays: number;
}

const DEFAULT_CONFIG: MemoryConfig = {
  maxFileSizeBytes: 50 * 1024,
  summarizeThreshold: 20,
  expireDays: 30,
};

export class MemoryManager {
  private config: MemoryConfig;

  constructor(config?: Partial<MemoryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Append extracted facts to a memory file. */
  appendFacts(memoryPath: string, facts: Array<{ fact: string; category: string }>): void {
    if (facts.length === 0) return;

    let existing = "";
    try { existing = readFileSync(memoryPath, "utf-8"); } catch { /* file may not exist */ }

    const date = new Date().toISOString().split("T")[0];
    const newEntries = facts
      .filter((f) => f.fact && f.category)
      .map((f) => `- [${f.category}] ${f.fact}`)
      .join("\n");

    if (!newEntries) return;

    const append = `\n## Extracted ${date}\n${newEntries}\n`;
    writeFileSync(memoryPath, existing + append, "utf-8");
    log("info", "Memory facts appended", { path: memoryPath, count: facts.length });
  }

  /** Check if a memory file needs compaction. */
  needsCompaction(memoryPath: string): boolean {
    try {
      const { size } = require("node:fs").statSync(memoryPath);
      return size >= this.config.maxFileSizeBytes;
    } catch {
      return false;
    }
  }
}
