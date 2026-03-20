import type { MessageEvent, PlatformSender } from "../platform/types.js";
import type { SessionManager } from "../session/manager.js";
import type { SessionQueue } from "../session/queue.js";
import type { Workspace } from "../workspace/workspace.js";
import { ask } from "../claude/client.js";
import { buildSystemPrompt } from "../claude/context-builder.js";
import { emit } from "../webui/events.js";
import { handleCommand } from "./commands.js";
import { pickReactionEmoji } from "./sentiment.js";

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

export interface RouterDeps {
  sessionManager: SessionManager;
  sessionQueue: SessionQueue;
  workspace: Workspace;
}

export function createRouter(deps: RouterDeps) {
  const { sessionManager, sessionQueue, workspace } = deps;

  return async function handle(
    event: MessageEvent,
    sender: PlatformSender,
  ): Promise<void> {
    const { userID, chatID, chatType, text, messageID, platform } = event;

    emit("message", {
      direction: "IN",
      platform,
      userID,
      text: text.slice(0, 200),
    });

    log("info", "Received message", { platform, userID, chatID, textLen: text.length });

    // Add "thinking" reaction while processing
    sender.addReaction(messageID, "THINKING").catch(() => {});

    const agentID = workspace.agentID;
    const session = sessionManager.getOrCreate(agentID, userID);

    // Ensure user workspace exists
    const userDir = workspace.initUser(userID);

    // Check for slash commands (/feedback, /model, etc.)
    const cmdResult = await handleCommand({ event, sender, session, workspace });
    if (cmdResult.handled) {
      sender.addReaction(messageID, "THUMBSUP").catch(() => {});
      return;
    }

    try {
      const reply = await sessionQueue.enqueue(session.id, async () => {
        // Record user message
        session.addMessage("user", text);

        // Build system context (SOUL + MEMORY + history) and user prompt separately
        const systemPrompt = buildSystemPrompt(workspace, userID, session);

        // Call Claude CLI with session's model preference
        const result = await ask({
          prompt: text,
          systemPrompt,
          workDir: userDir,
          addDirs: [userDir],
          model: session.model,
        });

        const responseText = result.result || "(no response)";

        // Record assistant reply
        session.addMessage("assistant", responseText);

        return responseText;
      });

      // In group chats, prepend @mention to notify the sender
      const replyContent = chatType === "group"
        ? `<at id=${userID}></at>\n${reply}`
        : reply;

      // Send reply
      await sender.sendMarkdown(chatID, replyContent, messageID);

      emit("message", {
        direction: "OUT",
        platform,
        userID,
        text: reply.slice(0, 200),
      });

      // Add sentiment-based reaction emoji
      const emoji = pickReactionEmoji(reply);
      sender.addReaction(messageID, emoji).catch(() => {});

      log("info", "Sent reply", { platform, userID, replyLen: reply.length });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log("error", "Failed to process message", { userID, error: errMsg });

      emit("error", { userID, error: errMsg });

      await sender.sendText(
        chatID,
        `Sorry, I encountered an error processing your message. Please try again.`,
        messageID,
      ).catch(() => {});
    }
  };
}
