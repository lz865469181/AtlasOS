import { describe, it, expect } from 'vitest';
import { AgentRegistry } from './AgentRegistry.js';
import type { AgentBackend } from './AgentBackend.js';

function createMockBackend(): AgentBackend {
  return {
    startSession: async () => ({ sessionId: 'mock-session' }),
    sendPrompt: async () => {},
    cancel: async () => {},
    onMessage: () => {},
    dispose: async () => {},
  };
}

describe('AgentRegistry', () => {
  it('should register and create agents', () => {
    const registry = new AgentRegistry();
    registry.register('claude', () => createMockBackend());
    expect(registry.has('claude')).toBe(true);
    const backend = registry.create('claude', { cwd: '/tmp' });
    expect(backend).toBeDefined();
  });

  it('should list registered agents', () => {
    const registry = new AgentRegistry();
    registry.register('claude', () => createMockBackend());
    registry.register('gemini', () => createMockBackend());
    expect(registry.list()).toEqual(['claude', 'gemini']);
  });

  it('should throw on unknown agent', () => {
    const registry = new AgentRegistry();
    expect(() => registry.create('codex', { cwd: '/tmp' })).toThrow('Unknown agent: codex');
  });

  it('should report has=false for unregistered', () => {
    const registry = new AgentRegistry();
    expect(registry.has('claude')).toBe(false);
  });
});
