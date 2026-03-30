export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  source: string;
  platform?: string;
}

export function formatLogEntry(entry: LogEntry): string {
  const date = new Date(entry.timestamp);
  const time = [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join(':') + '.' + String(date.getMilliseconds()).padStart(3, '0');

  const source = entry.platform
    ? `${entry.source}/${entry.platform}`
    : entry.source;

  return `[${time}] [${entry.level}] [${source}] ${entry.message}`;
}
