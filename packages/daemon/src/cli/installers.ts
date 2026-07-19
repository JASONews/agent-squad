import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export type InstallableCli = 'codex' | 'opencode' | 'antigravity' | 'claude' | 'kimi';

export interface InstallResult {
  cli: InstallableCli;
  action: 'installed' | 'already-present' | 'failed';
  configPath: string;
  message: string;
}

interface InstallerOpts {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

const MCP_SERVER_NAME = 'agent-squad';
const MCP_COMMAND = 'agent-squad-mcp';

function resolveHome(opts?: InstallerOpts): string {
  return opts?.homeDir ?? homedir();
}

function backupFile(path: string): void {
  if (!existsSync(path)) return;
  const bak = `${path}.bak`;
  if (!existsSync(bak)) {
    copyFileSync(path, bak);
  } else {
    copyFileSync(path, `${path}.bak-${Date.now()}`);
  }
}

function safeWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// --- Codex (TOML) ---

function configPathCodex(home: string): string {
  return join(home, '.codex', 'config.toml');
}

function hasCodexMcp(content: string): boolean {
  return content.includes('[mcp_servers.agent-squad]') || content.includes('[mcp_servers."agent-squad"]');
}

function installCodex(home: string): InstallResult {
  const path = configPathCodex(home);
  let content = '';
  try { content = readFileSync(path, 'utf8'); } catch { /* file doesn't exist yet */ }

  if (hasCodexMcp(content)) {
    return { cli: 'codex', action: 'already-present', configPath: path, message: 'agent-squad MCP entry already present in codex config' };
  }

  backupFile(path);
  const block = `\n[mcp_servers."${MCP_SERVER_NAME}"]\ncommand = "${MCP_COMMAND}"\n`;
  safeWrite(path, content + (content.endsWith('\n') || content === '' ? '' : '\n') + block);
  return { cli: 'codex', action: 'installed', configPath: path, message: 'agent-squad MCP configured for codex. Run: agent-squad daemon start' };
}

// --- opencode (JSON) ---

function configPathOpencode(home: string): string {
  return join(home, '.config', 'opencode', 'opencode.json');
}

function installOpencode(home: string): InstallResult {
  const path = configPathOpencode(home);
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(readFileSync(path, 'utf8')); } catch { /* missing or unparseable → start fresh */ }

  const mcp = (config.mcp as Record<string, unknown> | undefined) ?? {};
  if (mcp[MCP_SERVER_NAME]) {
    return { cli: 'opencode', action: 'already-present', configPath: path, message: 'agent-squad MCP entry already present in opencode config' };
  }

  backupFile(path);
  mcp[MCP_SERVER_NAME] = { enabled: true, type: 'local', command: [MCP_COMMAND] };
  config.mcp = mcp;
  safeWrite(path, JSON.stringify(config, null, 2) + '\n');
  return { cli: 'opencode', action: 'installed', configPath: path, message: 'agent-squad MCP configured for opencode. Run: agent-squad daemon start' };
}

// --- Antigravity (JSON settings.json) ---

function configPathAntigravity(home: string): string {
  return join(home, '.gemini', 'antigravity-cli', 'settings.json');
}

function installAntigravity(home: string): InstallResult {
  const path = configPathAntigravity(home);
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(readFileSync(path, 'utf8')); } catch { /* missing → fresh */ }

  const mcpServers = (config.mcpServers as Record<string, unknown> | undefined) ?? {};
  if (mcpServers[MCP_SERVER_NAME]) {
    return { cli: 'antigravity', action: 'already-present', configPath: path, message: 'agent-squad MCP entry already present in antigravity config' };
  }

  backupFile(path);
  mcpServers[MCP_SERVER_NAME] = { command: MCP_COMMAND };
  config.mcpServers = mcpServers;
  safeWrite(path, JSON.stringify(config, null, 2) + '\n');
  return { cli: 'antigravity', action: 'installed', configPath: path, message: 'agent-squad MCP configured for antigravity. Run: agent-squad daemon start' };
}

// --- Claude Code main (.mcp.json at project root or ~/.claude.json) ---

function configPathClaude(home: string): string {
  return join(home, '.claude.json');
}

