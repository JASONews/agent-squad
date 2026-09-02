import { describe, it, expect } from 'vitest';
import { MockAdapter } from '../src/adapters/mock.js';

const spawnInput = {
  sessionId: 'sess_1', subagentId: 'sub_1', alias: 'rev',
  role: 'reviewer', cwd: '.', message: 'initial',
};

describe('MockAdapter', () => {
  it('spawn returns ready handle with mock native session id', async () => {
    const m = new MockAdapter();
    const h = await m.spawnSubagent(spawnInput);
    expect(h.status).toBe('ready');
    expect(h.nativeSessionId).toMatch(/^mock_/);
  });
  it('review keyword yields review_json artifact', async () => {
    const m = new MockAdapter();
    const h = await m.spawnSubagent(spawnInput);
    const r = await m.send({ subagentId: h.subagentId, nativeSessionId: h.nativeSessionId, message: 'please review this diff', wait: true });
    expect(r.status).toBe('completed');
    expect(r.reply).toBeTruthy();
    expect(r.artifacts?.some((a) => a.kind === 'review_json')).toBe(true);
  });
  it('ui keyword yields patch artifact', async () => {
    const m = new MockAdapter();
    const h = await m.spawnSubagent(spawnInput);
    const r = await m.send({ subagentId: h.subagentId, message: 'design the settings ui', wait: true });
    expect(r.artifacts?.some((a) => a.kind === 'patch')).toBe(true);
  });
  it('[BLOCK] yields native_cli_blocked with rawTail', async () => {
    const m = new MockAdapter();
    const h = await m.spawnSubagent(spawnInput);
    const r = await m.send({ subagentId: h.subagentId, message: 'do something [BLOCK]', wait: true });
    expect(r.status).toBe('native_cli_blocked');
    expect(r.rawTail).toBeTruthy();
  });
  it('wait:false returns running immediately with no reply', async () => {
    const m = new MockAdapter();
    const h = await m.spawnSubagent(spawnInput);
    const r = await m.send({ subagentId: h.subagentId, message: 'review this', wait: false });
    expect(r.status).toBe('running');
    expect(r.reply).toBeUndefined();
    expect(r.artifacts).toBeUndefined();
  });
  it('generic message yields Completed echo', async () => {
    const m = new MockAdapter();
    const h = await m.spawnSubagent(spawnInput);
    const r = await m.send({ subagentId: h.subagentId, message: 'summarize the module', wait: true });
    expect(r.reply).toBe('Completed: summarize the module');
  });
  it('detect and capabilities report available + permissive', async () => {
    const m = new MockAdapter();
    expect((await m.detect()).available).toBe(true);
    const caps = m.capabilities();
    expect(Object.values(caps).every(Boolean)).toBe(true);
  });
});
