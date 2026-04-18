import { describe, expect, it } from 'vitest';
import type { AgentMessage } from 'codelink-agent';
import { parseInputFrame, serializeProxyMessage } from './localCodexRuntimeProxy.js';

describe('localCodexRuntimeProxy', () => {
  it('serializes command lifecycle and permission messages into atlas markers', () => {
    const commandStart = serializeProxyMessage({
      type: 'command-start',
      commandId: 'cmd-1',
      command: 'npm test',
      cwd: '/repo',
    } satisfies AgentMessage);
    const permission = serializeProxyMessage({
      type: 'permission-request',
      id: 'perm-1',
      reason: 'Allow npm install?',
      payload: { toolName: 'shell' },
    } satisfies AgentMessage);
    const commandExit = serializeProxyMessage({
      type: 'command-exit',
      commandId: 'cmd-1',
      exitCode: 0,
    } satisfies AgentMessage);

    expect(commandStart).toBe('@@ATLAS:CMD_START:{"commandId":"cmd-1","command":"npm test","cwd":"/repo"}\n');
    expect(permission).toBe('@@ATLAS:PERMISSION_REQUEST:{"id":"perm-1","reason":"Allow npm install?","payload":{"toolName":"shell"}}\n');
    expect(commandExit).toBe('@@ATLAS:CMD_END:{"commandId":"cmd-1","exitCode":0}\n');
  });

  it('passes through streamed text deltas and terminal output while skipping duplicate full text', () => {
    expect(serializeProxyMessage({ type: 'model-output', textDelta: 'hello' } satisfies AgentMessage)).toBe('hello');
    expect(serializeProxyMessage({ type: 'terminal-output', data: 'cmd output\n' } satisfies AgentMessage)).toBe('cmd output\n');
    expect(serializeProxyMessage({ type: 'model-output', fullText: 'hello world' } satisfies AgentMessage)).toBeNull();
  });

  it('parses permission response frames from the local proxy input protocol', () => {
    expect(parseInputFrame('{"type":"permission-response","requestId":"perm-1","approved":true}')).toEqual({
      type: 'permission-response',
      requestId: 'perm-1',
      approved: true,
    });
  });
});
