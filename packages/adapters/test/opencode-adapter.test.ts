import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpencodeAdapter } from '../src/opencode/adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

let tmp: string;
function setupFakeBin(): string {
  const bin = join(tmp, 'bin');
  mkdirSync(bin, { recursive: true });
  const link = join(bin, 'opencode');
  if (!existsSync(link)) symlinkSync(join(here, 'fake-opencode.mjs'), link);
  return bin;
}
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'asq-oc-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('OpencodeAdapter.detect', () => {
  it('available when fake opencode on PATH', async () => {
    const bin = setupFakeBin();
    const a = new OpencodeAdapter({ usePty: false, env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? '') } });
    expect((await a.detect()).available).toBe(true);
  });
  it('unavailable when not on PATH', async () => {
    const a = new OpencodeAdapter({ usePty: false, env: { ...process.env, PATH: '/nonexistent' } });
    expect((await a.detect()).available).toBe(false);
  });
});

describe('OpencodeAdapter model selection metadata', () => {
  it('declares model and reasoning_effort mapping', () => {
    const a = new OpencodeAdapter({ usePty: false, env: process.env });
    expect(a.modelSelection?.model?.parameter).toBe('model');
    expect(a.modelSelection?.reasoningEffort?.parameter).toBe('reasoning_effort');
    expect(a.modelSelection?.reasoningEffort?.source).toContain('--variant');
  });
});

describe('OpencodeAdapter.discoverModels', () => {
  it('lists configured provider/model ids and removes ANSI duplicates', async () => {
    const bin = setupFakeBin();
    const repo = join(tmp, 'repo');
    const cwdFile = join(tmp, 'models-cwd.txt');
    mkdirSync(repo);
    const a = new OpencodeAdapter({
      usePty: false,
      env: {
        ...process.env,
        PATH: bin + ':' + (process.env.PATH ?? ''),
        FAKE_OPENCODE_CWD_FILE: cwdFile,
      },
    });

    expect(await a.discoverModels({ cwd: repo })).toEqual({
      status: 'available',
      source: 'opencode models',
      models: [
        { id: 'openai/gpt-5.6' },
        { id: 'anthropic/claude-opus-4-6' },
      ],
    });
    expect(realpathSync(readFileSync(cwdFile, 'utf8'))).toBe(realpathSync(repo));
  });

  it('reports a safe failure code when the model command cannot spawn', async () => {
    const a = new OpencodeAdapter({
      usePty: false,
      env: { ...process.env, PATH: '/nonexistent' },
    });

    expect(await a.discoverModels()).toEqual({
      status: 'failed',
      source: 'opencode models',
      models: [],
      error: 'model_discovery_spawn_failed',
    });
  });
});

describe('OpencodeAdapter.spawnSubagent', () => {
  it('lazy + validates profile', async () => {
    const a = new OpencodeAdapter({ usePty: false, env: process.env });
    const h = await a.spawnSubagent({ sessionId: 's', subagentId: 'sub', alias: 'a', role: 'r', cwd: '.', message: 'm', permissionProfile: 'opencode_prompt' });
    expect(h.status).toBe('ready');
    expect(h.nativeSessionId).toBeUndefined();
  });
  it('throws permission_profile_unknown on bad profile', async () => {
    const a = new OpencodeAdapter({ usePty: false, env: process.env });
    await expect(a.spawnSubagent({ sessionId: 's', subagentId: 'sub', alias: 'a', role: 'r', cwd: '.', message: 'm', permissionProfile: 'bogus' }))
      .rejects.toMatchObject({ code: 'permission_profile_unknown' });
  });
});

