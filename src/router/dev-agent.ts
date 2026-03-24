import { spawn } from "node:child_process";
import { getConfig, parseDuration } from "../config.js";
import { getCliPath, buildSpawnArgs, getStdinPrompt } from "../backend/index.js";
import { emit } from "../webui/events.js";
import type { PlatformSender } from "../platform/types.js";

function log(level: string, msg: string, meta?: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, msg, ...meta };
  console.log(JSON.stringify(entry));
}

/** Phases the dev agent reports via stdout markers. */
const PHASES = ["PLANNING", "IMPLEMENTING", "TESTING", "COMMITTING"] as const;
type Phase = (typeof PHASES)[number];

const PHASE_LABELS: Record<Phase, string> = {
  PLANNING: "Planning implementation...",
  IMPLEMENTING: "Writing code...",
  TESTING: "Running TDD tests...",
  COMMITTING: "Committing to master...",
};

const PHASE_EMOJI: Record<Phase, string> = {
  PLANNING: "THINKING",
  IMPLEMENTING: "WRITING",
  TESTING: "MUSCLE",
  COMMITTING: "TADA",
};

/** Build the system prompt that instructs Claude to follow the dev workflow. */
function buildDevPrompt(task: string): string {
  return [
    "You are an autonomous development agent. Execute the following development task through these phases IN ORDER.",
    "You MUST print the exact phase marker at the START of each phase (on its own line).",
    "",
    "## Phases",
    "",
    "### Phase 1: Planning",
    "Print: [PHASE:PLANNING]",
    "- Analyze the task requirements",
    "- Identify files to create or modify",
    "- Create a step-by-step implementation plan",
    "- Consider edge cases and dependencies",
    "",
    "### Phase 2: Implementing",
    "Print: [PHASE:IMPLEMENTING]",
    "- Follow the plan from Phase 1",
    "- Write clean, well-structured code",
    "- Follow existing code patterns and conventions in the project",
    "",
    "### Phase 3: Testing (TDD)",
    "Print: [PHASE:TESTING]",
    "- Write tests for the new/changed code",
    "- Run the tests using the project's test runner",
    "- Fix any failures until all tests pass",
    "- If no test framework is configured, run type checking or linting instead",
    "",
    "### Phase 4: Committing",
    "Print: [PHASE:COMMITTING]",
    "- Stage the changed files (git add specific files, NOT git add -A)",
    "- Create a descriptive commit message following conventional commits format",
    "- Commit to the current branch (master)",
    "- Do NOT push to remote",
    "",
    "## Important Rules",
    "- Complete ALL four phases in order",
    "- Print the phase marker EXACTLY as shown (e.g., [PHASE:PLANNING])",
    "- If a phase fails, report the error and stop",
    "- Do NOT ask for user input — make reasonable decisions autonomously",
    "",
    `## Task`,
    task,
  ].join("\n");
}

export interface DevAgentOptions {
  /** The development task description. */
  task: string;
  /** Working directory (target repo). */
  workDir: string;
  /** Feishu chat ID for progress updates. */
  chatID: string;
  /** User ID for @mentions in group chats. */
  userID: string;
  /** Chat type for formatting. */
  chatType: "p2p" | "group";
  /** Platform sender for Feishu messages. */
  sender: PlatformSender;
  /** Original message ID for reactions. */
  messageID: string;
  /** Model to use (from session). Falls back to DEFAULT_MODEL. */
  model?: string;
}

/**
 * Spawn a Claude CLI subprocess to execute a development task with progress
 * reporting back to Feishu.
 */
