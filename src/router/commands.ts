import type { MessageEvent, PlatformSender } from "../platform/types.js";
import type { Session } from "../session/session.js";
import { AVAILABLE_MODELS } from "../session/session.js";
import { buildSystemPrompt } from "../claude/context-builder.js";
import type { Workspace } from "../workspace/workspace.js";
import { modelSelectionCard } from "../platform/feishu/cards.js";
import { spawn } from "node:child_process";
import { getConfig } from "../config.js";
import { spawnDevAgent } from "./dev-agent.js";

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

export interface CommandContext {
  event: MessageEvent;
  sender: PlatformSender;
  session: Session;
  workspace: Workspace;
}

export interface CommandResult {
  /** true = command was handled, don't pass to Claude */
  handled: boolean;
}

/** Short alias → full model ID mapping. */
const MODEL_ALIASES: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
};

/**
 * Parse and handle slash commands. Returns { handled: true } if the message
 * was a command and has been fully processed.
 */
export async function handleCommand(ctx: CommandContext): Promise<CommandResult> {
  const text = ctx.event.text.trim();

  // /model [name] — show card or switch model
  if (text === "/model" || text.startsWith("/model ")) {
    const arg = text.slice("/model".length).trim();
    await handleModelCommand(ctx, arg);
    return { handled: true };
  }

  // /feedback <content> — spawn background analysis subprocess
  if (text.startsWith("/feedback")) {
    const feedback = text.slice("/feedback".length).trim();
    await handleFeedbackCommand(ctx, feedback);
    return { handled: true };
  }

  // /dev [--repo <path>] <task> — spawn autonomous dev agent
  if (text.startsWith("/dev")) {
    const arg = text.slice("/dev".length).trim();
    await handleDevCommand(ctx, arg);
    return { handled: true };
  }

  return { handled: false };
}

/**
 * /model — Show interactive model selection card.
 * /model <name> — Switch model directly (e.g., /model haiku, /model sonnet, /model opus).
 */
async function handleModelCommand(ctx: CommandContext, arg: string): Promise<void> {
  const { event, sender, session } = ctx;
  const { chatID, messageID, chatType, userID } = event;
  const atPrefix = chatType === "group" ? `<at id=${userID}></at>\n` : "";

  // If user specified a model name, switch directly
  if (arg) {
    const modelId = MODEL_ALIASES[arg.toLowerCase()] ?? arg;

    if (!AVAILABLE_MODELS[modelId]) {
      const available = Object.entries(MODEL_ALIASES)
        .map(([alias, id]) => `  /${alias} → ${AVAILABLE_MODELS[id]}`)
        .join("\n");
      await sender.sendText(
        chatID,
        `Unknown model: "${arg}"\n\nAvailable models:\n${available}`,
        messageID,
      );
      return;
    }

    session.model = modelId;
    log("info", "User switched model via command", { userID, model: modelId });

    await sender.sendMarkdown(
      chatID,
      `${atPrefix}Model switched to: **${AVAILABLE_MODELS[modelId]}**\n\`${modelId}\``,
      messageID,
    );
    return;
  }

  // No arg: show interactive card
  const currentModel = session.model;
  const card = modelSelectionCard(currentModel);

  try {
    await sender.sendInteractiveCard(chatID, card, messageID);
  } catch (err) {
    log("error", "Failed to send model selection card", { error: String(err) });
    // Fallback: send as text
    const lines = Object.entries(AVAILABLE_MODELS).map(([id, label]) => {
      const alias = Object.entries(MODEL_ALIASES).find(([, v]) => v === id)?.[0] ?? "";
      const current = id === currentModel ? " (current)" : "";
      return `- **${label}**${current}: \`/model ${alias}\``;
    });
    await sender.sendMarkdown(
      chatID,
      `${atPrefix}**Select Model**\n\nCurrent: **${AVAILABLE_MODELS[currentModel] ?? currentModel}**\n\n${lines.join("\n")}`,
      messageID,
    );
  }
}

/**
 * /feedback <content> — Spawn a background subprocess to analyze the feedback
 * and generate optimization suggestions. Reply immediately to the user, then
 * send the analysis result when done.
 */
