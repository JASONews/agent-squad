import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');

describe('skills/install.sh', () => {
  it('installs Claude Code instructions as a skill without writing CLAUDE.md', () => {
    const home = mkdtempSync(join(tmpdir(), 'asq-skills-install-'));
    try {
      const result = spawnSync('bash', ['skills/install.sh', 'claude-code'], {
        cwd: repoRoot,
        env: { ...process.env, HOME: home },
        encoding: 'utf8',
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(existsSync(join(home, '.claude', 'skills', 'agent-squad', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(home, '.claude', 'CLAUDE.md'))).toBe(false);
      expect(result.stdout).not.toContain('CLAUDE.md');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
