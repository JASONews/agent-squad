import { spawn } from 'node:child_process';
import { isMcpConfigured, configPathForCli, type InstallableCli } from './installers.js';

export interface DiscoverResult {
  cli: string;
  available: boolean;
  version: string | null;
  path: string | null;
  mcpConfigured: boolean;
  configPath: string;
}

const CLIS: { name: string; binary: string; installable: InstallableCli }[] = [
  { name: 'codex', binary: 'codex', installable: 'codex' },
  { name: 'opencode', binary: 'opencode', installable: 'opencode' },
  { name: 'antigravity (agy)', binary: 'agy', installable: 'antigravity' },
  { name: 'claude-code', binary: 'claude', installable: 'claude' },
];

function detectVersion(binary: string): Promise<{ available: boolean; version: string | null; path: string | null }> {
  return new Promise((resolve) => {
    const child = spawn(binary, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', () => resolve({ available: false, version: null, path: null }));
    child.on('close', (code) => {
      resolve({
        available: code === 0,
        version: out.trim() || null,
        path: binary,
      });
    });
  });
}

export async function discoverAll(opts?: { homeDir?: string }): Promise<DiscoverResult[]> {
  const results: DiscoverResult[] = [];
  for (const cli of CLIS) {
    const det = await detectVersion(cli.binary);
    results.push({
      cli: cli.name,
      available: det.available,
      version: det.version,
      path: det.path,
      mcpConfigured: isMcpConfigured(cli.installable, opts),
      configPath: configPathForCli(cli.installable, opts),
    });
  }
  return results;
}

export function formatDiscoverTable(results: DiscoverResult[]): string {
  const lines: string[] = ['CLI Discovery:', ''];
  for (const r of results) {
    const status = r.available ? '✓ available' : '✗ not found';
    const mcp = r.mcpConfigured ? 'MCP configured' : 'MCP not configured';
    const ver = r.version ? ` (${r.version})` : '';
    lines.push(`  ${r.cli}: ${status}${ver} — ${mcp}`);
  }
  return lines.join('\n');
}
