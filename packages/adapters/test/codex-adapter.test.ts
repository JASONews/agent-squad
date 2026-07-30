import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexAdapter } from '../src/codex/adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'asq-codex-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

// Symlink fake-codex.mjs as `codex` (no extension) inside tmp/bin so `codex` resolves on PATH.
function setupFakeCodexBin(): string {
  const bin = join(tmp, 'bin');
  mkdirSync(bin, { recursive: true });
  const link = join(bin, 'codex');
  if (!existsSync(link)) symlinkSync(join(here, 'fake-codex.mjs'), link);
  return bin;
}

function withBin(bin: string): NodeJS.ProcessEnv {
  return { ...process.env, PATH: bin + ':' + (process.env.PATH ?? '') };
}

describe('CodexAdapter.detect', () => {
  it('reports available when fake codex is on PATH', async () => {
    const bin = setupFakeCodexBin();
    const a = new CodexAdapter({ usePty: false, env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? '') } });
    const d = await a.detect();
    expect(d.available).toBe(true);
  });
  it('reports unavailable when codex is not on PATH', async () => {
    const a = new CodexAdapter({ usePty: false, env: { ...process.env, PATH: '/nonexistent' } });
    const d = await a.detect();
    expect(d.available).toBe(false);
  });
});

describe('CodexAdapter model selection metadata', () => {
  it('declares model and reasoning_effort mapping', () => {
    const a = new CodexAdapter({ usePty: false, env: process.env });
    expect(a.modelSelection?.model?.parameter).toBe('model');
    expect(a.modelSelection?.reasoningEffort?.parameter).toBe('reasoning_effort');
    expect(a.modelSelection?.reasoningEffort?.source).toContain('model_reasoning_effort');
  });
});

describe('CodexAdapter.discoverModels', () => {
  it('reads models and per-model reasoning efforts from the app server', async () => {
    const bin = setupFakeCodexBin();
    const a = new CodexAdapter({ usePty: false, env: withBin(bin) });

    expect(await a.discoverModels()).toEqual({
      status: 'available',
      source: 'codex app-server model/list',
      models: [{
        id: 'gpt-5.6-sol',
        label: 'GPT-5.6-Sol',
        isDefault: true,
        reasoningEfforts: ['low', 'high', 'max'],
        defaultReasoningEffort: 'high',
      }, {
        id: 'gpt-5.6-terra',
        label: 'GPT-5.6-Terra',
        reasoningEfforts: ['medium', 'high'],
        defaultReasoningEffort: 'medium',
      }],
      defaultModel: 'gpt-5.6-sol',
    });
  });
});

describe('CodexAdapter.spawnSubagent', () => {
  it('is lazy: returns ready without running codex; validates profile', async () => {
    const a = new CodexAdapter({ usePty: false, env: process.env });
    const h = await a.spawnSubagent({
      sessionId: 'sess_1', subagentId: 'sub_1', alias: 'rev', role: 'reviewer',
      cwd: tmp, message: 'initial', permissionProfile: 'codex_readonly_auto',
    });
    expect(h.status).toBe('ready');
    expect(h.nativeSessionId).toBeUndefined();
  });
  it('throws permission_profile_unknown on a bad profile name', async () => {
    const a = new CodexAdapter({ usePty: false, env: process.env });
    await expect(a.spawnSubagent({
      sessionId: 'sess_1', subagentId: 'sub_1', alias: 'rev', role: 'r',
      cwd: tmp, message: 'x', permissionProfile: 'bogus',
    })).rejects.toMatchObject({ code: 'permission_profile_unknown' });
  });
});

