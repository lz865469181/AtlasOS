import { describe, it, expect } from 'vitest';
import { sessionEventSchema, sessionEnvelopeSchema, createEnvelope } from './sessionProtocol.js';

describe('sessionEventSchema', () => {
  it('should parse all 9 event types', () => {
    const events = [
      { t: 'text', text: 'hi' },
      { t: 'service', text: 'info' },
      { t: 'tool-call-start', call: 'c', name: 'n', title: 't', description: 'd', args: {} },
      { t: 'tool-call-end', call: 'c' },
      { t: 'file', ref: 'r', name: 'n', size: 100 },
      { t: 'turn-start' },
      { t: 'start' },
      { t: 'turn-end', status: 'completed' },
      { t: 'stop' },
    ];
    for (const ev of events) {
      expect(() => sessionEventSchema.parse(ev)).not.toThrow();
    }
  });
  it('should reject unknown type', () => {
    expect(() => sessionEventSchema.parse({ t: 'unknown' })).toThrow();
  });
});

describe('sessionEnvelopeSchema', () => {
  it('should parse valid envelope', () => {
    const env = sessionEnvelopeSchema.parse({ id: 'test', time: Date.now(), role: 'user', ev: { t: 'text', text: 'hello' } });
    expect(env.role).toBe('user');
  });
  it('should reject service event with user role', () => {
    expect(() => sessionEnvelopeSchema.parse({ id: 'test', time: Date.now(), role: 'user', ev: { t: 'service', text: 'info' } })).toThrow();
  });
  it('should reject start event with user role', () => {
    expect(() => sessionEnvelopeSchema.parse({ id: 'test', time: Date.now(), role: 'user', ev: { t: 'start' } })).toThrow();
  });
});

describe('createEnvelope', () => {
  it('should create with defaults', () => {
    const env = createEnvelope('agent', { t: 'text', text: 'hello' });
    expect(env.id).toBeDefined();
    expect(env.role).toBe('agent');
  });
  it('should accept custom id and time', () => {
    const env = createEnvelope('user', { t: 'text', text: 'hi' }, { id: 'custom', time: 12345 });
    expect(env.id).toBe('custom');
    expect(env.time).toBe(12345);
  });
});