export function spawnDevAgent(options: DevAgentOptions): void {
  const { task, workDir, chatID, userID, chatType, sender, messageID, model } = options;
  const config = getConfig();
  const cliPath = getCliPath();
  // Dev agent needs much more time than simple Q&A (4 phases: plan, implement, test, commit)
  const baseTimeout = parseDuration(config.agent.timeout);
  const timeoutMs = Math.max(baseTimeout * 5, 10 * 60 * 1000); // at least 10 minutes

  const atPrefix = chatType === "group" ? `<at id=${userID}></at>\n` : "";
  const devPrompt = buildDevPrompt(task);

  const args = buildSpawnArgs({
    prompt: devPrompt,
    outputFormat: "stream-json",
    addDirs: [workDir],
    permissionMode: "auto",
  });

  log("info", "Spawning dev agent", { userID, workDir, taskLen: task.length });

  const child = spawn(cliPath, args, {
    cwd: workDir,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  // Manual timeout since spawn() does not support the timeout option
  const killTimer = setTimeout(() => {
    child.kill("SIGTERM");
  }, timeoutMs);

  // Write prompt to stdin (avoids command-line length limits on Windows)
  const stdinPrompt = getStdinPrompt({ prompt: devPrompt });
  child.stdin?.write(stdinPrompt);
  child.stdin?.end();

  let fullOutput = "";
  let stderr = "";
  const reportedPhases = new Set<Phase>();

  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    fullOutput += text;

    // Detect phase markers in the stream
    for (const phase of PHASES) {
      if (!reportedPhases.has(phase) && fullOutput.includes(`[PHASE:${phase}]`)) {
        reportedPhases.add(phase);
        const label = PHASE_LABELS[phase];
        const emoji = PHASE_EMOJI[phase];

        // Send progress update (fire-and-forget), no per-phase reaction
        sender.sendMarkdown(chatID, `${atPrefix}**Dev Agent** — ${label}`).catch(() => {});

        log("info", "Dev agent phase", { userID, phase });
        emit("dev-agent", { status: "phase", userID, phase });
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

  child.on("close", async (code, signal) => {
    clearTimeout(killTimer);
    try {
      if (code !== 0) {
        // Detect timeout / signal kill (code === null means killed by signal)
        if (code === null) {
          const reason = signal ? `killed by signal ${signal}` : "timed out";
          log("error", "Dev agent subprocess killed", { signal, stderr: stderr.slice(0, 500) });
          emit("error", { source: "dev-agent", userID, error: reason });

          // Even though it timed out, it may have completed some phases — show partial result
          const partialResult = extractResult(fullOutput);
          const phaseSummary = PHASES.map((p) => {
            const done = reportedPhases.has(p);
            return `- [${done ? "x" : " "}] ${p}`;
          }).join("\n");

          await sender.sendMarkdown(
            chatID,
            [
              `${atPrefix}**Dev Agent — ${reason}**`,
              "",
              phaseSummary,
              "",
              partialResult ? `**Partial result:**\n${partialResult.slice(0, 2000)}` : "",
            ].filter(Boolean).join("\n"),
          );
          sender.addReaction(messageID, "CRY").catch(() => {});
          return;
        }

        // Extract error from stream-json output if stderr is empty
        let errorDetail = stderr.trim();
        if (!errorDetail && fullOutput) {
          // Try to find error messages in stream-json lines
          const lines = fullOutput.trim().split("\n");
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const obj = JSON.parse(lines[i]!);
              if (obj.type === "error" || (obj.type === "result" && obj.is_error)) {
                errorDetail = obj.error || obj.result || JSON.stringify(obj);
                break;
              }
            } catch { /* not JSON */ }
          }
          // Fallback: show last portion of stderr or a generic message
          if (!errorDetail) {
            errorDetail = "Process exited with no error details. Check server logs.";
          }
        }

        log("error", "Dev agent subprocess failed", {
          code,
          stderr: stderr.slice(0, 500),
          stdout_tail: fullOutput.slice(-500),
        });
        emit("error", { source: "dev-agent", userID, error: errorDetail.slice(0, 200) });
        await sender.sendMarkdown(
          chatID,
          `${atPrefix}**Dev Agent Failed**\n\nExit code: ${code}\n\n\`\`\`\n${errorDetail.slice(0, 1500)}\n\`\`\``,
        );
        sender.addReaction(messageID, "CRY").catch(() => {});
        return;
      }

      // Parse final result from stream-json output
      const resultText = extractResult(fullOutput);

      // Determine completion status
      const allPhasesCompleted = PHASES.every((p) => reportedPhases.has(p));
      const statusIcon = allPhasesCompleted ? "TADA" : "OPENMOUTH";
      const statusLabel = allPhasesCompleted ? "All phases completed" : "Partially completed";

      // Build summary card
      const phaseSummary = PHASES.map((p) => {
        const done = reportedPhases.has(p);
        return `- [${done ? "x" : " "}] ${p}`;
      }).join("\n");

      await sender.sendMarkdown(
        chatID,
        [
          `${atPrefix}**Dev Agent — ${statusLabel}**`,
          "",
          phaseSummary,
          "",
          resultText ? `**Result:**\n${resultText.slice(0, 3000)}` : "",
        ].filter(Boolean).join("\n"),
      );

      sender.addReaction(messageID, statusIcon).catch(() => {});
      log("info", "Dev agent completed", { userID, allPhasesCompleted, resultLen: resultText.length });
      emit("dev-agent", { status: "completed", userID, allPhasesCompleted, resultLen: resultText.length });
    } catch (err) {
      log("error", "Failed to send dev agent result", { error: String(err) });
    }
  });

  child.on("error", async (err) => {
    log("error", "Dev agent subprocess error", { error: String(err) });
    emit("error", { source: "dev-agent", userID, error: String(err) });
    await sender.sendMarkdown(
      chatID,
      `${atPrefix}**Dev Agent Error**\n\nFailed to start: ${String(err)}`,
    ).catch(() => {});
    sender.addReaction(messageID, "CRY").catch(() => {});
  });
}

/**
 * Extract the final result text from Claude CLI stream-json output.
 * Looks for the last "result" type message in the JSON stream.
 */
function extractResult(output: string): string {
  // stream-json outputs one JSON object per line
  const lines = output.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]!);
      if (obj.type === "result" && obj.result) {
        return obj.result;
      }
      // Also handle assistant messages with text content
      if (obj.type === "assistant" && obj.message?.content) {
        const textParts = obj.message.content
          .filter((c: { type: string }) => c.type === "text")
          .map((c: { text: string }) => c.text);
        if (textParts.length > 0) return textParts.join("\n");
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // Fallback: try plain JSON output
  try {
    const parsed = JSON.parse(output.trim());
    return parsed.result || "";
  } catch {
    return output.slice(-2000);
  }
}