async function handleFeedbackCommand(ctx: CommandContext, feedback: string): Promise<void> {
  const { event, sender, session, workspace } = ctx;
  const { chatID, messageID, userID, chatType } = event;

  if (!feedback) {
    await sender.sendText(chatID, "Usage: /feedback <your feedback content>", messageID);
    return;
  }

  // Acknowledge immediately
  const atPrefix = chatType === "group" ? `<at id=${userID}></at>\n` : "";
  await sender.sendMarkdown(
    chatID,
    `${atPrefix}Feedback received. Spawning background analysis...`,
    messageID,
  );

  // Spawn background analysis subprocess
  const config = getConfig();
  const cliPath = config.agent.claude_cli_path;
  const userDir = workspace.initUser(userID);

  const analysisPrompt = [
    "You are a product optimization analyst. A user has provided the following feedback.",
    "Analyze it thoroughly and provide:",
    "1. Key issue identification",
    "2. Root cause analysis",
    "3. Concrete optimization suggestions with priority (High/Medium/Low)",
    "4. Implementation recommendations",
    "",
    `User feedback: ${feedback}`,
  ].join("\n");

  const systemPrompt = buildSystemPrompt(workspace, userID, session);

  const args = [
    "-p", analysisPrompt,
    "--output-format", "json",
    "--no-session-persistence",
    "--model", "claude-sonnet-4-6", // Use Sonnet for deeper analysis
  ];

  if (systemPrompt) {
    args.push("--append-system-prompt", systemPrompt);
  }
  args.push("--add-dir", userDir);

  log("info", "Spawning feedback analysis subprocess", { userID, feedbackLen: feedback.length });

  const child = spawn(cliPath, args, {
    cwd: userDir,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  child.stdin?.end();

  child.on("close", async (code) => {
    try {
      if (code !== 0) {
        log("error", "Feedback analysis subprocess failed", { code, stderr });
        await sender.sendMarkdown(
          chatID,
          `${atPrefix}Feedback analysis encountered an error. Please try again later.`,
        );
        return;
      }

      let analysisResult: string;
      try {
        const parsed = JSON.parse(stdout.trim());
        analysisResult = parsed.result || stdout.trim();
      } catch {
        analysisResult = stdout.trim();
      }

      if (!analysisResult) {
        analysisResult = "(No analysis result)";
      }

      // Record in session
      session.addMessage("user", `/feedback ${feedback}`);
      session.addMessage("assistant", analysisResult);

      // Send the analysis back
      await sender.sendMarkdown(
        chatID,
        `${atPrefix}**Feedback Analysis Complete**\n\n${analysisResult}`,
      );

      log("info", "Feedback analysis completed", { userID, resultLen: analysisResult.length });
    } catch (err) {
      log("error", "Failed to send feedback analysis result", { error: String(err) });
    }
  });

  child.on("error", async (err) => {
    log("error", "Feedback analysis subprocess error", { error: String(err) });
    await sender.sendMarkdown(
      chatID,
      `${atPrefix}Failed to start feedback analysis. Please try again.`,
    ).catch(() => {});
  });
}

/**
 * /dev [--repo <path>] <task> — Spawn an autonomous dev agent subprocess that
 * plans, implements, tests (TDD), and commits code changes.
 */
async function handleDevCommand(ctx: CommandContext, arg: string): Promise<void> {
  const { event, sender, workspace } = ctx;
  const { chatID, messageID, userID, chatType } = event;
  const atPrefix = chatType === "group" ? `<at id=${userID}></at>\n` : "";

  if (!arg) {
    await sender.sendMarkdown(
      chatID,
      `${atPrefix}**Usage:**\n\`/dev <task description>\`\n\`/dev --repo /path/to/project <task description>\``,
      messageID,
    );
    return;
  }

  // Parse optional --repo flag
  let workDir: string;
  let task: string;

  const repoMatch = arg.match(/^--repo\s+(\S+)\s+([\s\S]+)$/);
  if (repoMatch) {
    workDir = repoMatch[1]!;
    task = repoMatch[2]!.trim();
  } else {
    // Default: use the project root directory
    workDir = process.cwd();
    task = arg;
  }

  // Acknowledge immediately
  await sender.sendMarkdown(
    chatID,
    `${atPrefix}**Dev Agent Starting**\n\nTask: ${task}\nRepo: \`${workDir}\``,
    messageID,
  );

  // Spawn the dev agent
  spawnDevAgent({
    task,
    workDir,
    chatID,
    userID,
    chatType,
    sender,
    messageID,
  });
}
