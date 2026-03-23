import type { MessageEvent, PlatformSender } from "../platform/types.js";
import type { SessionManager } from "../session/manager.js";
import type { SessionQueue } from "../session/queue.js";
import type { Workspace } from "../workspace/workspace.js";
import type { ContextManager } from "../context/manager.js";
import { ask, askStreaming } from "../backend/index.js";
import { buildSystemPrompt, buildRecoverySystemPrompt } from "../claude/context-builder.js";
import { classifyError, ErrorType } from "../error/classifier.js";
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
  contextManager?: ContextManager;
}

/** Minimum interval between Feishu message updates (ms). */
const STREAM_THROTTLE_MS = 1500;
/** Minimum character change before sending an update. */
const STREAM_MIN_CHARS = 300;

export function createRouter(deps: RouterDeps) {
  const { sessionManager, sessionQueue, workspace, contextManager } = deps;

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
      emit("command", { command: text.split(" ")[0], platform, userID });
      return;
    }

    // If command returned rewritten text (e.g. /dev, /feedback prefix stripped),
    // use that as the actual prompt for the CLI request
    const promptText = cmdResult.rewrittenText ?? text;

    try {
      const reply = await sessionQueue.enqueue(session.id, async () => {
        // Record user message
        session.addMessage("user", promptText);

        // Summarize context if approaching token limits
        if (contextManager) {
          await contextManager.maybeSummarize(session).catch((err) => {
            log("warn", "Context summarization failed", { error: String(err) });
          });
        }

        // Build system context (SOUL + MEMORY) — conversation is managed by CLI session
        const systemPrompt = buildSystemPrompt(workspace, userID);

        emit("backend", { action: "ask", userID, model: session.model });

        // When attached to an external session, use its original cwd
        const effectiveWorkDir = session.cliWorkDir ?? userDir;
        const addDirs = session.cliWorkDir
          ? [effectiveWorkDir, userDir]
          : [userDir];

        try {
          const responseText = await handleStreamingResponse({
            prompt: promptText,
            systemPrompt,
            workDir: effectiveWorkDir,
            addDirs,
            sessionId: session.cliSessionId,
            model: session.model,
            sender,
            chatID,
            chatType,
            userID,
            messageID,
          });

          session.addMessage("assistant", responseText);
          return responseText;
        } catch (err: any) {
          if (err.contextOverflow) {
            log("warn", "Context overflow — resetting CLI session", {
              userID,
              oldSessionId: session.cliSessionId,
              overflowCount: session.contextOverflowCount + 1,
            });

            session.resetCliSession();

            const recentHistory = session.getConversationText(10);
            const recoveryPrompt = buildRecoverySystemPrompt(workspace, userID, recentHistory);

            emit("backend", { action: "ask-recovery", userID, model: session.model });

            // Recovery uses buffered mode for reliability
            const result = await ask({
              prompt: promptText,
              systemPrompt: recoveryPrompt,
              workDir: userDir,
              addDirs: [userDir],
              sessionId: session.cliSessionId,
            });

            const responseText = result.result || "(no response)";
            session.addMessage("assistant", responseText);
            return responseText;
          }
          throw err;
        }
      });

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

/**
 * Handle a streaming response from the backend.
 * Sends an initial message to Feishu, then updates it as chunks arrive.
 * Returns the final complete response text.
 */
async function handleStreamingResponse(options: {
  prompt: string;
  systemPrompt: string;
  workDir: string;
  addDirs: string[];
  sessionId: string;
  model?: string;
  sender: PlatformSender;
  chatID: string;
  chatType: "p2p" | "group";
  userID: string;
  messageID: string;
}): Promise<string> {
  const { sender, chatID, chatType, userID, messageID, ...askOptions } = options;
  const atPrefix = chatType === "group" ? `<at id=${userID}></at>\n` : "";

  let replyMessageID: string | undefined;
  let lastUpdateTime = 0;
  let lastUpdateLen = 0;
  let finalText = "";

  try {
    for await (const chunk of askStreaming(askOptions)) {
      if (chunk.type === "assistant_text") {
        const text = chunk.text;
        const now = Date.now();
        const timeSinceUpdate = now - lastUpdateTime;
        const charsSinceUpdate = text.length - lastUpdateLen;

        // Throttle: update only when enough time AND chars have accumulated
        if (timeSinceUpdate >= STREAM_THROTTLE_MS && charsSinceUpdate >= STREAM_MIN_CHARS) {
          const displayText = `${atPrefix}${text}\n\n_...typing_`;

          if (!replyMessageID) {
            // First chunk: create a new reply message
            const msgId = await sender.sendMarkdown(chatID, displayText, messageID);
            replyMessageID = typeof msgId === "string" ? msgId : undefined;
          } else {
            // Subsequent chunks: update existing message
            await sender.updateMarkdown(replyMessageID, displayText);
          }

          lastUpdateTime = now;
          lastUpdateLen = text.length;
        }
      } else if (chunk.type === "result") {
        finalText = chunk.text;
      }
    }
  } catch (err) {
    // If we already sent a partial message, update it with error indicator
    if (replyMessageID && finalText) {
      await sender.updateMarkdown(
        replyMessageID,
        `${atPrefix}${finalText}\n\n_[Response interrupted]_`,
      ).catch(() => {});
    }
    throw err;
  }

  if (!finalText) {
    finalText = "(no response)";
  }

  // Send or update the final complete message (remove "...typing" indicator)
  const finalDisplay = `${atPrefix}${finalText}`;
  if (!replyMessageID) {
    await sender.sendMarkdown(chatID, finalDisplay, messageID);
  } else {
    await sender.updateMarkdown(replyMessageID, finalDisplay);
  }

  return finalText;
}
