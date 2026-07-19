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
  { name: 'kimi-code', binary: 'kimi', installable: 'kimi' },
];

const DETECT_TIMEOUT_MS = 2_000;

function detectVersion(binary: string, env: NodeJS.ProcessEnv): Promise<{ available: boolean; version: string | null; path: string | null }> {
  return new Promise((resolve) => {
    const child = spawn(binary, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '';
    let settled = false;
    const finish = (result: { available: boolean; version: string | null; path: string | null }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ available: false, version: null, path: null });
    }, DETECT_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('error', () => finish({ available: false, version: null, path: null }));
    child.on('close', (code) => {
      finish({
        available: code === 0,
        version: out.trim() || null,
        path: code === 0 ? binary : null,
      });
    });
  });
}

export async function discoverAll(opts?: { homeDir?: string; env?: NodeJS.ProcessEnv }): Promise<DiscoverResult[]> {
  return Promise.all(CLIS.map(async (cli): Promise<DiscoverResult> => {
    const det = await detectVersion(cli.binary, opts?.env ?? process.env);
    return {
      cli: cli.name,
      available: det.available,
      version: det.version,
      path: det.path,
      mcpConfigured: isMcpConfigured(cli.installable, opts),
      configPath: configPathForCli(cli.installable, opts),
    };
  }));
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
