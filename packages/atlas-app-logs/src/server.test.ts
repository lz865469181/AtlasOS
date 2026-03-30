import { describe, it, expect } from 'vitest';
import { formatLogEntry, type LogEntry } from './format.js';

describe('formatLogEntry', () => {
  it('should format log entry', () => {
    const entry: LogEntry = {
      timestamp: '2026-03-30T10:30:45.123Z',
      level: 'INFO',
      message: 'Server started',
      source: 'gateway',
      platform: 'feishu',
    };
    const result = formatLogEntry(entry);
    expect(result).toContain('[INFO]');
    expect(result).toContain('[gateway/feishu]');
    expect(result).toContain('Server started');
  });

  it('should handle missing platform', () => {
    const entry: LogEntry = {
      timestamp: '2026-03-30T10:30:45.123Z',
      level: 'ERROR',
      message: 'Failed',
      source: 'agent',
    };
    const result = formatLogEntry(entry);
    expect(result).toContain('[agent]');
    expect(result).not.toContain('undefined');
  });
});
