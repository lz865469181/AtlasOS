import { writeFileSync, renameSync } from "node:fs";

/**
 * Async line iterator for a ReadableStream (shared across all agent backends).
 * Replaces 4 duplicated copies in claude/client.ts, backend/codex.ts, backend/gemini.ts, backend/cursor.ts.
 */
export async function* createLineIterator(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield line;
    }
  }
  if (buffer.trim()) yield buffer;
}

/**
 * Atomic file write: write to temp file, then rename.
 */
export function atomicWriteFile(filePath: string, data: string): void {
  const tmp = filePath + ".tmp." + process.pid;
  writeFileSync(tmp, data, "utf-8");
  renameSync(tmp, filePath);
}

/**
 * Estimate token count from text (~3.5 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
