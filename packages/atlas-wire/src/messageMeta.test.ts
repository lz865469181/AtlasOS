import { describe, it, expect } from 'vitest';
import { MessageMetaSchema } from './messageMeta.js';

describe('MessageMetaSchema', () => {
  it('should parse valid full metadata', () => {
    const input = {
      sentFrom: 'feishu',
      permissionMode: 'yolo',
      model: 'claude-sonnet-4-5-20250514',
      allowedTools: ['Read', 'Write'],
    };
    const result = MessageMetaSchema.parse(input);
    expect(result.permissionMode).toBe('yolo');
    expect(result.allowedTools).toEqual(['Read', 'Write']);
  });

  it('should parse empty object', () => {
    const result = MessageMetaSchema.parse({});
    expect(result).toEqual({});
  });

  it('should reject invalid permission mode', () => {
    expect(() => MessageMetaSchema.parse({ permissionMode: 'invalid' })).toThrow();
  });

  it('should accept all 7 permission modes', () => {
    const modes = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'read-only', 'safe-yolo', 'yolo'];
    for (const mode of modes) {
      expect(() => MessageMetaSchema.parse({ permissionMode: mode })).not.toThrow();
    }
  });
});
