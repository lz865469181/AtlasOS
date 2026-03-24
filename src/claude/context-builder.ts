import type { Workspace } from "../workspace/workspace.js";

/**
 * Build the system prompt context from SOUL + AGENTS + MEMORY.
 * Conversation history is managed natively by Claude CLI via --session-id.
 * This is passed to --append-system-prompt so it augments Claude Code's defaults.
 */
export function buildSystemPrompt(
  workspace: Workspace,
  userID: string,
): string {
  const soul = workspace.readSoul();
  const agents = workspace.readAgents();
  const memory = workspace.readUserMemory(userID);

  const parts: string[] = [];

  parts.push(`<identity>\n${soul}\n</identity>`);

  if (agents.trim()) {
    parts.push(`<agents>\n${agents}\n</agents>`);
  }

  if (memory.trim()) {
    parts.push(`<user-memory>\n${memory}\n</user-memory>`);
  }

  // Built-in interaction capabilities
  parts.push(`<capabilities>
## Clarification
When you need more information, are unsure about requirements, or want the user to choose between approaches, embed a clarification block in your response:

[CLARIFICATION_NEEDED]
type: missing_info | ambiguous_requirement | approach_choice | risk_confirmation | suggestion
question: Your question here
context: Optional context explaining why you need this (optional line)
options: Option A | Option B | Option C (optional line, separate with |)
[/CLARIFICATION_NEEDED]

The system will convert this into an interactive card with buttons. You may include normal text before or after the block.

## Parallel Task Spawning
When a task can be broken into independent sub-tasks that benefit from parallel execution, embed a task block:

[SPAWN_TASKS]
- "Sub-task 1 description — detailed enough to execute independently"
- "Sub-task 2 description — detailed enough to execute independently"
[/SPAWN_TASKS]

Each sub-task will be executed as an independent CLI process in parallel. Results will be provided to you in the next turn. Use this for research, multi-file analysis, or any work that can be parallelized. You may include normal text before or after the block.

## Image Analysis
When the user's message contains [Attached image: ...] or [Attached file: ...] markers, use the Read tool to open and analyze the file at the indicated path. For images, describe what you see and respond to the user's question about it.
</capabilities>`);

  return parts.join("\n\n");
}

/**
 * Build a recovery system prompt that includes recent conversation history.
 * Used when a CLI session is reset due to context overflow — replays the last N
 * messages so the new session has context.
 */
export function buildRecoverySystemPrompt(
  workspace: Workspace,
  userID: string,
  recentHistory: string,
): string {
  const base = buildSystemPrompt(workspace, userID);

  if (!recentHistory) return base;

  return `${base}\n\n<conversation-history-recovery>\nThe previous session was reset due to context limits. Here is the recent conversation for continuity:\n${recentHistory}\n</conversation-history-recovery>`;
}
