import type { Workspace } from "../workspace/workspace.js";
import type { Session } from "../session/session.js";

/**
 * Build the system prompt context from SOUL + AGENTS + MEMORY + conversation history.
 * This is passed to --append-system-prompt so it augments Claude Code's defaults.
 * The user's actual message is passed separately to -p.
 */
export function buildSystemPrompt(
  workspace: Workspace,
  userID: string,
  session: Session,
): string {
  const soul = workspace.readSoul();
  const agents = workspace.readAgents();
  const memory = workspace.readUserMemory(userID);
  const history = session.getConversationText();

  const parts: string[] = [];

  parts.push(`<identity>\n${soul}\n</identity>`);

  if (agents.trim()) {
    parts.push(`<agents>\n${agents}\n</agents>`);
  }

  if (memory.trim()) {
    parts.push(`<user-memory>\n${memory}\n</user-memory>`);
  }

  if (history) {
    parts.push(`<conversation-history>\n${history}\n</conversation-history>`);
  }

  return parts.join("\n\n");
}
