import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config/loader.js';

describe('loadConfig', () => {
  it('uses repo-local agent-squad.yml when present', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'as-'));
    writeFileSync(join(dir, 'agent-squad.yml'),
      'server:\n  host: 127.0.0.1\n  port: 9999\n  db_path: ./x.db\n');
    try {
      const cfg = await loadConfig({ cwd: dir, home: '/nonexistent' });
      expect(cfg.server.port).toBe(9999);
      expect(cfg.server.dbPath).toBe('./x.db');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to ~/.agent-squad/config.yml', async () => {
    const home = mkdtempSync(join(tmpdir(), 'as-home-'));
    const dot = join(home, '.agent-squad');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dot, { recursive: true });
    writeFileSync(join(dot, 'config.yml'),
      'server:\n  host: 127.0.0.1\n  port: 7777\n  db_path: ~/.agent-squad/agent-squad.db\n');
    try {
      const cfg = await loadConfig({ cwd: '/nonexistent-repo', home });
      expect(cfg.server.port).toBe(7777);
      expect(cfg.server.dbPath).toBe(join(home, '.agent-squad', 'agent-squad.db'));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('uses defaults when no config file exists', async () => {
    const cfg = await loadConfig({ cwd: '/nonexistent', home: '/nonexistent' });
    expect(cfg.server.host).toBe('127.0.0.1');
    expect(cfg.server.port).toBe(28771);
    expect(cfg.contextPolicy.default).toBe('message_only');
    expect(cfg.subagents?.claude.englishInput).toEqual({
      enabled: true,
      minimumRatio: 0.6,
    });
  });

  it('loads the Claude English input policy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'as-'));
    writeFileSync(join(dir, 'agent-squad.yml'), [
      'subagents:',
      '  claude:',
      '    english_input:',
      '      enabled: false',
      '      minimum_ratio: 0.35',
      '',
    ].join('\n'));
    try {
      const cfg = await loadConfig({ cwd: dir, home: '/nonexistent' });
      expect(cfg.subagents?.claude.englishInput).toEqual({
        enabled: false,
        minimumRatio: 0.35,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an out-of-range Claude English input ratio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'as-'));
    writeFileSync(join(dir, 'agent-squad.yml'), [
      'subagents:',
      '  claude:',
      '    english_input:',
      '      minimum_ratio: 1.1',
      '',
    ].join('\n'));
    try {
      await expect(loadConfig({ cwd: dir, home: '/nonexistent' })).rejects.toThrow(/invalid config/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unknown keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'as-'));
    writeFileSync(join(dir, 'agent-squad.yml'), 'bogus: true\n');
    try {
      await expect(loadConfig({ cwd: dir, home: '/nonexistent' })).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
