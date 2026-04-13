import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function resolveLogDir(): string {
  const explicit = process.env.CODELINK_APP_LOGS_DIR ?? process.env.ATLAS_APP_LOGS_DIR;
  if (explicit) {
    return explicit;
  }

  const codeLinkHome = join(homedir(), '.codelink');
  const atlasHome = join(homedir(), '.atlasOS');
  const homeRoot = existsSync(codeLinkHome) ? codeLinkHome : (existsSync(atlasHome) ? atlasHome : codeLinkHome);
  return join(homeRoot, 'app-logs');
}

export class LogWriter {
  private logDir: string;
  private logFile: string;

  constructor(logDir?: string) {
    this.logDir = logDir ?? resolveLogDir();
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
