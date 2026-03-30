import { describe, it, expect } from 'vitest';
import { UserMessageSchema, AgentMessageSchema, LegacyMessageContentSchema } from './legacyProtocol.js';

describe('UserMessageSchema', () => {
  it('should parse valid user message', () => {
    const result = UserMessageSchema.parse({
      role: 'user',
      content: { type: 'text', text: 'Hello' },
    });
    expect(result.content.text).toBe('Hello');
  });

  it('should parse with meta', () => {
    const result = UserMessageSchema.parse({
      role: 'user',
      content: { type: 'text', text: 'Hi' },
      localKey: 'local-123',
      meta: { permissionMode: 'yolo' },
    });
    expect(result.meta?.permissionMode).toBe('yolo');
  });

  it('should reject non-user role', () => {
    expect(() => UserMessageSchema.parse({ role: 'agent', content: { type: 'text', text: 'Hi' } })).toThrow();
  });
});

describe('AgentMessageSchema', () => {
  it('should parse with passthrough content', () => {
    const result = AgentMessageSchema.parse({
      role: 'agent',
      content: { type: 'model-output', textDelta: 'Hello', extra: 42 },
    });
    expect(result.content.type).toBe('model-output');
  });
});

describe('LegacyMessageContentSchema', () => {
  it('should discriminate by role', () => {
    const user = LegacyMessageContentSchema.parse({ role: 'user', content: { type: 'text', text: 'test' } });
    expect(user.role).toBe('user');
    const agent = LegacyMessageContentSchema.parse({ role: 'agent', content: { type: 'status' } });
    expect(agent.role).toBe('agent');
  });
});