describe('CodexAdapter.send via FakeCodex', () => {
  it('success: captures session_id + reply', async () => {
    const bin = setupFakeCodexBin();
    const a = new CodexAdapter({ usePty: false, env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? '') } });
    const r = await a.send({ subagentId: 'sub_1', message: 'hi', wait: true });
    expect(r.status).toBe('completed');
    expect(r.reply).toBe('fake reply');
    expect(r.nativeSessionId).toBe('fake-thread-id');
  });

  it('first send passes a non-skill-triggering subagent prompt to codex exec', async () => {
    const bin = setupFakeCodexBin();
    const argsFile = join(tmp, 'codex-args.json');
    const task = 'Review packages/core/src/services/subagents.ts and report findings.';
    const a = new CodexAdapter({
      usePty: false,
      env: {
        ...process.env,
        PATH: bin + ':' + (process.env.PATH ?? ''),
        FAKE_CODEX_ARGS_FILE: argsFile,
      },
    });

    const r = await a.send({ subagentId: 'sub_1', message: task, wait: true });

    expect(r.status).toBe('completed');
    const args = JSON.parse(readFileSync(argsFile, 'utf8').trim()) as string[];
    const prompt = args.at(-1);
    expect(prompt).toMatch(/^Subagent coordination protocol:/);
    expect(prompt).not.toContain('[agent-squad]');
    expect(prompt).toContain('Subagent task:');
    expect(prompt).toContain(task);
  });

  it('captures batch message content so choice blocks reach core parsing', async () => {
    const bin = setupFakeCodexBin();
    const a = new CodexAdapter({
      usePty: false,
      env: {
        ...process.env,
        PATH: bin + ':' + (process.env.PATH ?? ''),
        FAKE_CODEX_FIXTURE: join(fixtures, 'codex-batch-choice.jsonl'),
      },
    });
    const r = await a.send({ subagentId: 'sub_1', message: 'hi', wait: true });
    expect(r.status).toBe('completed');
    expect(r.nativeSessionId).toBe('batch-thread-id');
    expect(r.reply).toContain('%%AGENT_SQUAD_CHOICE%%');
    expect(r.reply).toContain('"question":"Pick layout?"');
  });

  it('resume: uses nativeSessionId (second send)', async () => {
    const bin = setupFakeCodexBin();
    const argsFile = join(tmp, 'codex-args.jsonl');
    const a = new CodexAdapter({
      usePty: false,
      env: {
        ...process.env,
        PATH: bin + ':' + (process.env.PATH ?? ''),
        FAKE_CODEX_ARGS_FILE: argsFile,
      },
    });
    // first send captures 'fake-thread-id' from the default fixture
    const r1 = await a.send({ subagentId: 'sub_1', message: 'first', wait: true });
    expect(r1.status).toBe('completed');
    // second send with nativeSessionId set — adapter should call `exec resume <id>`
    const r2 = await a.send({ subagentId: 'sub_1', nativeSessionId: 'fake-thread-id', message: 'second', wait: true });
    expect(r2.status).toBe('completed');
    const calls = readFileSync(argsFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]);
    expect(calls[0]?.slice(0, 2)).toEqual(['exec', '--cd']);
    expect(calls[0]?.at(-1)).toContain('first');
    expect(calls[1]?.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(calls[1]).toContain('fake-thread-id');
    expect(calls[1]?.at(-1)).toBe('second');
  });

  it('fail: non-zero exit → status failed with rawTail', async () => {
    const bin = setupFakeCodexBin();
    const a = new CodexAdapter({ usePty: false, env: {
      ...process.env,
      PATH: bin + ':' + (process.env.PATH ?? ''),
      FAKE_CODEX_MODE: 'fail',
    } });
    const r = await a.send({ subagentId: 'sub_1', message: 'hi', wait: true });
    expect(r.status).toBe('failed');
    expect(r.rawTail).toBeTruthy();
  });

  it('blocked: idle + marker → native_cli_blocked', async () => {
    const bin = setupFakeCodexBin();
    const a = new CodexAdapter({ usePty: false, env: {
      ...process.env,
      PATH: bin + ':' + (process.env.PATH ?? ''),
      FAKE_CODEX_MODE: 'blocked',
    } });
    // use shorter block thresholds so the test doesn't wait 30s
    (a as unknown as { setBlockTimingsForTest: (idle: number, block: number) => void }).setBlockTimingsForTest(500, 1500);
    const r = await a.send({ subagentId: 'sub_1', message: 'hi', wait: true });
    expect(r.status).toBe('native_cli_blocked');
    expect(r.rawTail).toMatch(/approval|pending|permission/i);
  }, 20000);

  it('silent long-running codex run returns timeout at the hard timeout budget', async () => {
    const bin = setupFakeCodexBin();
    const a = new CodexAdapter({ usePty: false, env: {
      ...process.env,
      PATH: bin + ':' + (process.env.PATH ?? ''),
      FAKE_CODEX_MODE: 'silent',
    } });
    const r = await a.send({ subagentId: 'sub_1', message: 'review slowly', wait: true, hardTimeoutMs: 300 });
    expect(r.status).toBe('timeout');
    expect(r.nativeSessionId).toBe('fake-silent-thread');
  }, 20000);
});
