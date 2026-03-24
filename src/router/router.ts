import type { MessageEvent, PlatformSender } from "../platform/types.js";
import type { SessionManager } from "../session/manager.js";
import type { SessionQueue } from "../session/queue.js";
import type { Workspace } from "../workspace/workspace.js";
import type { ContextManager } from "../context/manager.js";
import type { MemoryExtractor } from "../memory/extractor.js";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { ask, askStreaming } from "../backend/index.js";
import { buildSystemPrompt, buildRecoverySystemPrompt } from "../claude/context-builder.js";
import { classifyError, ErrorType } from "../error/classifier.js";
import { emit } from "../webui/events.js";
import { handleCommand } from "./commands.js";
import { pickReactionEmoji } from "./sentiment.js";
import { parseClarification, buildClarificationCard } from "./clarification.js";
import { parseSpawnTasks } from "./task-spawner.js";
import { TaskRunner } from "../runner/task-runner.js";
import type { TaskDefinition } from "../runner/task-runner.js";

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

export interface RouterDeps {
  sessionManager: SessionManager;
  sessionQueue: SessionQueue;
  workspace: Workspace;
  contextManager?: ContextManager;
  memoryExtractor?: MemoryExtractor;
}

/** Minimum interval between Feishu message updates (ms). */
const STREAM_THROTTLE_MS = 1500;
/** Minimum character change before sending an update. */
const STREAM_MIN_CHARS = 300;

