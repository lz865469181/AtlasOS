import { describe, it, expect } from 'vitest';
import {
  isModelOutputMessage, isStatusMessage, isToolCallMessage,
  isPermissionRequestMessage, getMessageText,
  type AgentMessage, type ModelOutputMessage,
} from './AgentMessage.js';

describe('AgentMessage type guards', () => {
  it('isModelOutputMessage', () => {
    const msg: AgentMessage = { type: 'model-output', textDelta: 'hi' };
    expect(isModelOutputMessage(msg)).toBe(true);
    expect(isStatusMessage(msg)).toBe(false);
  });

  it('isStatusMessage', () => {
    const msg: AgentMessage = { type: 'status', status: 'running' };
    expect(isStatusMessage(msg)).toBe(true);
  });

  it('isToolCallMessage', () => {
    const msg: AgentMessage = { type: 'tool-call', toolName: 'Read', args: {}, callId: 'c1' };
    expect(isToolCallMessage(msg)).toBe(true);
  });

  it('isPermissionRequestMessage', () => {
    const msg: AgentMessage = { type: 'permission-request', id: 'p1', reason: 'test', payload: {} };
    expect(isPermissionRequestMessage(msg)).toBe(true);
  });

  it('accepts command lifecycle messages in the shared union', () => {
    const started: AgentMessage = {
      type: 'command-start',
      commandId: 'cmd-1',
      command: 'npm test',
      cwd: '/repo',
    };
    const exited: AgentMessage = {
      type: 'command-exit',
      commandId: 'cmd-1',
      exitCode: 0,
    };
    const cwdChanged: AgentMessage = {
      type: 'cwd-change',
      cwd: '/repo/packages/gateway',
    };

    expect(started.type).toBe('command-start');
    expect(exited.type).toBe('command-exit');
    expect(cwdChanged.type).toBe('cwd-change');
  });
});

describe('getMessageText', () => {
  it('should return textDelta', () => {
    const msg: ModelOutputMessage = { type: 'model-output', textDelta: 'hello' };
    expect(getMessageText(msg)).toBe('hello');
  });

  it('should return fullText when no delta', () => {
    const msg: ModelOutputMessage = { type: 'model-output', fullText: 'complete' };
    expect(getMessageText(msg)).toBe('complete');
  });

  it('should return empty string when no text', () => {
    const msg: ModelOutputMessage = { type: 'model-output' };
    expect(getMessageText(msg)).toBe('');
  });
});
