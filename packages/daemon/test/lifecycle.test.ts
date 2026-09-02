import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePid, readPid } from '../src/lifecycle/pidfile.js';
import { daemonStatus, daemonStop } from '../src/cli/daemon.js';

let base: string;
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'asq-life-')); });
afterEach(() => { rmSync(base, { recursive: true, force: true }); });

describe('daemon lifecycle (injected baseDir)', () => {
  it('daemonStop removes a stale pidfile (pid not alive)', () => {
    writePid(999999, base); // a pid that is definitely not alive
    expect(readPid(base)).toBe(999999);
    // daemonStop reads pid; if not alive, removes pidfile
    return daemonStop(base).then(() => {
      expect(readPid(base)).toBeNull();
    });
  });
  it('daemonStatus reports alive:false when no pidfile', async () => {
    // capture stderr: daemonStatus writes via console.error, which vitest routes
    // independently of process.stderr.write — so override console.error itself.
    const orig = console.error;
    let captured = '';
    console.error = (...args: unknown[]) => { captured += args.join(' ') + '\n'; };
    try {
      await daemonStatus(base);
    } finally {
      console.error = orig;
    }
    expect(captured).toContain('alive: false');
  });
});
