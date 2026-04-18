#!/usr/bin/env node
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { agentRegistry } from 'codelink-agent';
import type { AgentBackend, AgentMessage } from 'codelink-agent';

interface PromptFrame {
  type: 'prompt';
  text: string;
}

interface PermissionResponseFrame {
  type: 'permission-response';
  requestId: string;
  approved: boolean;
}

type InputFrame = PromptFrame | PermissionResponseFrame;

function sanitizeEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export function parseInputFrame(line: string): InputFrame | null {
  try {
    const parsed = JSON.parse(line) as {
      type?: string;
      text?: unknown;
      requestId?: unknown;
      approved?: unknown;
    };
    if (parsed.type === 'prompt' && typeof parsed.text === 'string') {
      return {
        type: 'prompt',
        text: parsed.text,
      };
    }
    if (
      parsed.type === 'permission-response'
      && typeof parsed.requestId === 'string'
      && typeof parsed.approved === 'boolean'
    ) {
      return {
        type: 'permission-response',
        requestId: parsed.requestId,
        approved: parsed.approved,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeProxyMessage(message: AgentMessage): string | null {
  switch (message.type) {
    case 'model-output':
      return message.textDelta ?? null;
    case 'terminal-output':
      return message.data;
    case 'command-start':
      return `@@ATLAS:CMD_START:${JSON.stringify({
        commandId: message.commandId,
        command: message.command,
        ...(message.cwd ? { cwd: message.cwd } : {}),
      })}\n`;
    case 'command-exit':
      return `@@ATLAS:CMD_END:${JSON.stringify({
        commandId: message.commandId,
        exitCode: message.exitCode,
      })}\n`;
    case 'cwd-change':
      return `@@ATLAS:CWD:${JSON.stringify({ cwd: message.cwd })}\n`;
    case 'permission-request':
      return `@@ATLAS:PERMISSION_REQUEST:${JSON.stringify({
        id: message.id,
        reason: message.reason,
        payload: message.payload,
      })}\n`;
    case 'exec-approval-request':
      return `@@ATLAS:PERMISSION_REQUEST:${JSON.stringify({
        id: message.call_id,
        reason: 'Execution approval requested',
        payload: { source: 'exec-approval-request', ...message },
      })}\n`;
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const backend = agentRegistry.create('codex', {
    cwd: process.cwd(),
    env: sanitizeEnv(process.env),
  });
  const { sessionId } = await backend.startSession();

  backend.onMessage((message) => {
    const chunk = serializeProxyMessage(message);
    if (chunk) {
      process.stdout.write(chunk);
    }
  });

  let queue = Promise.resolve();
  let activeBackend: AgentBackend = backend;

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
    terminal: false,
  });

  rl.on('line', (line) => {
    const frame = parseInputFrame(line);
    if (!frame) {
      return;
    }

    queue = queue
      .then(() => {
        if (frame.type === 'prompt') {
          return activeBackend.sendPrompt(sessionId, frame.text);
        }
        if (activeBackend.respondToPermission) {
          return activeBackend.respondToPermission(frame.requestId, frame.approved);
        }
      })
      .catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      });
  });

  process.on('SIGINT', () => {
    void activeBackend.cancel(sessionId);
  });

  rl.on('close', () => {
    void queue.finally(async () => {
      await activeBackend.dispose();
      process.exit(0);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
