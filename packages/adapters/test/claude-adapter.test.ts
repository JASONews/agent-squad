import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeAdapter } from '../src/claude/adapter.js';

const here = dirname(fileURLToPath(import.meta.url));

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'asq-claude-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function setupFakeClaudeBin(): string {
  const bin = join(tmp, 'bin');
  mkdirSync(bin, { recursive: true });
  const link = join(bin, 'claude');
  if (!existsSync(link)) symlinkSync(join(here, 'fake-claude.mjs'), link);
  return bin;
}

describe('ClaudeAdapter.detect', () => {
  it('reports available when fake claude is on PATH', async () => {
    const bin = setupFakeClaudeBin();
    const a = new ClaudeAdapter({ env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? '') } });
    expect((await a.detect()).available).toBe(true);
  });

  it('reports unavailable when claude is not on PATH', async () => {
    const a = new ClaudeAdapter({ env: { ...process.env, PATH: '/nonexistent' } });
    expect((await a.detect()).available).toBe(false);
  });
});

describe('ClaudeAdapter model selection metadata', () => {
  it('declares model and reasoning_effort mapping', () => {
    const a = new ClaudeAdapter({ env: process.env });
    expect(a.modelSelection?.model?.parameter).toBe('model');
    expect(a.modelSelection?.reasoningEffort?.parameter).toBe('reasoning_effort');
    expect(a.modelSelection?.reasoningEffort?.source).toContain('--effort');
  });
});

describe('ClaudeAdapter.spawnSubagent', () => {
  it('is lazy and validates profile', async () => {
    const a = new ClaudeAdapter({ env: process.env });
    const h = await a.spawnSubagent({
      sessionId: 'sess_1',
      subagentId: 'sub_1',
      alias: 'claude',
      role: 'reviewer',
      cwd: tmp,
      message: 'initial',
      permissionProfile: 'claude_auto',
    });
    expect(h.status).toBe('ready');
    expect(h.nativeSessionId).toBeUndefined();
  });

  it('throws permission_profile_unknown on a bad profile name', async () => {
    const a = new ClaudeAdapter({ env: process.env });
    await expect(a.spawnSubagent({
      sessionId: 'sess_1',
      subagentId: 'sub_1',
      alias: 'claude',
      role: 'reviewer',
      cwd: tmp,
      message: 'x',
      permissionProfile: 'bogus',
    })).rejects.toMatchObject({ code: 'permission_profile_unknown' });
  });
});

describe('ClaudeAdapter.send via FakeClaude', () => {
  it('success: captures session_id + reply', async () => {
    const bin = setupFakeClaudeBin();
    const a = new ClaudeAdapter({ env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? '') } });
    const r = await a.send({ subagentId: 'sub_1', message: 'hi', wait: true });
    expect(r.status).toBe('completed');
    expect(r.reply).toBe('fake claude reply');
    expect(r.nativeSessionId).toBe('fake-claude-session');
  });

  it('first send invokes claude print mode in the requested cwd with an English-only subagent prompt', async () => {
    const bin = setupFakeClaudeBin();
    const argsFile = join(tmp, 'claude-args.json');
    const cwdFile = join(tmp, 'claude-cwd.txt');
    const repo = join(tmp, 'repo');
    mkdirSync(repo);
    const task = 'Review packages/core/src/services/subagents.ts and report findings.';
    const a = new ClaudeAdapter({
      env: {
        ...process.env,
        PATH: bin + ':' + (process.env.PATH ?? ''),
        FAKE_CLAUDE_ARGS_FILE: argsFile,
        FAKE_CLAUDE_CWD_FILE: cwdFile,
      },
    });

    const r = await a.send({
      subagentId: 'sub_1',
      cwd: repo,
      message: task,
      wait: true,
      model: 'sonnet',
      reasoningEffort: 'high',
    });

    expect(r.status).toBe('completed');
    expect(readFileSync(cwdFile, 'utf8')).toBe(realpathSync(repo));
    const args = JSON.parse(readFileSync(argsFile, 'utf8').trim()) as string[];
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--model');
    expect(args).toContain('sonnet');
    expect(args).toContain('--effort');
    expect(args).toContain('high');
    const prompt = args.at(-1);
    expect(prompt).toMatch(/^Agent Squad subagent coordination protocol:/);
    expect(prompt).toContain('Use English for all communication with Claude Code.');
    expect(prompt).toContain('Subagent task:');
    expect(prompt).toContain(task);
  });

  it('resume passes --resume and still wraps the continuation in English-only instructions', async () => {
    const bin = setupFakeClaudeBin();
    const argsFile = join(tmp, 'claude-args.jsonl');
    const a = new ClaudeAdapter({
      env: {
        ...process.env,
        PATH: bin + ':' + (process.env.PATH ?? ''),
        FAKE_CLAUDE_ARGS_FILE: argsFile,
      },
    });

    const r = await a.send({
      subagentId: 'sub_1',
      nativeSessionId: 'fake-claude-session',
      message: 'Continue after the user selected page layout.',
      wait: true,
    });

    expect(r.status).toBe('completed');
    const args = JSON.parse(readFileSync(argsFile, 'utf8').trim()) as string[];
    expect(args).toContain('--resume');
    expect(args).toContain('fake-claude-session');
    const prompt = args.at(-1);
    expect(prompt).toMatch(/^Agent Squad continuation message:/);
    expect(prompt).toContain('Use English for all communication with Claude Code.');
    expect(prompt).toContain('Continue after the user selected page layout.');
  });

  it('fail: non-zero exit returns failed', async () => {
    const bin = setupFakeClaudeBin();
    const a = new ClaudeAdapter({ env: {
      ...process.env,
      PATH: bin + ':' + (process.env.PATH ?? ''),
      FAKE_CLAUDE_MODE: 'fail',
    } });
    const r = await a.send({ subagentId: 'sub_1', message: 'hi', wait: true });
    expect(r.status).toBe('failed');
    expect(r.rawTail).toBeTruthy();
  });

  it('blocked: idle + marker returns native_cli_blocked', async () => {
    const bin = setupFakeClaudeBin();
    const a = new ClaudeAdapter({ env: {
      ...process.env,
      PATH: bin + ':' + (process.env.PATH ?? ''),
      FAKE_CLAUDE_MODE: 'blocked',
    } });
    a.setBlockTimingsForTest(500, 1500);
    const r = await a.send({ subagentId: 'sub_1', message: 'hi', wait: true });
    expect(r.status).toBe('native_cli_blocked');
    expect(r.rawTail).toMatch(/approval|pending|permission/i);
  }, 20000);

  it('silent long-running claude run returns timeout at the hard timeout budget', async () => {
    const bin = setupFakeClaudeBin();
    const a = new ClaudeAdapter({ env: {
      ...process.env,
      PATH: bin + ':' + (process.env.PATH ?? ''),
      FAKE_CLAUDE_MODE: 'silent',
    } });
    const r = await a.send({ subagentId: 'sub_1', message: 'review slowly', wait: true, hardTimeoutMs: 300 });
    expect(r.status).toBe('timeout');
    expect(r.nativeSessionId).toBe('fake-claude-silent');
  }, 20000);
});
