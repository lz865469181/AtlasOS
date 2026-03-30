import { describe, it, expect } from 'vitest';
import { SessionControlEventSchema } from './sessionControl.js';

describe('SessionControlEventSchema', () => {
  it('should parse create', () => {
    const ev = SessionControlEventSchema.parse({ type: 'session-create', sessionId: 's-1', agentId: 'claude', cwd: '/ws' });
    expect(ev.type).toBe('session-create');
  });
  it('should parse pause', () => {
    expect(SessionControlEventSchema.parse({ type: 'session-pause', sessionId: 's-1' }).type).toBe('session-pause');
  });
  it('should parse resume', () => {
    expect(SessionControlEventSchema.parse({ type: 'session-resume', sessionId: 's-1' }).type).toBe('session-resume');
  });
  it('should parse destroy', () => {
    const ev = SessionControlEventSchema.parse({ type: 'session-destroy', sessionId: 's-1', reason: 'user' });
    expect(ev.type).toBe('session-destroy');
  });
  it('should reject unknown type', () => {
    expect(() => SessionControlEventSchema.parse({ type: 'session-unknown', sessionId: 's-1' })).toThrow();
  });
});
