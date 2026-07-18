import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AntigravityAdapter } from '../src/antigravity/adapter.js';

const here = dirname(fileURLToPath(import.meta.url));

let tmp: string;
let home: string;
function setupFakeBin(): string {
  const bin = join(tmp, 'bin');
  mkdirSync(bin, { recursive: true });
  const link = join(bin, 'agy');
  if (!existsSync(link)) symlinkSync(join(here, 'fake-antigravity.mjs'), link);
  return bin;
}
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'asq-agy-'));
  home = mkdtempSync(join(tmpdir(), 'asq-agy-home-'));
});
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });

function withBin(bin: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, PATH: bin + ':' + (process.env.PATH ?? ''), ...extra };
}

describe('AntigravityAdapter.detect', () => {
  it('available when fake agy on PATH', async () => {
    const bin = setupFakeBin();
    const a = new AntigravityAdapter({ usePty: false, env: withBin(bin) });
    expect((await a.detect()).available).toBe(true);
  });
  it('unavailable when not on PATH', async () => {
    const a = new AntigravityAdapter({ usePty: false, env: { ...process.env, PATH: '/nonexistent' } });
    expect((await a.detect()).available).toBe(false);
  });
});

describe('AntigravityAdapter model selection metadata', () => {
  it('declares model-based thinking selection', () => {
    const a = new AntigravityAdapter({ usePty: false, env: process.env });
    expect(a.modelSelection?.model?.parameter).toBe('model');
    expect(a.modelSelection?.model?.source).toContain('agy models');
    expect(a.modelSelection?.reasoningEffort?.parameter).toBe('model');
    expect(a.modelSelection?.reasoningEffort?.source).toContain('model name');
  });
});

describe('AntigravityAdapter.spawnSubagent', () => {
  it('lazy + validates profile', async () => {
    const a = new AntigravityAdapter({ usePty: false, env: process.env });
    const h = await a.spawnSubagent({ sessionId: 's', subagentId: 'sub', alias: 'a', role: 'ui_implementer', cwd: tmp, message: 'm', permissionProfile: 'antigravity_auto' });
    expect(h.status).toBe('ready');
    expect(h.nativeSessionId).toBeUndefined();
  });
  it('throws permission_profile_unknown on bad profile', async () => {
    const a = new AntigravityAdapter({ usePty: false, env: process.env });
    await expect(a.spawnSubagent({ sessionId: 's', subagentId: 'sub', alias: 'a', role: 'r', cwd: tmp, message: 'm', permissionProfile: 'bogus' }))
      .rejects.toMatchObject({ code: 'permission_profile_unknown' });
  });
});

describe('AntigravityAdapter.send via FakeAntigravity', () => {
  it('success first-send: full-stdout reply + nativeSessionId captured', async () => {
    const bin = setupFakeBin();
    const a = new AntigravityAdapter({ usePty: false, env: withBin(bin, { FAKE_AGY_HOME: home, FAKE_AGY_CWD: tmp, FAKE_AGY_UUID: 'agy-uuid-xyz' }), homeDir: home });
    const r = await a.send({ subagentId: 'sub', cwd: tmp, message: 'hi', wait: true });
    expect(r.status).toBe('completed');
    expect(r.reply).toContain('Reply: pong');
    expect(r.reply).toContain('### Summary of work');  // full stdout, including summary
    expect(r.nativeSessionId).toBe('agy-uuid-xyz');  // captured from last_conversations.json
  });

  it('passes selected model to agy --print', async () => {
    const bin = setupFakeBin();
    const argsPath = join(tmp, 'agy-args.json');
    const a = new AntigravityAdapter({ usePty: false, env: withBin(bin, { FAKE_AGY_HOME: home, FAKE_AGY_CWD: tmp, FAKE_AGY_ARGS_PATH: argsPath }), homeDir: home });
    const r = await a.send({ subagentId: 'sub', cwd: tmp, message: 'hi', wait: true, model: 'Gemini 3.5 Flash (High)' });
    expect(r.status).toBe('completed');
    const args = JSON.parse(readFileSync(argsPath, 'utf8')) as string[];
    expect(args).toContain('--model');
    expect(args).toContain('Gemini 3.5 Flash (High)');
  });

  it('keeps flags before --print so the prompt argument is clean', async () => {
    const bin = setupFakeBin();
    const argsPath = join(tmp, 'agy-clean-args.json');
    const a = new AntigravityAdapter({ usePty: false, env: withBin(bin, { FAKE_AGY_HOME: home, FAKE_AGY_CWD: tmp, FAKE_AGY_ARGS_PATH: argsPath }), homeDir: home });
    const r = await a.send({ subagentId: 'sub', cwd: tmp, message: 'please design the settings panel', wait: true, model: 'Gemini 3.5 Flash (High)' });
    expect(r.status).toBe('completed');
    const args = JSON.parse(readFileSync(argsPath, 'utf8')) as string[];
    const printIdx = args.indexOf('--print');
    expect(printIdx).toBeGreaterThan(0);
    expect(args.indexOf('--sandbox')).toBeLessThan(printIdx);
    expect(args.indexOf('--model')).toBeLessThan(printIdx);
    expect(args.slice(printIdx + 1)).toHaveLength(1);
    expect(args[printIdx + 1]).toContain('please design the settings panel');
    expect(args[printIdx + 1]).not.toContain('--sandbox');
    expect(args[printIdx + 1]).not.toContain('Gemini 3.5 Flash (High)');
  });

  it('resume: passes nativeSessionId via --conversation', async () => {
    const bin = setupFakeBin();
    const a = new AntigravityAdapter({ usePty: false, env: withBin(bin, { FAKE_AGY_HOME: home, FAKE_AGY_CWD: tmp, FAKE_AGY_UUID: 'agy-uuid-resume' }) });
    const r = await a.send({ subagentId: 'sub', cwd: tmp, nativeSessionId: 'existing-id', message: 'again', wait: true });
    expect(r.status).toBe('completed');
    expect(r.reply).toContain('Resumed conversation');  // the stub prints this when --conversation is passed
    expect(r.nativeSessionId).toBe('existing-id');  // resume keeps the passed id
  });

  it('fail: non-zero exit → failed', async () => {
    const bin = setupFakeBin();
    const a = new AntigravityAdapter({ usePty: false, env: withBin(bin, { FAKE_AGY_MODE: 'fail', FAKE_AGY_HOME: home, FAKE_AGY_CWD: tmp }) });
    const r = await a.send({ subagentId: 'sub', cwd: tmp, message: 'hi', wait: true });
    expect(r.status).toBe('failed');
    expect(r.rawTail).toBeTruthy();
  });

  it('blocked: idle + marker → native_cli_blocked', async () => {
    const bin = setupFakeBin();
    const a = new AntigravityAdapter({ usePty: false, env: withBin(bin, { FAKE_AGY_MODE: 'blocked', FAKE_AGY_HOME: home, FAKE_AGY_CWD: tmp }) });
    (a as unknown as { setBlockTimingsForTest: (i: number, b: number) => void }).setBlockTimingsForTest(500, 1500);
    const r = await a.send({ subagentId: 'sub', cwd: tmp, message: 'hi', wait: true });
    expect(r.status).toBe('native_cli_blocked');
    expect(r.rawTail).toMatch(/approval|pending|permission/i);
  }, 20000);
});
