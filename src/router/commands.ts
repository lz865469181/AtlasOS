import type { MessageEvent, PlatformSender } from "../platform/types.js";
import type { Session } from "../session/session.js";
import { BACKEND_MODELS } from "../session/session.js";
import { getConfig } from "../config.js";
import { buildSystemPrompt } from "../claude/context-builder.js";
import type { Workspace } from "../workspace/workspace.js";
import { modelSelectionCard } from "../platform/feishu/cards.js";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { getCliPath, buildSpawnArgs, getStdinPrompt } from "../backend/index.js";
import { emit } from "../webui/events.js";
import { spawnDevAgent } from "./dev-agent.js";
import { TaskRunner } from "../runner/task-runner.js";
import type { TaskDefinition } from "../runner/task-runner.js";
import { findSessionFile, extractSessionMeta, listRecentSessions } from "../claude/sessions.js";

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
  /** If set, the router should use this text instead of the original message */
  rewrittenText?: string;
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

  // /help — show all available commands
  if (text === "/help") {
    await handleHelpCommand(ctx);
    return { handled: true };
  }

  // /model [name] — show card or switch model
  if (text === "/model" || text.startsWith("/model ")) {
    const arg = text.slice("/model".length).trim();
    await handleModelCommand(ctx, arg);
    return { handled: true };
  }

  // /feedback <content> — spawn background analysis for the feedback
  if (text.startsWith("/feedback")) {
    const content = text.slice("/feedback".length).trim();
    await handleFeedbackCommand(ctx, content);
    return { handled: true };
  }

  // /dev <task> — spawn autonomous dev agent for the task
  if (text.startsWith("/dev")) {
    const content = text.slice("/dev".length).trim();
    await handleDevCommand(ctx, content);
    return { handled: true };
  }

  // /run "task1" "task2" ... — run multiple tasks in parallel
  if (text.startsWith("/run")) {
    const content = text.slice("/run".length).trim();
    await handleRunCommand(ctx, content);
    return { handled: true };
  }

  // /sessions — list recent local Claude CLI sessions
  if (text === "/sessions") {
    await handleSessionsCommand(ctx);
    return { handled: true };
  }

  // /resume <session-id> — attach to a local CLI session
  if (text === "/resume" || text.startsWith("/resume ")) {
    const arg = text.slice("/resume".length).trim();
    await handleResumeCommand(ctx, arg);
    return { handled: true };
  }

  // /detach — detach from external session, return to normal
  if (text === "/detach") {
    await handleDetachCommand(ctx);
    return { handled: true };
  }

  // /create-agent <name> <description> — create a new agent persona
  if (text.startsWith("/create-agent")) {
    const content = text.slice("/create-agent".length).trim();
    await handleCreateAgentCommand(ctx, content);
    return { handled: true };
  }

  // /switch-agent <name> — switch to a different agent persona
  if (text.startsWith("/switch-agent")) {
    const content = text.slice("/switch-agent".length).trim();
    await handleSwitchAgentCommand(ctx, content);
    return { handled: true };
  }

  // /list-agents — list all available agents
  if (text === "/list-agents" || text === "/agents") {
    await handleListAgentsCommand(ctx);
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
  const backend = getConfig().agent.backend ?? "claude";
  const models = BACKEND_MODELS[backend];

  // If user specified a model name, switch directly
  if (arg) {
    const modelId = MODEL_ALIASES[arg.toLowerCase()] ?? arg;

    if (!models[modelId]) {
      const available = Object.entries(MODEL_ALIASES)
        .map(([alias, id]) => `  /${alias} → ${models[id]}`)
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
    emit("command", { command: "/model", userID, model: modelId });

    await sender.sendMarkdown(
      chatID,
      `${atPrefix}Model switched to: **${models[modelId]}**\n\`${modelId}\``,
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
    const lines = Object.entries(models).map(([id, label]) => {
      const alias = Object.entries(MODEL_ALIASES).find(([, v]) => v === id)?.[0] ?? "";
      const current = id === currentModel ? " (current)" : "";
      return `- **${label}**${current}: \`/model ${alias}\``;
    });
    await sender.sendMarkdown(
      chatID,
      `${atPrefix}**Select Model**\n\nCurrent: **${models[currentModel] ?? currentModel}**\n\n${lines.join("\n")}`,
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

  // Instant emoji reaction (fire-and-forget), then continue processing
  sender.addReaction(messageID, "THUMBSUP").catch(() => {});

  const atPrefix = chatType === "group" ? `<at id=${userID}></at>\n` : "";
  await sender.sendMarkdown(
    chatID,
    `${atPrefix}Feedback received. Spawning background analysis...`,
    messageID,
  );

  // Spawn background analysis subprocess
  const cliPath = getCliPath();
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

  const systemPrompt = buildSystemPrompt(workspace, userID);

  const args = buildSpawnArgs({
    prompt: analysisPrompt,
    outputFormat: "json",
    systemPrompt: systemPrompt || undefined,
    addDirs: [userDir],
  });

  log("info", "Spawning feedback analysis subprocess", { userID, feedbackLen: feedback.length });
  emit("feedback", { status: "started", userID, feedbackLen: feedback.length });

  const child = spawn(cliPath, args, {
    cwd: userDir,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  // Write prompt to stdin (avoids command-line length limits on Windows)
  const stdinPrompt = getStdinPrompt({ prompt: analysisPrompt, systemPrompt: systemPrompt || undefined });
  child.stdin?.write(stdinPrompt);
  child.stdin?.end();

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

  child.on("close", async (code) => {
    try {
      if (code !== 0) {
        log("error", "Feedback analysis subprocess failed", { code, stderr });
        emit("error", { source: "feedback", userID, error: stderr.slice(0, 200) });
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
      emit("feedback", { status: "completed", userID, resultLen: analysisResult.length });
    } catch (err) {
      log("error", "Failed to send feedback analysis result", { error: String(err) });
      emit("error", { source: "feedback", userID, error: String(err) });
    }
  });

  child.on("error", async (err) => {
    log("error", "Feedback analysis subprocess error", { error: String(err) });
    emit("error", { source: "feedback", userID, error: String(err) });
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
  const { event, sender, session, workspace } = ctx;
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

  // Instant emoji reaction (fire-and-forget), then continue processing
  sender.addReaction(messageID, "ONIT").catch(() => {});

  // Parse optional --repo flag
  let workDir: string;
  let task: string;

  const repoMatch = arg.match(/^--repo\s+(\S+)\s+([\s\S]+)$/);
  if (repoMatch) {
    const requestedDir = resolve(repoMatch[1]!);
    const allowedRoot = resolve(process.cwd());
    if (!requestedDir.startsWith(allowedRoot)) {
      await sender.sendMarkdown(
        chatID,
        `${atPrefix}**Error**: The --repo path must be within the project root (\`${allowedRoot}\`).`,
        messageID,
      );
      return;
    }
    workDir = requestedDir;
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
  emit("dev-agent", { status: "started", userID, task: task.slice(0, 200), workDir });
  spawnDevAgent({
    task,
    workDir,
    chatID,
    userID,
    chatType,
    sender,
    messageID,
    model: session.model,
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /run "task1" "task2" ... — Run multiple tasks in parallel via TaskRunner.
 * Tasks can be quoted strings or newline-separated lines.
 */
async function handleRunCommand(ctx: CommandContext, arg: string): Promise<void> {
  const { event, sender, workspace } = ctx;
  const { chatID, messageID, userID, chatType } = event;
  const atPrefix = chatType === "group" ? `<at id=${userID}></at>\n` : "";

  if (!arg) {
    await sender.sendMarkdown(
      chatID,
      `${atPrefix}**Usage:**\n\`/run "research topic A" "research topic B" "summarize findings"\`\n\nOr one task per line:\n\`/run\nanalyze module A\nanalyze module B\ncompare results\``,
      messageID,
    );
    return;
  }

  // Parse tasks: either quoted strings or newline-separated
  const tasks = parseTaskList(arg);

  if (tasks.length === 0) {
    await sender.sendText(chatID, "No tasks parsed. Provide quoted strings or one task per line.", messageID);
    return;
  }

  if (tasks.length === 1) {
    await sender.sendText(chatID, "Only 1 task provided — use normal chat for single tasks. /run is for parallel execution.", messageID);
    return;
  }

  sender.addReaction(messageID, "ONIT").catch(() => {});

  const workDir = workspace.initUser(userID);
  const taskDefs: TaskDefinition[] = tasks.map((desc, i) => ({
    id: `T${i + 1}`,
    description: desc,
    prompt: desc,
    workDir,
  }));

  log("info", "Running parallel tasks", { userID, taskCount: taskDefs.length });
  emit("command", { command: "/run", userID, taskCount: taskDefs.length });

  const runner = new TaskRunner({ model: ctx.session.model });
  // Fire-and-forget — TaskRunner handles its own progress reporting
  runner.runParallel(taskDefs, sender, chatID, userID, chatType).catch((err) => {
    log("error", "TaskRunner failed", { userID, error: String(err) });
    sender.sendMarkdown(chatID, `${atPrefix}**Task Runner Error**\n\n${String(err)}`).catch(() => {});
  });
}

/**
 * Parse task descriptions from user input.
 * Supports: "task 1" "task 2" "task 3" (quoted)
 * Or newline-separated lines.
 */
function parseTaskList(input: string): string[] {
  // Try quoted strings first: "task1" "task2"
  const quoted = [...input.matchAll(/"([^"]+)"/g)].map((m) => m[1]!.trim());
  if (quoted.length >= 2) return quoted;

  // Fall back to newline-separated
  const lines = input.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length >= 2) return lines;

  // Single item
  return lines;
}

/**
 * /sessions — List recent local Claude CLI sessions.
 */
async function handleSessionsCommand(ctx: CommandContext): Promise<void> {
  const { event, sender } = ctx;
  const { chatID, messageID, chatType, userID } = event;
  const atPrefix = chatType === "group" ? `<at id=${userID}></at>\n` : "";

  const sessions = listRecentSessions(10);

  if (sessions.length === 0) {
    await sender.sendText(chatID, "No local Claude CLI sessions found.", messageID);
    return;
  }

  const lines = sessions.map((s, i) => {
    const date = new Date(s.mtime).toLocaleString();
    const branch = s.gitBranch ? ` (${s.gitBranch})` : "";
    const shortId = s.sessionId.slice(0, 8) + "...";
    return `${i + 1}. \`${shortId}\` — ${s.cwd}${branch}\n   ${date}\n   Full ID: \`${s.sessionId}\``;
  });

  await sender.sendMarkdown(
    chatID,
    `${atPrefix}**Recent Local Sessions**\n\n${lines.join("\n\n")}\n\nUse \`/resume <session-id>\` to continue a session.`,
    messageID,
  );

  emit("command", { command: "/sessions", userID });
}

/**
 * /resume <session-id> — Attach to a local Claude CLI session so subsequent
 * messages continue that conversation.
 */
async function handleResumeCommand(ctx: CommandContext, arg: string): Promise<void> {
  const { event, sender, session } = ctx;
  const { chatID, messageID, chatType, userID } = event;
  const atPrefix = chatType === "group" ? `<at id=${userID}></at>\n` : "";

  let sessionId: string;
  let jsonlPath: string;
  let meta: { cwd: string; gitBranch?: string; entrypoint?: string };

  if (!arg) {
    // No argument: auto-resume the most recent local session
    const recent = listRecentSessions(1);
    if (recent.length === 0) {
      await sender.sendMarkdown(
        chatID,
        `${atPrefix}No local Claude CLI sessions found.\n\nStart a conversation with \`claude\` locally first.`,
        messageID,
      );
      return;
    }
    const latest = recent[0]!;
    const found = findSessionFile(latest.sessionId);
    if (!found) {
      await sender.sendText(chatID, "Failed to locate latest session file.", messageID);
      return;
    }
    sessionId = latest.sessionId;
    jsonlPath = found;
    meta = { cwd: latest.cwd, gitBranch: latest.gitBranch, entrypoint: latest.entrypoint };
  } else {
    // Argument provided: resume specific session by ID
    sessionId = arg.trim();

    if (!UUID_RE.test(sessionId)) {
      await sender.sendText(chatID, "Invalid session ID format. Expected a UUID.", messageID);
      return;
    }

    const found = findSessionFile(sessionId);
    if (!found) {
      await sender.sendMarkdown(
        chatID,
        `${atPrefix}Session \`${sessionId}\` not found.\n\nUse \`/sessions\` to list available sessions.`,
        messageID,
      );
      return;
    }
    jsonlPath = found;

    const extracted = extractSessionMeta(jsonlPath);
    if (!extracted) {
      await sender.sendText(chatID, "Failed to read session metadata.", messageID);
      return;
    }
    meta = extracted;
  }

  session.attachExternalSession(sessionId, meta.cwd);

  const branch = meta.gitBranch ? `\nBranch: \`${meta.gitBranch}\`` : "";
  await sender.sendMarkdown(
    chatID,
    `${atPrefix}**Session Resumed**\n\nSession: \`${sessionId}\`\nProject: \`${meta.cwd}\`${branch}\n\nYour messages will now continue this conversation. Use \`/detach\` to return to normal.`,
    messageID,
  );

  log("info", "User resumed external CLI session", { userID, sessionId, cwd: meta.cwd });
  emit("command", { command: "/resume", userID, sessionId, cwd: meta.cwd });
}

/**
 * /detach — Detach from an external CLI session and return to normal bot session.
 */
async function handleDetachCommand(ctx: CommandContext): Promise<void> {
  const { event, sender, session } = ctx;
  const { chatID, messageID, chatType, userID } = event;
  const atPrefix = chatType === "group" ? `<at id=${userID}></at>\n` : "";

  if (!session.cliWorkDir) {
    await sender.sendText(chatID, "Not attached to any external session.", messageID);
    return;
  }

  const oldCwd = session.cliWorkDir;
  session.detachExternalSession();

  await sender.sendMarkdown(
    chatID,
    `${atPrefix}**Detached** from external session.\nPrevious project: \`${oldCwd}\`\n\nReturned to normal bot session.`,
    messageID,
  );

  log("info", "User detached from external CLI session", { userID, previousCwd: oldCwd });
  emit("command", { command: "/detach", userID });
}

/**
 * /create-agent <name> <description> — Create a new agent persona.
 * The bot generates a SOUL.md file for the new agent based on the description.
 */
async function handleCreateAgentCommand(ctx: CommandContext, arg: string): Promise<void> {
  const { event, sender, workspace } = ctx;
  const { chatID, messageID, chatType, userID } = event;
  const atPrefix = chatType === "group" ? `<at id=${userID}></at>\n` : "";

  if (!arg) {
    await sender.sendMarkdown(
      chatID,
      `${atPrefix}**Usage:**\n\`/create-agent <name> <description>\`\n\nExample: \`/create-agent code-reviewer A meticulous code reviewer focused on security and best practices\``,
      messageID,
    );
    return;
  }

  // Parse: first word is name, rest is description
  const parts = arg.split(/\s+/);
  const agentName = parts[0]!.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const description = parts.slice(1).join(" ").trim();

  if (!agentName) {
    await sender.sendText(chatID, "Agent name is required.", messageID);
    return;
  }

  if (workspace.agentExists(agentName)) {
    await sender.sendMarkdown(
      chatID,
      `${atPrefix}Agent **${agentName}** already exists. Use \`/switch-agent ${agentName}\` to switch to it.`,
      messageID,
    );
    return;
  }

  // Generate SOUL.md content
  const soulContent = [
    `## Values`,
    description ? `- ${description}` : "- Be helpful and accurate",
    "",
    `## Behavior`,
    `- Focus on quality and thoroughness`,
    `- Ask for clarification when requirements are unclear`,
    "",
    `## Expertise`,
    description ? `- Specialized in: ${description}` : "- General-purpose assistant",
    "",
  ].join("\n");

  try {
    workspace.createAgent(agentName, soulContent, description);

    await sender.sendMarkdown(
      chatID,
      `${atPrefix}**Agent Created: ${agentName}**\n\n${description ? `> ${description}\n\n` : ""}Use \`/switch-agent ${agentName}\` to activate it.\nEdit the SOUL.md file in the workspace to customize behavior.`,
      messageID,
    );

    log("info", "Agent created", { userID, agentName, description });
    emit("command", { command: "/create-agent", userID, agentName });
  } catch (err) {
    await sender.sendText(chatID, `Failed to create agent: ${String(err)}`, messageID);
  }
}

/**
 * /switch-agent <name> — Switch to a different agent persona.
 * This changes the session's agentID and resets the CLI session.
 */
async function handleSwitchAgentCommand(ctx: CommandContext, arg: string): Promise<void> {
  const { event, sender, session, workspace } = ctx;
  const { chatID, messageID, chatType, userID } = event;
  const atPrefix = chatType === "group" ? `<at id=${userID}></at>\n` : "";

  if (!arg) {
    await sender.sendMarkdown(
      chatID,
      `${atPrefix}**Usage:** \`/switch-agent <name>\`\n\nUse \`/list-agents\` to see available agents.`,
      messageID,
    );
    return;
  }

  const agentName = arg.trim().toLowerCase();

  if (!workspace.agentExists(agentName)) {
    await sender.sendMarkdown(
      chatID,
      `${atPrefix}Agent **${agentName}** not found.\n\nUse \`/list-agents\` to see available agents, or \`/create-agent\` to create a new one.`,
      messageID,
    );
    return;
  }

  // Switch the session to the new agent
  const oldAgent = session.agentID;
  session.agentID = agentName;
  session.resetCliSession(); // fresh CLI session for new persona

  await sender.sendMarkdown(
    chatID,
    `${atPrefix}**Switched to agent: ${agentName}**\n\nPrevious: \`${oldAgent}\`\nCLI session reset for new persona.`,
    messageID,
  );

  log("info", "User switched agent", { userID, from: oldAgent, to: agentName });
  emit("command", { command: "/switch-agent", userID, from: oldAgent, to: agentName });
}

/**
 * /list-agents — List all available agent personas.
 */
async function handleListAgentsCommand(ctx: CommandContext): Promise<void> {
  const { event, sender, session, workspace } = ctx;
  const { chatID, messageID, chatType, userID } = event;
  const atPrefix = chatType === "group" ? `<at id=${userID}></at>\n` : "";

  const agents = workspace.listAgents();

  if (agents.length === 0) {
    await sender.sendMarkdown(
      chatID,
      `${atPrefix}No agents found. Use \`/create-agent <name> <description>\` to create one.`,
      messageID,
    );
    return;
  }

  const currentAgent = session.agentID;
  const lines = agents.map((a) => {
    const isCurrent = a.id === currentAgent;
    const marker = isCurrent ? " **(active)**" : "";
    const desc = a.description ? ` — ${a.description}` : "";
    return `- \`${a.id}\`${marker}${desc}`;
  });

  await sender.sendMarkdown(
    chatID,
    `${atPrefix}**Available Agents**\n\n${lines.join("\n")}\n\nUse \`/switch-agent <name>\` to switch.`,
    messageID,
  );

  emit("command", { command: "/list-agents", userID });
}

/**
 * /help — Show all available commands.
 */
async function handleHelpCommand(ctx: CommandContext): Promise<void> {
  const { event, sender } = ctx;
  const { chatID, messageID, chatType, userID } = event;
  const atPrefix = chatType === "group" ? `<at id=${userID}></at>\n` : "";

  const help = [
    "**Available Commands**",
    "",
    "| Command | Description |",
    "| --- | --- |",
    "| `/help` | Show this help message |",
    "| `/model` | Show model selection card |",
    "| `/model <name>` | Switch model (haiku / sonnet / opus) |",
    "| `/dev <task>` | Spawn an autonomous dev agent |",
    "| `/dev --repo <path> <task>` | Dev agent on a specific repo |",
    "| `/run \"task1\" \"task2\" ...` | Run multiple tasks in parallel |",
    "| `/feedback <content>` | Submit feedback for analysis |",
    "| `/resume` | Continue your latest local Claude CLI session |",
    "| `/resume <session-id>` | Continue a specific local session |",
    "| `/sessions` | List recent local Claude CLI sessions |",
    "| `/detach` | Detach from external session, return to normal |",
    "| `/create-agent <name> <desc>` | Create a new agent persona |",
    "| `/switch-agent <name>` | Switch to a different agent |",
    "| `/list-agents` | List all available agents |",
    "",
    "**Session Transfer**",
    "",
    "Run Claude Code locally (terminal / VS Code), then send `/resume` here to pick up where you left off. The bot automatically finds your latest session and continues the conversation with full context.",
  ].join("\n");

  await sender.sendMarkdown(chatID, `${atPrefix}${help}`, messageID);
  emit("command", { command: "/help", userID });
}
