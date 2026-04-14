#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { formatTmuxCommandError } from 'codelink-gateway';
import { adoptTmuxRuntime, discoverTmuxSessions, findExistingTmuxRuntime, launchTmuxRuntime } from './runtimeLauncher.js';

const SERVER_URL =
  process.env.CODELINK_RUNTIME_SERVER_URL
  ?? process.env.ATLAS_RUNTIME_SERVER_URL
  ?? 'http://127.0.0.1:20263';
const execFileAsync = promisify(execFile);
type RuntimeProvider = 'claude' | 'codex';

async function httpJSON(method: string, path: string, body?: unknown): Promise<any> {
  const url = `${SERVER_URL}${path}`;
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) {
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status}: ${text}`);
  }
  return resp.json();
}

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

function parseProviderArgs(
  commandName: 'start' | 'adopt',
  args: string[],
): { provider: RuntimeProvider; positional: string[] } {
  let provider = (
    process.env.CODELINK_RUNTIME_PROVIDER
    ?? process.env.ATLAS_RUNTIME_PROVIDER
    ?? 'claude'
  ) as RuntimeProvider;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--provider' || arg === '-p') {
      const next = args[i + 1];
      if (next === 'claude' || next === 'codex') {
        provider = next;
        i += 1;
        continue;
      }
      throw new Error(`Usage: codelink-runtime ${commandName} [--provider claude|codex] ...`);
    }

    positional.push(arg);
  }

  if (provider !== 'claude' && provider !== 'codex') {
    throw new Error(`Unsupported runtime provider: ${provider}`);
  }

  return { provider, positional };
}

function parseStartArgs(args: string[]): { provider: RuntimeProvider; name: string } {
  const { provider, positional } = parseProviderArgs('start', args);
  return {
    provider,
    name: positional.join(' '),
  };
}

function resolveCliPath(provider: RuntimeProvider): string {
  const value = provider === 'codex'
    ? (process.env.CODEX_CLI_PATH ?? 'codex')
    : (process.env.CLAUDE_CLI_PATH ?? 'claude');
  return value.replace(/^"|"$/g, '');
}

async function cmdStart(args: string[]): Promise<void> {
  const { provider, name } = parseStartArgs(args);
  const cliPath = resolveCliPath(provider);
  const cwd = process.env.CODELINK_RUNTIME_CWD ?? process.env.ATLAS_RUNTIME_CWD ?? process.cwd();
  const tmuxBin =
    process.env.CODELINK_TMUX_BIN
    ?? process.env.ATLAS_TMUX_BIN
    ?? process.env.TMUX_BIN
    ?? 'tmux';

  console.log('');
  try {
    const launched = await launchTmuxRuntime({
      provider,
      name: name || '',
      cwd,
      cliPath,
      serverUrl: SERVER_URL,
    }, {
      runCommand: async (args) => {
        const { stdout } = await execFileAsync(tmuxBin, args, {
          windowsHide: true,
          maxBuffer: 1024 * 1024 * 4,
        });
        return stdout;
      },
      registerRuntime: async (payload) => {
        await httpJSON('POST', '/api/runtimes/register', payload);
      },
    });

    console.log(`Started tmux runtime '${launched.displayName}' [${provider}] (id: ${launched.runtimeId})`);
    console.log(`tmux session: ${launched.sessionName}`);
    console.log(`attach locally: ${tmuxBin} attach -t ${launched.sessionName}`);
    console.log(`attach from chat: /attach ${launched.runtimeId.slice(0, 8)}`);
  } catch (err) {
    console.error(formatTmuxCommandError('start a tmux runtime', err, tmuxBin));
    process.exit(1);
  }
}

async function cmdDiscover(): Promise<void> {
  const tmuxBin =
    process.env.CODELINK_TMUX_BIN
    ?? process.env.ATLAS_TMUX_BIN
    ?? process.env.TMUX_BIN
    ?? 'tmux';

  try {
    const sessions = await discoverTmuxSessions({
      runCommand: async (args) => {
        const { stdout } = await execFileAsync(tmuxBin, args, {
          windowsHide: true,
          maxBuffer: 1024 * 1024 * 4,
        });
        return stdout;
      },
    });

    if (!sessions.length) {
      console.log('No tmux sessions found.');
      return;
    }

    console.log(`tmux Sessions (${sessions.length}):\n`);
    for (const session of sessions) {
      console.log(`  ${session.sessionName}`);
      console.log(`    adopt as Claude: codelink-runtime adopt ${session.sessionName}`);
      console.log(`    adopt as Codex:  codelink-runtime adopt --provider codex ${session.sessionName}`);
    }
  } catch (err) {
    console.error(formatTmuxCommandError('discover tmux sessions', err, tmuxBin));
    process.exit(1);
  }
}

async function cmdAdopt(args: string[]): Promise<void> {
  const { provider, positional } = parseProviderArgs('adopt', args);
  const [sessionName, ...displayNameParts] = positional;
  const tmuxBin =
    process.env.CODELINK_TMUX_BIN
    ?? process.env.ATLAS_TMUX_BIN
    ?? process.env.TMUX_BIN
    ?? 'tmux';

  if (!sessionName) {
    console.error('Usage: codelink-runtime adopt [--provider claude|codex] <tmux-session> [name]');
    process.exit(1);
  }

  console.log('');
  try {
    const runtimes = await httpJSON('GET', '/api/runtimes?source=external');
    const existing = findExistingTmuxRuntime(runtimes, { provider, sessionName });
    if (existing) {
      const label = existing.displayName ?? existing.id.slice(0, 8);
      console.log(`tmux session '${sessionName}' is already registered as '${label}' [${provider}/tmux] (id: ${existing.id})`);
      console.log(`attach from chat: /attach ${existing.id.slice(0, 8)}`);
      return;
    }

    const adopted = await adoptTmuxRuntime({
      provider,
      sessionName,
      displayName: displayNameParts.join(' ') || undefined,
      serverUrl: SERVER_URL,
    }, {
      runCommand: async (args) => {
        const { stdout } = await execFileAsync(tmuxBin, args, {
          windowsHide: true,
          maxBuffer: 1024 * 1024 * 4,
        });
        return stdout;
      },
      registerRuntime: async (payload) => {
        await httpJSON('POST', '/api/runtimes/register', payload);
      },
    });

    console.log(`Adopted tmux session '${adopted.sessionName}' as '${adopted.displayName}' [${provider}] (id: ${adopted.runtimeId})`);
    console.log('existing tmux session left running');
    console.log(`attach locally: ${tmuxBin} attach -t ${adopted.sessionName}`);
    console.log(`attach from chat: /attach ${adopted.runtimeId.slice(0, 8)}`);
  } catch (err) {
    console.error(formatTmuxCommandError('adopt a tmux session', err, tmuxBin));
    process.exit(1);
  }
}

async function cmdList(): Promise<void> {
  try {
    const runtimes = await httpJSON('GET', '/api/runtimes?source=external');
    if (!runtimes.length) {
      console.log('No external runtimes.');
      return;
    }
    console.log(`External Runtimes (${runtimes.length}):\n`);
    for (const runtime of runtimes) {
      const active = timeAgo(runtime.lastActiveAt);
      const transport = runtime.transport ? `/${runtime.transport}` : '';
      console.log(`  ${runtime.displayName}  [${runtime.provider}${transport}]  ${active}  (${runtime.id.slice(0, 8)}...)`);
    }
  } catch (err) {
    console.error(`Failed to list runtimes: ${err}`);
    process.exit(1);
  }
}

async function cmdDrop(name: string): Promise<void> {
  if (!name) {
    console.error('Usage: codelink-runtime drop <runtime-name>');
    process.exit(1);
  }
  try {
    const runtimes = await httpJSON('GET', '/api/runtimes?source=external');
    const matches = runtimes.filter((runtime: { displayName?: string }) => runtime.displayName === name);
    if (matches.length === 0) {
      console.log(`Runtime '${name}' not found.`);
      return;
    }

    for (const runtime of matches) {
      await httpJSON('DELETE', `/api/runtimes/${encodeURIComponent(runtime.id)}`);
    }

    if (matches.length === 1) {
      console.log(`Dropped runtime '${name}'.`);
    } else {
      console.log(`Dropped ${matches.length} runtimes named '${name}'.`);
    }
  } catch (err) {
    console.error(`Failed to drop runtime: ${err}`);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`codelink-runtime - tmux-backed Claude/Codex runtimes visible in /list

