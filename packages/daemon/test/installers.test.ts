import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installCli, isMcpConfigured, configPathForCli, type InstallableCli } from '../src/cli/installers.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'asq-install-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

function mkdirp(p: string) { mkdirSync(p, { recursive: true }); }

describe('installCli — codex (TOML)', () => {
  it('installs into a fresh config', async () => {
    mkdirp(join(home, '.codex'));
    const r = await installCli('codex', { homeDir: home });
    expect(r.action).toBe('installed');
    const content = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    expect(content).toContain('[mcp_servers."agent-squad"]');
    expect(content).toContain('command = "agent-squad-mcp"');
  });
  it('creates the config when missing', async () => {
    const r = await installCli('codex', { homeDir: home });
    expect(r.action).toBe('installed');
    expect(existsSync(join(home, '.codex', 'config.toml'))).toBe(true);
  });
  it('is idempotent (already-present on second run)', async () => {
    mkdirp(join(home, '.codex'));
    await installCli('codex', { homeDir: home });
    const r2 = await installCli('codex', { homeDir: home });
    expect(r2.action).toBe('already-present');
  });
  it('backs up the original before modifying', async () => {
    mkdirp(join(home, '.codex'));
    writeFileSync(join(home, '.codex', 'config.toml'), 'existing = true\n');
    await installCli('codex', { homeDir: home });
    expect(existsSync(join(home, '.codex', 'config.toml.bak'))).toBe(true);
    expect(readFileSync(join(home, '.codex', 'config.toml.bak'), 'utf8')).toBe('existing = true\n');
  });
  it('preserves existing content', async () => {
    mkdirp(join(home, '.codex'));
    writeFileSync(join(home, '.codex', 'config.toml'), 'model = "o3"\n');
    await installCli('codex', { homeDir: home });
    const content = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    expect(content).toContain('model = "o3"');
    expect(content).toContain('[mcp_servers."agent-squad"]');
  });
});

describe('installCli — opencode (JSON)', () => {
  it('installs into a fresh config', async () => {
    const r = await installCli('opencode', { homeDir: home });
    expect(r.action).toBe('installed');
    const content = JSON.parse(readFileSync(join(home, '.config', 'opencode', 'opencode.json'), 'utf8'));
    expect(content.mcp['agent-squad']).toEqual({ enabled: true, type: 'local', command: ['agent-squad-mcp'] });
  });
  it('is idempotent', async () => {
    await installCli('opencode', { homeDir: home });
    const r2 = await installCli('opencode', { homeDir: home });
    expect(r2.action).toBe('already-present');
  });
  it('preserves existing mcp entries', async () => {
    mkdirp(join(home, '.config', 'opencode'));
    writeFileSync(join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({ mcp: { "other-server": { enabled: true } } }));
    await installCli('opencode', { homeDir: home });
    const content = JSON.parse(readFileSync(join(home, '.config', 'opencode', 'opencode.json'), 'utf8'));
    expect(content.mcp['other-server']).toBeDefined();
    expect(content.mcp['agent-squad']).toBeDefined();
  });
});

describe('installCli — antigravity (JSON)', () => {
  it('installs into a fresh config', async () => {
    const r = await installCli('antigravity', { homeDir: home });
    expect(r.action).toBe('installed');
    const content = JSON.parse(readFileSync(join(home, '.gemini', 'config', 'mcp_config.json'), 'utf8'));
    expect(content.mcpServers['agent-squad']).toEqual({ command: 'agent-squad-mcp' });
  });
  it('preserves existing global servers and refuses to replace malformed data', async () => {
    const path = configPathForCli('antigravity', { homeDir: home });
    mkdirp(join(home, '.gemini', 'config'));
    writeFileSync(path, '{');
    expect((await installCli('antigravity', { homeDir: home })).action).toBe('failed');
    expect(readFileSync(path, 'utf8')).toBe('{');
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: 'other' } } }));
    await installCli('antigravity', { homeDir: home });
    expect(JSON.parse(readFileSync(path, 'utf8')).mcpServers.other.command).toBe('other');
    expect(isMcpConfigured('antigravity', { homeDir: home })).toBe(true);
  });
  it('is idempotent', async () => {
    await installCli('antigravity', { homeDir: home });
    const r2 = await installCli('antigravity', { homeDir: home });
    expect(r2.action).toBe('already-present');
  });
});

