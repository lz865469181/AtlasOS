import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class LogWriter {
  private logDir: string;
  private logFile: string;

  constructor(logDir?: string) {
    this.logDir = logDir ?? join(homedir(), '.atlasOS', 'app-logs');
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
    const date = new Date().toISOString().slice(0, 10);
    this.logFile = join(this.logDir, `${date}.log`);
  }

  write(formatted: string): void {
    console.log(formatted);
    appendFileSync(this.logFile, formatted + '\n');
  }
}