Usage:
  codelink-runtime start [--provider claude|codex] [name]
                              Start a tmux-backed runtime and register it
  codelink-runtime discover   List local tmux sessions that can be adopted
  codelink-runtime adopt [--provider claude|codex] <tmux-session> [name]
                              Register an existing tmux session without creating or killing it
  codelink-runtime list       List active external runtimes
  codelink-runtime drop <name> Remove an external runtime

Compatibility alias:
  atlas-runtime ...           Legacy alias for codelink-runtime

Flags:
  -h, --help                  Show this help message

Environment:
  CODELINK_RUNTIME_SERVER_URL / ATLAS_RUNTIME_SERVER_URL
                              Server URL (default: http://127.0.0.1:20263)
  CODELINK_RUNTIME_PROVIDER / ATLAS_RUNTIME_PROVIDER
                              Runtime provider for start (default: claude)
  CODELINK_RUNTIME_CWD / ATLAS_RUNTIME_CWD
                              Working directory for the tmux session (default: current directory)
  CODELINK_TMUX_BIN / ATLAS_TMUX_BIN / TMUX_BIN
                              tmux binary path (default: tmux)
  CLAUDE_CLI_PATH             Path to claude CLI (default: claude)
  CODEX_CLI_PATH              Path to codex CLI (default: codex)
`);
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes('-h') || rawArgs.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const [cmd, ...args] = rawArgs;

  switch (cmd) {
    case 'start':
      await cmdStart(args);
      break;
    case 'discover':
      await cmdDiscover();
      break;
    case 'adopt':
      await cmdAdopt(args);
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
