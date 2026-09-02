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
    expect(cfg.subagents?.codex.modelProfiles).toEqual({});
    expect(cfg.subagents?.opencode.modelProfiles).toEqual({});
    expect(cfg.subagents?.antigravity.modelProfiles).toEqual({});
    expect(cfg.subagents?.claude.modelProfiles).toEqual({});
    expect(cfg.subagents?.kimi.modelProfiles).toEqual({});
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

  it('loads model capability overrides with effort-specific details', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'as-'));
    writeFileSync(join(dir, 'agent-squad.yml'), [
      'subagents:',
      '  codex:',
      '    model_profiles:',
      '      "gpt-5.6-luna":',
      '        summary: Team default for routine work',
      '        strengths: [basic implementation, bug fixes]',
      '        weaknesses: [high-risk architecture]',
      '        recommended_for: [implementation, testing]',
      '        avoid_for: [security review]',
      '        cost_tier: low',
      '        latency_tier: fast',
      '        priority: 97',
      '        effort_profiles:',
      '          max:',
      '            summary: Use when routine work needs extra care',
      '            priority: 99',
      '',
    ].join('\n'));
    try {
      const cfg = await loadConfig({ cwd: dir, home: '/nonexistent' });
      expect(cfg.subagents?.codex.modelProfiles).toEqual({
        'gpt-5.6-luna': {
          summary: 'Team default for routine work',
          strengths: ['basic implementation', 'bug fixes'],
          weaknesses: ['high-risk architecture'],
          recommendedFor: ['implementation', 'testing'],
          avoidFor: ['security review'],
          costTier: 'low',
          latencyTier: 'fast',
          priority: 97,
          effortProfiles: {
            max: {
              summary: 'Use when routine work needs extra care',
              priority: 99,
            },
          },
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid model capability override values', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'as-'));
    writeFileSync(join(dir, 'agent-squad.yml'), [
      'subagents:',
      '  kimi:',
      '    model_profiles:',
      '      "*":',
      '        priority: 101',
      '',
    ].join('\n'));
    try {
      await expect(loadConfig({ cwd: dir, home: '/nonexistent' }))
        .rejects.toThrow(/invalid config/);
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
