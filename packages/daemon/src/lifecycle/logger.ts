import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function logPath(baseDir?: string): string {
  return join(baseDir ?? homedir(), '.agent-squad', 'agent-squadd.log');
}

export function logLine(msg: string, baseDir?: string): void {
  const line = `${new Date().toISOString()} ${msg}\n`;
  const base = baseDir ?? homedir();
  mkdirSync(join(base, '.agent-squad'), { recursive: true });
  appendFileSync(logPath(base), line);
}
