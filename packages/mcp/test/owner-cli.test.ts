import { describe, expect, it } from 'vitest';
import { inferOwnerCli } from '../src/owner-cli.js';

describe('inferOwnerCli', () => {
  it('normalizes known MCP client names', () => {
    expect(inferOwnerCli({ clientName: 'codex-mcp-client' })).toBe('codex');
    expect(inferOwnerCli({ clientName: 'Claude Code' })).toBe('claude');
    expect(inferOwnerCli({ clientName: 'opencode' })).toBe('opencode');
    expect(inferOwnerCli({ clientName: 'Antigravity CLI' })).toBe('antigravity');
    expect(inferOwnerCli({ clientName: 'Kimi Code' })).toBe('kimi');
  });

  it('prefers an explicit owner, then the configured environment', () => {
    expect(inferOwnerCli({
      explicit: 'zcode',
      environment: 'codex',
      clientName: 'claude-code',
    })).toBe('zcode');
    expect(inferOwnerCli({
      environment: 'cursor-agent',
      clientName: 'claude-code',
    })).toBe('cursor');
  });

  it('uses a normalized client name or a neutral fallback', () => {
    expect(inferOwnerCli({ clientName: 'My Custom Host' })).toBe('my-custom-host');
    expect(inferOwnerCli({})).toBe('main');
  });
});
