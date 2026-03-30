import { describe, it, expect } from 'vitest';
import { DefaultTransport } from './DefaultTransport.js';

describe('DefaultTransport', () => {
  const transport = new DefaultTransport('test-agent');

  it('should have correct agent name', () => {
    expect(transport.agentName).toBe('test-agent');
  });

  it('should return 60s init timeout', () => {
    expect(transport.getInitTimeout()).toBe(60_000);
  });

  it('should filter non-JSON stdout lines', () => {
    expect(transport.filterStdoutLine('debug: something')).toBeNull();
    expect(transport.filterStdoutLine('')).toBeNull();
    expect(transport.filterStdoutLine('  ')).toBeNull();
  });

  it('should pass valid JSON lines', () => {
    expect(transport.filterStdoutLine('{"type":"test"}')).toBe('{"type":"test"}');
    expect(transport.filterStdoutLine('[1,2,3]')).toBe('[1,2,3]');
  });

  it('should filter invalid JSON that looks like JSON', () => {
    expect(transport.filterStdoutLine('{invalid json}')).toBeNull();
  });

  it('should return empty tool patterns', () => {
    expect(transport.getToolPatterns()).toEqual([]);
  });

  it('should return 2min default tool call timeout', () => {
    expect(transport.getToolCallTimeout('any')).toBe(120_000);
  });

  it('should return 30s think timeout', () => {
    expect(transport.getToolCallTimeout('any', 'think')).toBe(30_000);
  });

  it('should not identify investigation tools', () => {
    expect(transport.isInvestigationTool('any')).toBe(false);
  });

  it('should pass through tool name', () => {
    expect(transport.determineToolName('Read', 'c1', {}, {
      recentPromptHadChangeTitle: false,
      toolCallCountSincePrompt: 0,
    })).toBe('Read');
  });
});