describe('installCli — claude (JSON)', () => {
  it('installs into a fresh config', async () => {
    const r = await installCli('claude', { homeDir: home });
    expect(r.action).toBe('installed');
    const content = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
    expect(content.mcpServers['agent-squad']).toEqual({ command: 'agent-squad-mcp' });
  });
  it('is idempotent', async () => {
    await installCli('claude', { homeDir: home });
    const r2 = await installCli('claude', { homeDir: home });
    expect(r2.action).toBe('already-present');
  });
});

describe('installCli — Kimi Code (JSON)', () => {
  it('installs into ~/.kimi-code/mcp.json and preserves existing servers', async () => {
    mkdirp(join(home, '.kimi-code'));
    writeFileSync(join(home, '.kimi-code', 'mcp.json'), JSON.stringify({
      mcpServers: { existing: { command: 'existing-mcp' } },
      setting: true,
    }));
    const r = await installCli('kimi', { homeDir: home, env: {} });
    expect(r.action).toBe('installed');
    const content = JSON.parse(readFileSync(join(home, '.kimi-code', 'mcp.json'), 'utf8'));
    expect(content.mcpServers.existing).toEqual({ command: 'existing-mcp' });
    expect(content.mcpServers['agent-squad']).toEqual({ command: 'agent-squad-mcp' });
    expect(content.setting).toBe(true);
    expect(existsSync(join(home, '.kimi-code', 'mcp.json.bak'))).toBe(true);
  });

  it('is idempotent', async () => {
    await installCli('kimi', { homeDir: home, env: {} });
    expect((await installCli('kimi', { homeDir: home, env: {} })).action).toBe('already-present');
  });

  it('respects KIMI_CODE_HOME', async () => {
    const kimiHome = join(home, 'custom-kimi-home');
    const opts = { homeDir: home, env: { KIMI_CODE_HOME: kimiHome } };
    const result = await installCli('kimi', opts);

    expect(result.configPath).toBe(join(kimiHome, 'mcp.json'));
    expect(configPathForCli('kimi', opts)).toBe(join(kimiHome, 'mcp.json'));
    expect(isMcpConfigured('kimi', opts)).toBe(true);
  });

  it('treats an empty KIMI_CODE_HOME as unset', () => {
    expect(configPathForCli('kimi', { homeDir: home, env: { KIMI_CODE_HOME: '' } }))
      .toBe(join(home, '.kimi-code', 'mcp.json'));
  });
});

describe('isMcpConfigured', () => {
  it('returns false before install, true after', async () => {
    expect(isMcpConfigured('codex', { homeDir: home })).toBe(false);
    await installCli('codex', { homeDir: home });
    expect(isMcpConfigured('codex', { homeDir: home })).toBe(true);
  });
  it('returns false for missing config files', () => {
    expect(isMcpConfigured('opencode', { homeDir: home })).toBe(false);
  });
});

describe('configPathForCli', () => {
  it('returns the right path per CLI', () => {
    expect(configPathForCli('codex', { homeDir: home })).toBe(join(home, '.codex', 'config.toml'));
    expect(configPathForCli('opencode', { homeDir: home })).toBe(join(home, '.config', 'opencode', 'opencode.json'));
    expect(configPathForCli('antigravity', { homeDir: home })).toBe(join(home, '.gemini', 'config', 'mcp_config.json'));
    expect(configPathForCli('claude', { homeDir: home })).toBe(join(home, '.claude.json'));
    expect(configPathForCli('kimi', { homeDir: home, env: {} })).toBe(join(home, '.kimi-code', 'mcp.json'));
  });
});
