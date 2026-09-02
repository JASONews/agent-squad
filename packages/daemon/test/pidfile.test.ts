import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pidPath, readPid, writePid, removePid } from '../src/lifecycle/pidfile.js';

let base: string;
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'asq-pid-')); });
afterEach(() => { rmSync(base, { recursive: true, force: true }); });

describe('pidfile (injected baseDir)', () => {
  it('writePid then readPid round-trips', () => {
    writePid(12345, base);
    expect(readPid(base)).toBe(12345);
  });
  it('pidPath is under baseDir', () => {
    expect(pidPath(base)).toBe(join(base, '.agent-squad', 'agent-squadd.pid'));
  });
  it('readPid returns null when no pidfile', () => {
    expect(readPid(base)).toBeNull();
  });
  it('writePid creates the .agent-squad dir', () => {
    writePid(1, base);
    expect(existsSync(join(base, '.agent-squad', 'agent-squadd.pid'))).toBe(true);
  });
  it('removePid removes the file', () => {
    writePid(99, base);
    removePid(base);
    expect(readPid(base)).toBeNull();
  });
  it('removePid is a no-op when absent', () => {
    expect(() => removePid(base)).not.toThrow();
  });
  it('readPid tolerates a corrupt pidfile (returns null)', () => {
    writePid(1, base);
    writeFileSync(pidPath(base), 'not-a-number');
    expect(readPid(base)).toBeNull();
  });
});