export function createRouter(deps: RouterDeps) {
  const { sessionManager, sessionQueue, workspace, contextManager, memoryExtractor } = deps;

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

    const session = sessionManager.getOrCreate(workspace.agentID, userID);

    // Track the most recent chat ID so the /api/reuse endpoint can send messages
    session.lastChatID = chatID;

    // Resolve workspace for the session's current agent (may differ from default after /switch-agent)
    const effectiveWorkspace = session.agentID !== workspace.agentID
      ? workspace.forAgent(session.agentID)
      : workspace;

    // Ensure user workspace exists
    const userDir = effectiveWorkspace.initUser(userID);

    // Check for slash commands (/feedback, /model, etc.)
    const cmdResult = await handleCommand({ event, sender, session, workspace: effectiveWorkspace });
    if (cmdResult.handled) {
      emit("command", { command: text.split(" ")[0], platform, userID });
      return;
    }

    // Write non-command Feishu messages to inbox so the CLI can poll for replies.
    // Placed after command handling so slash commands (/detach, /help, etc.) are excluded.
    if (session.cliWorkDir) {
      try {
        const inboxFile = effectiveWorkspace.inboxPath(userID);
        mkdirSync(dirname(inboxFile), { recursive: true });
        const entry = JSON.stringify({
          id: `msg-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
          ts: Date.now(),
          from: "feishu",
          text,
          chatID,
          messageID,
        });
        appendFileSync(inboxFile, entry + "\n", "utf-8");

        // Cap inbox at 1000 lines to prevent unbounded growth
        const MAX_INBOX_LINES = 1000;
        if (existsSync(inboxFile)) {
          const lines = readFileSync(inboxFile, "utf-8").split("\n").filter(Boolean);
          if (lines.length > MAX_INBOX_LINES) {
            writeFileSync(inboxFile, lines.slice(-MAX_INBOX_LINES).join("\n") + "\n", "utf-8");
          }
        }
      } catch (err) {
        log("warn", "Failed to write to inbox", { userID, error: String(err) });
      }
    }

    // If command returned rewritten text (e.g. /dev, /feedback prefix stripped),
    // use that as the actual prompt for the CLI request
    const promptText = cmdResult.rewrittenText ?? text;

    // Prepend attachment context to prompt if files/images were downloaded
    let fullPrompt = promptText;
    if (event.attachments && event.attachments.length > 0) {
      const attachInfo = event.attachments
        .map((a) => `[Attached ${a.type}: ${a.name} → ${a.path}]`)
        .join("\n");
      fullPrompt = `${attachInfo}\n\n${promptText}`;
    }

    try {
      const reply = await sessionQueue.enqueue(session.id, async () => {
        // Record user message
        session.addMessage("user", fullPrompt);

        // Summarize context if approaching token limits
        if (contextManager) {
          await contextManager.maybeSummarize(session).catch((err) => {
            log("warn", "Context summarization failed", { error: String(err) });
          });
        }

        // Build system context (SOUL + MEMORY) — conversation is managed by CLI session
        const systemPrompt = buildSystemPrompt(effectiveWorkspace, userID);

        emit("backend", { action: "ask", userID, model: session.model });

        // When attached to an external session, use its original cwd
        const effectiveWorkDir = session.cliWorkDir ?? userDir;
        const addDirs = session.cliWorkDir
          ? [effectiveWorkDir, userDir]
          : [userDir];

        try {
          const responseText = await handleStreamingResponse({
            prompt: fullPrompt,
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
          // Session locked by another process — retry with a fresh session ID
          if (err.sessionInUse) {
            const oldId = session.cliSessionId;
            session.cliSessionId = crypto.randomUUID();
            log("warn", "Session in use — retrying with new session ID", {
              userID,
              oldSessionId: oldId,
              newSessionId: session.cliSessionId,
            });

            // Replay recent history into system prompt so new session has context
            const recentHistory = session.getConversationText(10);
            const recoveryPrompt = buildRecoverySystemPrompt(effectiveWorkspace, userID, recentHistory);

            emit("backend", { action: "ask-session-recovery", userID, model: session.model });

            const responseText = await handleStreamingResponse({
              prompt: fullPrompt,
              systemPrompt: recoveryPrompt,
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
          }

          if (err.contextOverflow) {
            log("warn", "Context overflow — resetting CLI session", {
              userID,
              oldSessionId: session.cliSessionId,
              overflowCount: session.contextOverflowCount + 1,
            });

            session.resetCliSession();

            const recentHistory = session.getConversationText(10);
            const recoveryPrompt = buildRecoverySystemPrompt(effectiveWorkspace, userID, recentHistory);

            emit("backend", { action: "ask-recovery", userID, model: session.model });

            // Recovery uses buffered mode for reliability
            const result = await ask({
              prompt: fullPrompt,
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

      // --- Post-process: detect clarification requests ---
      const clarification = parseClarification(reply);
      if (clarification) {
        log("info", "Clarification requested by agent", {
          userID,
          type: clarification.type,
          question: clarification.question,
        });
        const card = buildClarificationCard(clarification, session.id);
        await sender.sendInteractiveCard(chatID, card, messageID);
        emit("clarification", { userID, type: clarification.type, question: clarification.question });
      }

      // --- Post-process: detect autonomous task spawning ---
      const spawnedTasks = parseSpawnTasks(reply);
      if (spawnedTasks) {
        log("info", "Agent requested task spawning", { userID, taskCount: spawnedTasks.length });

        const userDir = workspace.initUser(userID);
        const taskDefs: TaskDefinition[] = spawnedTasks.map((t, i) => ({
          id: `auto-${i + 1}`,
          description: t.description,
          prompt: t.description,
          workDir: session.cliWorkDir ?? userDir,
        }));

        const runner = new TaskRunner({ model: session.model || undefined });
        // Fire-and-forget: run tasks and inject results into next conversation turn
        runner.runParallel(taskDefs, sender, chatID, userID, chatType).then((results) => {
          const summary = results
            .map((r) => `[${r.status}] ${r.description}: ${r.result.slice(0, 500)}`)
            .join("\n\n");
          session.addMessage("user", `[Task Results]\n${summary}`);
          log("info", "Spawned task results injected", { userID, count: results.length });
        }).catch((err) => {
          log("warn", "Spawned task execution failed", { userID, error: String(err) });
        });

        emit("task-spawn", { userID, taskCount: spawnedTasks.length });
      }

      // Add sentiment-based reaction emoji
      const emoji = pickReactionEmoji(reply);
      sender.addReaction(messageID, emoji).catch(() => {});

      // Fire-and-forget: extract memory facts from conversation turn
      if (memoryExtractor) {
        memoryExtractor.extract(userID, fullPrompt, reply).catch((err) => {
          log("warn", "Memory extraction failed", { userID, error: String(err) });
        });
      }

      // Schedule session save to disk
      sessionManager.scheduleSave();

      log("info", "Sent reply", { platform, userID, replyLen: reply.length });
    } catch (err) {
      const classified = classifyError(err instanceof Error ? err : new Error(String(err)));
      log("error", "Failed to process message", {
        userID,
        errorType: classified.type,
        error: classified.message,
      });

      emit("error", { userID, errorType: classified.type, error: classified.message });

      // Don't send a duplicate error message if the streaming handler already showed it
      if (!(err as any)?.streamingHandled) {
        await sender.sendText(
          chatID,
          classified.userMessage,
          messageID,
        ).catch(() => {});
      }
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
    // and mark the error as handled so the outer catch doesn't send a duplicate
    if (replyMessageID && finalText) {
      await sender.updateMarkdown(
        replyMessageID,
        `${atPrefix}${finalText}\n\n_[Response interrupted]_`,
      ).catch(() => {});
      const handled = new Error((err as Error).message);
      (handled as any).streamingHandled = true;
      // Propagate contextOverflow / sessionInUse flags for outer recovery logic
      if ((err as any).contextOverflow) (handled as any).contextOverflow = true;
      if ((err as any).sessionInUse) (handled as any).sessionInUse = true;
      throw handled;
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
