#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const SERVER_URL = process.env.BEAM_SERVER_URL ?? 'http://127.0.0.1:20263';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function httpJSON(method: string, path: string, body?: unknown): Promise<any> {
  const url = `${SERVER_URL}${path}`;
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status}: ${text}`);
  }
  return resp.json();
}

// ── Time formatting ───────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdStart(name: string): Promise<void> {
  if (!name) {
    console.error('Usage: beam start <session-name>');
    process.exit(1);
  }

  const sessionId = randomUUID();
  console.log(`\nStarting beam session '${name}' (id: ${sessionId})`);

  // Register on server
  try {
    await httpJSON('POST', '/api/beam/register', { name, sessionId });
    console.log('Registered on server.');
  } catch {
    console.log('(Server not reachable — session will not appear in /list)');
  }

  console.log('');

  const cliPath = (process.env.CLAUDE_CLI_PATH ?? 'claude').replace(/^"|"$/g, '');

  // Cleanup handler: remove session from server on exit
  const cleanup = () => {
    fetch(`${SERVER_URL}/api/beam/sessions/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {});
  };
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  const child = spawn(cliPath, ['--session-id', sessionId], {
    stdio: 'inherit',
    env: {
      ...process.env,
      BEAM_SESSION_ID: sessionId,
      BEAM_SESSION_NAME: name,
    },
  });

  const code = await new Promise<number>((resolve) => {
    child.on('close', (c) => resolve(c ?? 0));
  });

  cleanup();
  console.log(`\nSession '${name}' ended (exit code ${code}).`);
}

async function cmdList(): Promise<void> {
  try {
    const sessions = await httpJSON('GET', '/api/beam/sessions');
    if (!sessions.length) {
      console.log('No beam sessions.');
      return;
    }
    console.log(`Beam Sessions (${sessions.length}):\n`);
    for (const s of sessions) {
      const active = timeAgo(s.lastActiveAt);
      console.log(`  🔵 ${s.name}  [${s.agentId}]  ${active}  (${s.sessionId.slice(0, 8)}...)`);
    }
  } catch (err) {
    console.error(`Failed to list sessions: ${err}`);
    process.exit(1);
  }
}

async function cmdDrop(name: string): Promise<void> {
  if (!name) {
    console.error('Usage: beam drop <session-name>');
    process.exit(1);
  }
  try {
    const result = await httpJSON('DELETE', `/api/beam/sessions/${encodeURIComponent(name)}`);
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

function printHelp(): void {
  console.log(`beam - Local Claude sessions visible in Feishu /list

Usage:
  beam start <name>     Start a Claude CLI session tracked by the server
  beam list             List active beam sessions
  beam drop <name>      Remove a beam session

Flags:
  -h, --help            Show this help message

Environment:
  BEAM_SERVER_URL       Server URL (default: http://127.0.0.1:20263)
  CLAUDE_CLI_PATH       Path to claude CLI (default: claude)
`);
}

// ── CLI Entry ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes('-h') || rawArgs.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const positional = rawArgs.filter(a => !a.startsWith('-'));
  const [cmd, ...args] = positional;

  switch (cmd) {
    case 'start':
      await cmdStart(args.join(' '));
      break;
    case 'list':
    case 'ls':
      await cmdList();
      break;
    case 'drop':
    case 'rm':
      await cmdDrop(args.join(' '));
      break;
    default:
      printHelp();
      break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
