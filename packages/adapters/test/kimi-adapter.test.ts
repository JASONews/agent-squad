import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChoicesFromReply } from '@agent-squad/core';
import { KimiAdapter } from '../src/kimi/adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
let tmp: string;

beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'asq-kimi-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function setupFakeKimiBin(): string {
  const bin = join(tmp, 'bin');
  mkdirSync(bin, { recursive: true });
  const link = join(bin, 'kimi');
  if (!existsSync(link)) symlinkSync(join(here, 'fake-kimi.mjs'), link);
  return bin;
}

function fakeEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const bin = setupFakeKimiBin();
  return { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, ...extra };
}

function readEvents(path: string): Array<{ method: string; params?: Record<string, unknown> }> {
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

describe('KimiAdapter', () => {
  it('detects Kimi Code with kimi --version', async () => {
    const adapter = new KimiAdapter({ env: fakeEnv() });
    expect(await adapter.detect()).toMatchObject({ available: true, version: 'kimi code 0.24.1', path: 'kimi' });
  });

  it('reports unavailable when kimi is missing', async () => {
    const adapter = new KimiAdapter({ env: { ...process.env, PATH: '/nonexistent' } });
    expect((await adapter.detect()).available).toBe(false);
  });

  it('bounds kimi --version detection time', async () => {
    const adapter = new KimiAdapter({
      env: fakeEnv({ FAKE_KIMI_VERSION_MODE: 'hang' }),
      detectTimeoutMs: 50,
    });
    const startedAt = Date.now();
    expect((await adapter.detect()).available).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('discovers model and thinking choices from ACP session config options', async () => {
    const eventsFile = join(tmp, 'discovery-events.jsonl');
    const adapter = new KimiAdapter({
      env: fakeEnv({ FAKE_KIMI_EVENTS_FILE: eventsFile }),
    });

    expect(await adapter.discoverModels({ cwd: tmp })).toEqual({
      status: 'available',
      source: 'kimi ACP session configOptions',
      models: [
        { id: 'default', label: 'Default', isDefault: true },
        { id: 'kimi-k2.5', label: 'Kimi K2.5' },
      ],
      defaultModel: 'default',
      reasoningEfforts: ['on', 'off'],
      defaultReasoningEffort: 'off',
    });
    expect(readEvents(eventsFile).find((event) => event.method === 'session/new')?.params)
      .toMatchObject({ cwd: tmp, mcpServers: [] });
  });

  it('spawns lazily and validates the profile at spawn and send', async () => {
    const adapter = new KimiAdapter({ env: fakeEnv() });
    const handle = await adapter.spawnSubagent({
      sessionId: 'session-1',
      subagentId: 'sub-1',
      alias: 'kimi',
      role: 'reviewer',
      cwd: tmp,
      message: 'Review code',
      permissionProfile: 'kimi_auto',
    });
    expect(handle).toEqual({ subagentId: 'sub-1', nativeSessionId: undefined, status: 'ready' });
    await expect(adapter.spawnSubagent({
      sessionId: 'session-1', subagentId: 'sub-2', alias: 'bad', role: 'reviewer', cwd: tmp, message: 'x', permissionProfile: 'bad',
    })).rejects.toMatchObject({ code: 'permission_profile_unknown' });
    await expect(adapter.send({ subagentId: 'sub-1', message: 'x', wait: true, permissionProfile: 'bad' }))
      .rejects.toMatchObject({ code: 'permission_profile_unknown' });
  });

  it('creates a session, applies model/thinking, injects first-turn coordination, and streams progress', async () => {
    const eventsFile = join(tmp, 'events.jsonl');
    const outputs: string[] = [];
    const adapter = new KimiAdapter({ env: fakeEnv({ FAKE_KIMI_EVENTS_FILE: eventsFile }) });
    const result = await adapter.send({
      subagentId: 'sub-1',
      cwd: tmp,
      message: 'Review the adapter.',
      wait: true,
      model: 'Kimi K2.5',
      reasoningEffort: 'high',
      onOutput: ({ text }) => outputs.push(text),
    });

    expect(result).toMatchObject({
      status: 'completed',
      nativeSessionId: 'fake-kimi-session',
      reply: 'fake Kimi reply',
    });
    expect(result.rawTail).toContain('[thought] Inspecting repository');
    expect(result.rawTail).toContain('[tool] read: Read source (in_progress)');
    expect(outputs).toContain('fake Kimi ');

    const events = readEvents(eventsFile);
    expect(events.map((event) => event.method)).toEqual(expect.arrayContaining([
      'initialize', 'session/new', 'session/set_config_option', 'session/prompt',
    ]));
    const selections = events.filter((event) => event.method === 'session/set_config_option').map((event) => event.params);
    expect(selections).toEqual(expect.arrayContaining([
      expect.objectContaining({ configId: 'model', value: 'kimi-k2.5' }),
      expect.objectContaining({ configId: 'thinking', value: 'on' }),
    ]));
    const prompt = events.find((event) => event.method === 'session/prompt')?.params?.prompt as Array<{ text: string }>;
    expect(prompt[0]?.text).toMatch(/^Subagent coordination protocol:/);
    expect(prompt[0]?.text).toContain('Review the adapter.');
  });

  it('resumes the native session and sends the continuation without reinjecting coordination text', async () => {
    const eventsFile = join(tmp, 'resume-events.jsonl');
    const adapter = new KimiAdapter({ env: fakeEnv({ FAKE_KIMI_EVENTS_FILE: eventsFile }) });
    const result = await adapter.send({
      subagentId: 'sub-1',
      nativeSessionId: 'existing-kimi-session',
      cwd: tmp,
      message: 'Continue the review.',
      wait: true,
    });

    expect(result.nativeSessionId).toBe('existing-kimi-session');
    const events = readEvents(eventsFile);
    expect(events.some((event) => event.method === 'session/new')).toBe(false);
    expect(events.find((event) => event.method === 'session/resume')?.params)
      .toMatchObject({ sessionId: 'existing-kimi-session', cwd: tmp });
    const prompt = events.find((event) => event.method === 'session/prompt')?.params?.prompt as Array<{ text: string }>;
    expect(prompt[0]?.text).toBe('Continue the review.');
  });

  it.each([
    ['kimi_auto', 'edit', 'approve_once'],
    ['kimi_readonly', 'read', 'reject'],
    ['kimi_readonly', 'execute', 'reject'],
  ])('answers ACP permissions for %s / %s with %s', async (profile, kind, expected) => {
    const permissionFile = join(tmp, `${profile}-${kind}.json`);
    const adapter = new KimiAdapter({ env: fakeEnv({
      FAKE_KIMI_PERMISSION_KIND: kind,
      FAKE_KIMI_PERMISSION_FILE: permissionFile,
    }) });
    const result = await adapter.send({
      subagentId: 'sub-1', message: 'Use a tool.', wait: true, permissionProfile: profile,
    });
    expect(result.status).toBe('completed');
    expect(JSON.parse(readFileSync(permissionFile, 'utf8')).outcome)
      .toEqual({ outcome: 'selected', optionId: expected });
  });

  it('relays AskUserQuestion as an Agent Squad choice instead of selecting it', async () => {
    const eventsFile = join(tmp, 'question-events.jsonl');
    const adapter = new KimiAdapter({ env: fakeEnv({
      FAKE_KIMI_MODE: 'question',
      FAKE_KIMI_EVENTS_FILE: eventsFile,
    }) });
    const result = await adapter.send({ subagentId: 'sub-1', message: 'Choose an approach.', wait: true });

    expect(result.status).toBe('completed');
    const parsed = parseChoicesFromReply(result.reply ?? '');
    expect(parsed.choices).toEqual([{
      question: 'Which implementation should I use?',
      options: [
        { id: 'q0_opt_0', label: 'Use ACP' },
        { id: 'q0_opt_1', label: 'Use JSONL' },
        { id: 'q0_skip', label: 'Skip' },
      ],
    }]);
    expect(readEvents(eventsFile)).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'session/cancel' }),
      expect.objectContaining({ method: 'question/outcome', outcome: { outcome: { outcome: 'cancelled' } } }),
    ]));
  });

  it('reports refusal as failed rather than completed', async () => {
    const adapter = new KimiAdapter({ env: fakeEnv({ FAKE_KIMI_MODE: 'refusal' }) });
    const result = await adapter.send({ subagentId: 'sub-1', message: 'Refuse this.', wait: true });
    expect(result.status).toBe('failed');
    expect(result.rawTail).toContain('prompt stopped with refusal');
  });

  it('sends session/cancel and terminates the ACP process on hard timeout', async () => {
    const cancelFile = join(tmp, 'cancelled.txt');
    const adapter = new KimiAdapter({ env: fakeEnv({
      FAKE_KIMI_MODE: 'timeout',
      FAKE_KIMI_CANCEL_FILE: cancelFile,
    }) });
    const result = await adapter.send({
      subagentId: 'sub-1', message: 'Work forever.', wait: true, hardTimeoutMs: 300,
    });
    expect(result.status).toBe('timeout');
    expect(result.nativeSessionId).toBe('fake-kimi-session');
    expect(readFileSync(cancelFile, 'utf8')).toBe('fake-kimi-session');
    expect(result.rawTail).toContain('hard timeout');
  }, 10_000);

  it('terminates a descendant process on hard timeout', async () => {
    if (process.platform === 'win32') return;
    const pidFile = join(tmp, 'descendant.pid');
    const adapter = new KimiAdapter({ env: fakeEnv({
      FAKE_KIMI_MODE: 'timeout',
      FAKE_KIMI_DESCENDANT_PID_FILE: pidFile,
    }) });
    const result = await adapter.send({
      subagentId: 'sub-1', message: 'Spawn and wait.', wait: true, hardTimeoutMs: 300,
    });
    const pid = Number(readFileSync(pidFile, 'utf8'));

    expect(result.status).toBe('timeout');
    await expectProcessGone(pid);
  }, 10_000);
});

async function expectProcessGone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  process.kill(pid, 'SIGKILL');
  throw new Error(`descendant process ${pid} survived adapter cleanup`);
}
