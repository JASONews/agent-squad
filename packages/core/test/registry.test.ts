import { describe, it, expect } from 'vitest';
import { AdapterRegistry } from '../src/adapters/registry.js';
import type { CliAdapter } from '../src/adapters/types.js';

function fakeAdapter(cliType: 'mock', available = true): CliAdapter {
  return {
    cliType,
    detect: async () => ({ available }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, nativeSessionId: 'n1', status: 'ready' }),
    send: async () => ({ status: 'completed', reply: 'ok' }),
  };
}

describe('AdapterRegistry', () => {
  it('register/get/has/list', () => {
    const r = new AdapterRegistry();
    r.register('mock', fakeAdapter('mock'));
    expect(r.has('mock')).toBe(true);
    expect(r.get('mock').cliType).toBe('mock');
    expect(r.list()).toEqual(['mock']);
  });
  it('throws unknown_cli_type on missing', () => {
    const r = new AdapterRegistry();
    expect(() => r.get('nope')).toThrow(/Unknown cli type/);
  });
  it('listAvailable reflects detect()', async () => {
    const r = new AdapterRegistry();
    r.register('mock', fakeAdapter('mock', false));
    const avail = await r.listAvailable();
    expect(avail).toEqual([{ type: 'mock', available: false }]);
  });
});