function installClaude(home: string): InstallResult {
  const path = configPathClaude(home);
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(readFileSync(path, 'utf8')); } catch { /* missing → fresh */ }

  const mcpServers = (config.mcpServers as Record<string, unknown> | undefined) ?? {};
  if (mcpServers[MCP_SERVER_NAME]) {
    return { cli: 'claude', action: 'already-present', configPath: path, message: 'agent-squad MCP entry already present in claude-code config' };
  }

  backupFile(path);
  mcpServers[MCP_SERVER_NAME] = { command: MCP_COMMAND };
  config.mcpServers = mcpServers;
  safeWrite(path, JSON.stringify(config, null, 2) + '\n');
  return { cli: 'claude', action: 'installed', configPath: path, message: 'agent-squad MCP configured for claude-code (main-agent only). Run: agent-squad daemon start' };
}

// --- Kimi Code (JSON) ---

function configPathKimi(home: string, env: NodeJS.ProcessEnv): string {
  const configuredHome = env.KIMI_CODE_HOME;
  const kimiHome = configuredHome?.trim() ? configuredHome : join(home, '.kimi-code');
  return join(kimiHome, 'mcp.json');
}

function installKimi(home: string, env: NodeJS.ProcessEnv): InstallResult {
  const path = configPathKimi(home, env);
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(readFileSync(path, 'utf8')); } catch { /* missing or unparseable -> start fresh */ }

  const mcpServers = (config.mcpServers as Record<string, unknown> | undefined) ?? {};
  if (mcpServers[MCP_SERVER_NAME]) {
    return { cli: 'kimi', action: 'already-present', configPath: path, message: 'agent-squad MCP entry already present in Kimi Code config' };
  }

  backupFile(path);
  mcpServers[MCP_SERVER_NAME] = { command: MCP_COMMAND };
  config.mcpServers = mcpServers;
  safeWrite(path, JSON.stringify(config, null, 2) + '\n');
  return { cli: 'kimi', action: 'installed', configPath: path, message: 'agent-squad MCP configured for Kimi Code. Run: agent-squad daemon start' };
}

// --- Public API ---

export async function installCli(cli: InstallableCli, opts?: InstallerOpts): Promise<InstallResult> {
  const home = resolveHome(opts);
  const env = opts?.env ?? process.env;
  switch (cli) {
    case 'codex': return installCodex(home);
    case 'opencode': return installOpencode(home);
    case 'antigravity': return installAntigravity(home);
    case 'claude': return installClaude(home);
    case 'kimi': return installKimi(home, env);
  }
}

// --- MCP config check (for discover/doctor) ---

export function isMcpConfigured(cli: InstallableCli, opts?: InstallerOpts): boolean {
  const home = resolveHome(opts);
  const env = opts?.env ?? process.env;
  try {
    switch (cli) {
      case 'codex': return hasCodexMcp(readFileSync(configPathCodex(home), 'utf8'));
      case 'opencode': {
        const c = JSON.parse(readFileSync(configPathOpencode(home), 'utf8'));
        return !!((c.mcp as Record<string, unknown> | undefined)?.[MCP_SERVER_NAME]);
      }
      case 'antigravity': {
        const c = JSON.parse(readFileSync(configPathAntigravity(home), 'utf8'));
        return !!((c.mcpServers as Record<string, unknown> | undefined)?.[MCP_SERVER_NAME]);
      }
      case 'claude': {
        const c = JSON.parse(readFileSync(configPathClaude(home), 'utf8'));
        return !!((c.mcpServers as Record<string, unknown> | undefined)?.[MCP_SERVER_NAME]);
      }
      case 'kimi': {
        const c = JSON.parse(readFileSync(configPathKimi(home, env), 'utf8'));
        return !!((c.mcpServers as Record<string, unknown> | undefined)?.[MCP_SERVER_NAME]);
      }
    }
  } catch {
    return false;
  }
}

export function configPathForCli(cli: InstallableCli, opts?: InstallerOpts): string {
  const home = resolveHome(opts);
  const env = opts?.env ?? process.env;
  switch (cli) {
    case 'codex': return configPathCodex(home);
    case 'opencode': return configPathOpencode(home);
    case 'antigravity': return configPathAntigravity(home);
    case 'claude': return configPathClaude(home);
    case 'kimi': return configPathKimi(home, env);
  }
}
