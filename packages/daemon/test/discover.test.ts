import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverAll } from '../src/cli/discover.js';
import { installCli } from '../src/cli/installers.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'asq-discover-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('discoverAll — Kimi Code', () => {
  it('detects the kimi binary and its MCP config', async () => {
    const bin = join(tmp, 'bin');
    const home = join(tmp, 'home');
    mkdirSync(bin, { recursive: true });
    const kimi = join(bin, 'kimi');
    symlinkSync(process.execPath, kimi);
    await installCli('kimi', { homeDir: home });

    const results = await discoverAll({ homeDir: home, env: { ...process.env, PATH: bin } });
    expect(results.find((result) => result.cli === 'kimi-code')).toEqual({
      cli: 'kimi-code',
      available: true,
      version: process.version,
      path: 'kimi',
      mcpConfigured: true,
      configPath: join(home, '.kimi-code', 'mcp.json'),
    });
  });
});
