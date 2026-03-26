#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SERVER_URL = process.env.BEAM_SERVER_URL ?? "http://127.0.0.1:18791";

// ─── Daemon (background server) ─────────────────────────────────────────────

const PID_DIR = join(homedir(), ".beam-flow");
const PID_FILE = join(PID_DIR, "server.pid");

function isServerRunning(): boolean {
  if (!existsSync(PID_FILE)) return false;
  const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
  if (isNaN(pid)) return false;
  try {
    process.kill(pid, 0); // signal 0 = check if process exists
    return true;
  } catch {
    return false;
  }
}

async function ensureDaemon(): Promise<void> {
  if (isServerRunning()) {
    console.log("Server already running.");
    return;
  }

  const entry = process.env.BEAM_SERVER_ENTRY ?? join(process.cwd(), "dist", "index.js");
  if (!existsSync(entry)) {
    console.error(`Server entry not found: ${entry}`);
    console.error("Run 'npm run build' first, or set BEAM_SERVER_ENTRY env var.");
    process.exit(1);
  }

  mkdirSync(PID_DIR, { recursive: true });

  const child = spawn("node", [entry], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  if (child.pid) {
    writeFileSync(PID_FILE, String(child.pid), "utf-8");
    console.log(`Server started (PID ${child.pid}). Waiting for readiness...`);
  }

  // Poll for readiness (up to 10s)
  for (let i = 0; i < 20; i++) {
    try {
      await fetch(`${SERVER_URL}/api/status`);
      console.log("Server ready.");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.warn("Warning: server may not be ready yet. Continuing anyway.");
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function httpJSON(method: string, path: string, body?: unknown): Promise<any> {
  const url = `${SERVER_URL}${path}`;
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status}: ${text}`);
  }
  return resp.json();
}

// ─── Shell helpers ───────────────────────────────────────────────────────────

function printExport(key: string, value: string): void {
  if (process.platform === "win32") {
    console.log(`  $env:${key}="${value}"`);
  } else {
    console.log(`  export ${key}="${value}"`);
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdStart(name: string): Promise<void> {
  if (!name) {
    console.error("Usage: beam-flow start <session-name>");
    process.exit(1);
  }

  const sessionId = randomUUID();
  console.log(`\nStarting Claude session '${name}' (id: ${sessionId})`);
  console.log("\nTo set env vars in your shell after exit, run:");
  printExport("BEAM_SESSION_ID", sessionId);
  printExport("BEAM_SESSION_NAME", name);
  console.log("");

  const cliPath = (process.env.CLAUDE_CLI_PATH ?? "claude").replace(/^"|"$/g, "");

  const child = spawn(cliPath, ["--session-id", sessionId], {
    stdio: "inherit",
    env: {
      ...process.env,
      BEAM_SESSION_ID: sessionId,
      BEAM_SESSION_NAME: name,
    },
  });

  const code = await new Promise<number>((resolve) => {
    child.on("close", (c) => resolve(c ?? 0));
  });

  console.log(`\nClaude exited (code ${code}).`);
  console.log(`Session '${name}' ready to park.`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question("Park now? [Y/n] ", (a) => { rl.close(); resolve(a.trim()); });
  });

  if (!answer || answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
    await doPark(name, sessionId);
  }
}

async function doPark(name: string, sessionId: string): Promise<void> {
  try {
    await httpJSON("POST", "/api/beam/park", { name, cliSessionId: sessionId });
    console.log(`\nParked '${name}'! In Feishu, type: /sessions`);
  } catch (err) {
    console.error(`\nFailed to park: ${err}`);
    console.error("Is the feishu-ai-assistant server running?");
    process.exit(1);
  }
}

async function cmdPark(name?: string): Promise<void> {
  const sessionId = process.env.BEAM_SESSION_ID;
  const sessionName = name || process.env.BEAM_SESSION_NAME;

  if (sessionId && sessionName) {
    await doPark(sessionName, sessionId);
    return;
  }

  if (!sessionName) {
    console.error("No BEAM_SESSION_NAME found in environment.");
    console.error("Usage: beam-flow park <name>");
    console.error("Or run `beam-flow start <name>` first to set up env vars.");
    process.exit(1);
  }

  if (!sessionId) {
    console.error("No BEAM_SESSION_ID found in environment.");
    console.error("Run `beam-flow start <name>` first.");
    process.exit(1);
  }
}

async function cmdSessions(): Promise<void> {
  try {
    const sessions = await httpJSON("GET", "/api/beam/sessions");
    if (!sessions.length) {
      console.log("No parked sessions.");
      return;
    }
    console.log("Parked sessions:\n");
    for (const s of sessions) {
      const ago = timeAgo(Date.now() - s.parkedAt);
      console.log(`  ${s.name}  (${ago})  [${s.cliSessionId.slice(0, 8)}...]`);
    }
    console.log(`\nResume in Feishu: /resume <name>`);
  } catch (err) {
    console.error(`Failed to list sessions: ${err}`);
    process.exit(1);
  }
}

async function cmdDrop(name: string): Promise<void> {
  if (!name) {
    console.error("Usage: beam-flow drop <session-name>");
    process.exit(1);
  }
  try {
    const result = await httpJSON("DELETE", `/api/beam/sessions/${encodeURIComponent(name)}`);
    if (result.ok) {
      console.log(`Dropped session '${name}'.`);
    } else {
      console.log(`Session '${name}' not found.`);
    }
  } catch (err) {
    console.error(`Failed to drop: ${err}`);
    process.exit(1);
  }
}

function timeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function printHelp(): void {
  console.log(`beam-flow - Teleport your Claude sessions to Feishu

Usage:
  beam-flow start <name>     Start Claude CLI with session tracking
  beam-flow park [name]      Park current session for Feishu
  beam-flow sessions         List parked sessions
  beam-flow drop <name>      Remove a parked session

Flags:
  -d, --daemon               Start the server in background before running
  -h, --help                 Show this help message

Environment:
  BEAM_SERVER_URL            Server URL (default: http://127.0.0.1:18791)
  BEAM_SERVER_ENTRY          Path to server entry (default: dist/index.js)
  CLAUDE_CLI_PATH            Path to claude CLI (default: claude)
`);
}

// ─── CLI Entry ──────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const flags = new Set<string>();
const positional: string[] = [];

for (const arg of rawArgs) {
  if (arg === "-d" || arg === "--daemon") flags.add("daemon");
  else if (arg === "-h" || arg === "--help") flags.add("help");
  else positional.push(arg);
}

const [cmd, ...args] = positional;

if (flags.has("help")) {
  printHelp();
  process.exit(0);
}

if (flags.has("daemon")) {
  await ensureDaemon();
}

switch (cmd) {
  case "start":
    await cmdStart(args.join(" "));
    break;
  case "park":
    await cmdPark(args.join(" ") || undefined);
    break;
  case "sessions":
  case "ls":
    await cmdSessions();
    break;
  case "drop":
  case "rm":
    await cmdDrop(args.join(" "));
    break;
  default:
    printHelp();
    break;
}
