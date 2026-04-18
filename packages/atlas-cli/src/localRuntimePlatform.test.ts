import { describe, expect, it } from 'vitest';
import {
  resolveLocalRuntimeTransport,
  supportsReusableTmuxSessions,
} from './localRuntimePlatform.js';

describe('localRuntimePlatform', () => {
  it('uses pty transport on Windows', () => {
    expect(resolveLocalRuntimeTransport('win32')).toBe('pty');
  });

  it('uses tmux transport on Unix-like platforms', () => {
    expect(resolveLocalRuntimeTransport('linux')).toBe('tmux');
    expect(resolveLocalRuntimeTransport('darwin')).toBe('tmux');
  });

  it('only allows tmux session discovery and adoption on tmux platforms', () => {
    expect(supportsReusableTmuxSessions('win32')).toBe(false);
    expect(supportsReusableTmuxSessions('linux')).toBe(true);
  });
});
