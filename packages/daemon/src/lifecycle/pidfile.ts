import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function pidPath(baseDir?: string): string {
  return join(baseDir ?? homedir(), '.agent-squad', 'agent-squadd.pid');
}

export function readPid(baseDir?: string): number | null {
  const p = pidPath(baseDir);
  if (!existsSync(p)) return null;
  const n = Number.parseInt(readFileSync(p, 'utf8').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

export function writePid(pid: number, baseDir?: string): void {
  const base = baseDir ?? homedir();
  mkdirSync(join(base, '.agent-squad'), { recursive: true });
  writeFileSync(pidPath(base), String(pid), { mode: 0o600 });
}

export function removePid(baseDir?: string): void {
  const p = pidPath(baseDir);
  if (existsSync(p)) unlinkSync(p);
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
