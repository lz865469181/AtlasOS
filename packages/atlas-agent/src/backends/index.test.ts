import { describe, expect, it } from 'vitest';
import { agentRegistry } from '../core/AgentRegistry.js';
import './index.js';

describe('built-in backends', () => {
  it('registers both claude and codex managed backends', () => {
    expect(agentRegistry.has('claude')).toBe(true);
    expect(agentRegistry.has('codex')).toBe(true);
  });
});