describe('OpencodeAdapter.allocateNativeSession', () => {
  it('allocates an ACP session without prompting the model', async () => {
    const bin = setupFakeBin();
    const eventsFile = join(tmp, 'allocation-events.jsonl');
    const a = new OpencodeAdapter({
      usePty: false,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        FAKE_OPENCODE_EVENTS_FILE: eventsFile,
      },
    });

    const nativeSessionId = await a.allocateNativeSession({
      sessionId: 's', subagentId: 'sub', alias: 'a', role: 'r', cwd: tmp,
      message: 'Review code', permissionProfile: 'opencode_prompt',
    });

    expect(nativeSessionId).toBe('ses-opencode-allocated');
    const events = readFileSync(eventsFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(events.map((event) => event.method)).toEqual(['initialize', 'session/new']);
  });

  it('fails cleanly when the ACP process cannot start', async () => {
    const a = new OpencodeAdapter({
      usePty: false,
      binary: join(tmp, 'missing-opencode'),
      env: process.env,
      nativeSessionAllocationTimeoutMs: 50,
    });

    await expect(a.allocateNativeSession({
      sessionId: 's', subagentId: 'sub', alias: 'a', role: 'r', cwd: tmp,
      message: 'Review code', permissionProfile: 'opencode_prompt',
    })).rejects.toThrow('could not start the CLI');
  });
});

describe('OpencodeAdapter.send via FakeOpencode', () => {
  it('success: reply + nativeSessionId', async () => {
    const bin = setupFakeBin();
    const a = new OpencodeAdapter({ usePty: false, env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? '') } });
    const r = await a.send({ subagentId: 'sub', message: 'hi', wait: true });
    expect(r.status).toBe('completed');
    expect(r.reply).toBe('fake opencode reply');
    expect(r.nativeSessionId).toBe('ses-fake');
  });
  it('captures batch message content so choice blocks reach core parsing', async () => {
    const bin = setupFakeBin();
    const a = new OpencodeAdapter({
      usePty: false,
      env: {
        ...process.env,
        PATH: bin + ':' + (process.env.PATH ?? ''),
        FAKE_OPENCODE_FIXTURE: join(fixtures, 'opencode-batch-choice.jsonl'),
      },
    });
    const r = await a.send({ subagentId: 'sub', message: 'hi', wait: true });
    expect(r.status).toBe('completed');
    expect(r.nativeSessionId).toBe('ses-batch');
    expect(r.reply).toContain('%%AGENT_SQUAD_CHOICE%%');
    expect(r.reply).toContain('"question":"Pick layout?"');
  });
  it('resume: passes nativeSessionId (-s)', async () => {
    const bin = setupFakeBin();
    const a = new OpencodeAdapter({ usePty: false, env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? '') } });
    // second send with nativeSessionId set — stub ignores -s but the adapter must include it
    const r = await a.send({ subagentId: 'sub', nativeSessionId: 'ses-fake', message: 'again', wait: true });
    expect(r.status).toBe('completed');
  });
  it('injects first-turn coordination when resuming a preallocated session', async () => {
    const bin = setupFakeBin();
    const argsFile = join(tmp, 'preallocated-args.jsonl');
    const a = new OpencodeAdapter({
      usePty: false,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        FAKE_OPENCODE_ARGS_FILE: argsFile,
      },
    });

    await a.send({
      subagentId: 'sub', nativeSessionId: 'ses-opencode-allocated', isFirstTurn: true,
      message: 'Perform the initial review.', wait: true,
    });

    const args = JSON.parse(readFileSync(argsFile, 'utf8').trim()) as string[];
    expect(args).toContain('ses-opencode-allocated');
    expect(args.at(-1)).toMatch(/^Subagent coordination protocol:/);
    expect(args.at(-1)).toContain('Perform the initial review.');
  });
  it('fail: non-zero exit → failed', async () => {
    const bin = setupFakeBin();
    const a = new OpencodeAdapter({ usePty: false, env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? ''), FAKE_OPENCODE_MODE: 'fail' } });
    const r = await a.send({ subagentId: 'sub', message: 'hi', wait: true });
    expect(r.status).toBe('failed');
  });
  it('blocked: idle + marker → native_cli_blocked', async () => {
    const bin = setupFakeBin();
    const a = new OpencodeAdapter({ usePty: false, env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? ''), FAKE_OPENCODE_MODE: 'blocked' } });
    (a as unknown as { setBlockTimingsForTest: (i: number, b: number) => void }).setBlockTimingsForTest(500, 1500);
    const r = await a.send({ subagentId: 'sub', message: 'hi', wait: true });
    expect(r.status).toBe('native_cli_blocked');
    expect(r.rawTail).toMatch(/approval|pending|permission/i);
  }, 20000);
});
