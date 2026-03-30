import { describe, it, expect } from 'vitest';
import { SessionMessageSchema, MessageContentSchema, CoreUpdateBodySchema, CoreUpdateContainerSchema } from './messages.js';

describe('SessionMessageSchema', () => {
  it('should parse valid session message', () => {
    const msg = SessionMessageSchema.parse({
      id: 'msg-1', seq: 1, content: { c: 'data', t: 'encrypted' }, createdAt: 0, updatedAt: 0,
    });
    expect(msg.content.t).toBe('encrypted');
  });
  it('should accept null localId', () => {
    const msg = SessionMessageSchema.parse({
      id: 'msg-1', seq: 1, localId: null, content: { c: 'data', t: 'encrypted' }, createdAt: 0, updatedAt: 0,
    });
    expect(msg.localId).toBeNull();
  });
});

describe('MessageContentSchema', () => {
  it('should parse user message', () => {
    const r = MessageContentSchema.parse({ role: 'user', content: { type: 'text', text: 'Hello' } });
    expect(r.role).toBe('user');
  });
  it('should parse agent message', () => {
    const r = MessageContentSchema.parse({ role: 'agent', content: { type: 'model-output' } });
    expect(r.role).toBe('agent');
  });
  it('should parse session protocol message', () => {
    const r = MessageContentSchema.parse({
      role: 'session', content: { id: 'env-1', time: Date.now(), role: 'agent', ev: { t: 'text', text: 'hello' } },
    });
    expect(r.role).toBe('session');
  });
});

describe('CoreUpdateBodySchema', () => {
  it('should parse new-message', () => {
    const body = CoreUpdateBodySchema.parse({
      t: 'new-message', sid: 's-1',
      message: { id: 'msg-1', seq: 1, content: { c: 'data', t: 'encrypted' }, createdAt: 0, updatedAt: 0 },
    });
    expect(body.t).toBe('new-message');
  });
  it('should parse update-session', () => {
    const body = CoreUpdateBodySchema.parse({ t: 'update-session', id: 's-1' });
    expect(body.t).toBe('update-session');
  });
});

describe('CoreUpdateContainerSchema', () => {
  it('should parse full container', () => {
    const c = CoreUpdateContainerSchema.parse({
      id: 'u-1', seq: 42, body: { t: 'update-session', id: 's-1' }, createdAt: Date.now(),
    });
    expect(c.seq).toBe(42);
  });
});
