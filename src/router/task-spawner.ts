/**
 * Autonomous task spawning — detects when Claude embeds [SPAWN_TASKS]
 * markers in its response, extracts task definitions, and delegates
 * to the TaskRunner for parallel execution.
 */

const SPAWN_TASKS_REGEX = /\[SPAWN_TASKS\]\s*([\s\S]*?)\s*\[\/SPAWN_TASKS\]/;

export interface SpawnedTask {
  description: string;
}

/**
 * Parse a [SPAWN_TASKS] block from Claude's response.
 * Returns null if the response doesn't contain a task spawn request.
 */
export function parseSpawnTasks(text: string): SpawnedTask[] | null {
  const match = SPAWN_TASKS_REGEX.exec(text);
  if (!match) return null;

  const block = match[1];
  const tasks: SpawnedTask[] = [];

  for (const line of block.split("\n")) {
    // Match lines like: - "Research API patterns" or - Research API patterns
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) continue;

    // Strip leading dash/number/bullet
    const cleaned = trimmed.replace(/^[-*•]\s*/, "").replace(/^\d+\.\s*/, "");
    // Strip surrounding quotes
    const unquoted = cleaned.replace(/^["'`]|["'`]$/g, "").trim();
    if (unquoted) {
      tasks.push({ description: unquoted });
    }
  }

  return tasks.length > 0 ? tasks : null;
}

/**
 * Strip the [SPAWN_TASKS] block from Claude's response,
 * returning only the text outside the markers.
 */
export function stripSpawnTasks(text: string): string {
  return text.replace(SPAWN_TASKS_REGEX, "").trim();
}
