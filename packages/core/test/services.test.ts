import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/db/client.js';
import type { Db } from '../src/db/client.js';
import { EventBus } from '../src/events.js';
import { AdapterRegistry } from '../src/adapters/registry.js';
import { MockAdapter } from '../src/adapters/mock.js';
import { startSession } from '../src/services/sessions.js';
import { spawnSubagent, sendToSubagent, waitForSubagent, WAIT_SUBAGENT_TIMEOUT_MS, WAIT_SUBAGENT_MAX_TIMEOUT_MS } from '../src/services/subagents.js';
import { postArtifact, getArtifact } from '../src/services/artifacts.js';
import { getMessages } from '../src/services/messages.js';
import { listSubagentTypes } from '../src/services/subagentTypes.js';
import type { CliAdapter, SpawnInput, SubagentHandle, SendInput, SendResult, DetectResult, AdapterCapabilities } from '../src/adapters/types.js';

let db: Db;
let registry: AdapterRegistry;
beforeEach(() => {
  db = openDb({ server: { host: '', port: 0, dbPath: ':memory:' }, contextPolicy: { default: 'message_only' } });
  registry = new AdapterRegistry();
  registry.register('mock', new MockAdapter());
});

function failingAdapter(): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async () => ({ status: 'failed', rawTail: 'codex crashed' }),
  };
}

function throwingAdapter(): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (_input: SpawnInput): Promise<SubagentHandle> => {
      throw new Error('native spawn blew up');
    },
    send: async (_input: SendInput): Promise<SendResult> => ({ status: 'completed', reply: 'x' }),
  };
}

function threadCapturingAdapter(observedNativeSessionIds?: (string | undefined)[]): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async (input) => {
      observedNativeSessionIds?.push(input.nativeSessionId);
      return { status: 'completed', nativeSessionId: 'thread-xyz', reply: 'ok' };
    },
  };
}

function messageCapturingThreadAdapter(observedMessages: string[]): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async (input) => {
      observedMessages.push(input.message);
      return { status: 'completed', nativeSessionId: 'thread-xyz', reply: 'ok' };
    },
  };
}

const CHOICE_REPLY = `Need a product direction before continuing.

%%AGENT_SQUAD_CHOICE%%
{"question":"Modal or standalone page?","options":[{"id":"modal","label":"Modal","tradeoff":"lighter"},{"id":"page","label":"Page","tradeoff":"more space"}],"recommendation":{"option_id":"page","reason":"more room","confidence":"high"}}
%%END_AGENT_SQUAD_CHOICE%%`;

const MULTI_CHOICE_REPLY = `Need two decisions before continuing.

%%AGENT_SQUAD_CHOICE%%
{"question":"Layout?","options":[{"id":"modal","label":"Modal"},{"id":"page","label":"Page"}],"recommendation":{"option_id":"page","reason":"more room"}}
%%END_AGENT_SQUAD_CHOICE%%

%%AGENT_SQUAD_CHOICE%%
{"question":"Density?","options":[{"id":"dense","label":"Dense"},{"id":"guided","label":"Guided"}],"recommendation":{"option_id":"dense","reason":"repeat users"}}
%%END_AGENT_SQUAD_CHOICE%%`;

function choiceReplyAdapter(): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async () => ({ status: 'completed', reply: CHOICE_REPLY }),
  };
}

function multiChoiceReplyAdapter(): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async () => ({ status: 'completed', reply: MULTI_CHOICE_REPLY }),
  };
}

function delayedAdapter(delayMs: number, result: SendResult): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return result;
    },
  };
}

function hardTimeoutSpyAdapter(observedHardTimeouts: (number | undefined)[]): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async (input) => {
      observedHardTimeouts.push(input.hardTimeoutMs);
      return { status: 'timeout', rawTail: 'hard timeout after budget' };
    },
  };
}

function countingDelayedAdapter(delayMs: number, result: SendResult, observedMessages: string[]): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async (input) => {
      observedMessages.push(input.message);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return result;
    },
  };
}

function outputAdapter(): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async (input) => {
      input.onOutput?.({ stream: 'stdout', text: 'live line', rawTail: 'live line' });
      return { status: 'completed', reply: 'done' };
    },
  };
}

async function eventually(assertion: () => void | Promise<void>, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (e) {
      lastError = e;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (lastError) throw lastError;
  throw new Error(`condition not met after ${timeoutMs}ms`);
}

describe('services', () => {
  it('waitForSubagent defaults to the maximum single wait budget', () => {
    expect(WAIT_SUBAGENT_TIMEOUT_MS).toBe(300_000);
    expect(WAIT_SUBAGENT_TIMEOUT_MS).toBe(WAIT_SUBAGENT_MAX_TIMEOUT_MS);
  });

  it('startSession inserts session + user_task message', () => {
    const { sessionId } = startSession(db, { cwd: '/repo', task: 'build it', ownerCli: 'codex' });
    const msgs = getMessages(db, sessionId);
    expect(msgs.some((m) => m.kind === 'user_task')).toBe(true);
  });

  it('spawnSubagent + sendToSubagent(review) round-trips and persists review_json artifact', async () => {
    const { sessionId } = startSession(db, { cwd: '/repo', task: 't' });
    const spawned = await spawnSubagent(db, registry, { sessionId, alias: 'rev', cli: 'mock', role: 'reviewer', message: 'initial review' });
    expect(spawned.status).toBe('ready');
    const res = await sendToSubagent(db, registry, { sessionId, alias: 'rev', message: 'please review this', wait: true });
    expect(res.status).toBe('completed');
    expect(res.reply).toBeTruthy();
    expect(res.artifacts?.some((a) => a.kind === 'review_json')).toBe(true);
    const msgs = getMessages(db, sessionId, { subagentId: spawned.subagentId });
    expect(msgs.some((m) => m.kind === 'main_to_sub')).toBe(true);
    expect(msgs.some((m) => m.kind === 'sub_to_main')).toBe(true);
  });

  it('sendToSubagent wait:false returns running with messageId', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    await spawnSubagent(db, registry, { sessionId, alias: 'rev', cli: 'mock', role: 'reviewer', message: 'go' });
    const res = await sendToSubagent(db, registry, { sessionId, alias: 'rev', message: 'review', wait: false });
    expect(res.status).toBe('running');
    expect(res.messageId).toMatch(/^msg_/);
    expect(res.reply).toBeUndefined();
  });

  it('sendToSubagent wait:false starts the subagent in the background', async () => {
    const r = new AdapterRegistry();
    r.register('slow', delayedAdapter(40, { status: 'completed', reply: 'background done' }));
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, r, { sessionId, alias: 'slow', cli: 'slow', role: 'reviewer', message: 'go' });

    const res = await sendToSubagent(db, r, { sessionId, alias: 'slow', message: 'start async', wait: false });

    expect(res.status).toBe('running');
    await eventually(() => {
      const row = db.prepare<{ id: string }, { status: string }>('SELECT status FROM subagents WHERE id=?').get(sp.subagentId);
      expect(row?.status).toBe('completed');
      const msgs = getMessages(db, sessionId, { subagentId: sp.subagentId });
      expect(msgs.some((m) => m.kind === 'sub_to_main' && m.content === 'background done')).toBe(true);
    });
  });

  it('sendToSubagent emits live subagent output events', async () => {
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.on((event) => { events.push(event); });
    const r = new AdapterRegistry();
    r.register('out', outputAdapter());
    const { sessionId } = startSession(db, { cwd: '.', task: 't' }, bus);
    const sp = await spawnSubagent(db, r, { sessionId, alias: 'out', cli: 'out', role: 'reviewer', message: 'go' }, bus);

    await sendToSubagent(db, r, { sessionId, alias: 'out', message: 'stream output', wait: true }, bus);

    expect(events).toContainEqual({
      type: 'subagent_output',
      payload: {
        session_id: sessionId,
        subagent_id: sp.subagentId,
        alias: 'out',
        cli_type: 'out',
        stream: 'stdout',
        text: 'live line',
        raw_tail: 'live line',
      },
    });
  });

  it('sendToSubagent returns running after the soft wait timeout and persists the background reply later', async () => {
    const r = new AdapterRegistry();
    r.register('slow', delayedAdapter(80, { status: 'completed', reply: 'slow done' }));
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, r, { sessionId, alias: 'slow', cli: 'slow', role: 'reviewer', message: 'go' });

    const res = await sendToSubagent(db, r, {
      sessionId,
      alias: 'slow',
      message: 'review slowly',
      wait: true,
      softTimeoutMs: 20,
    } as Parameters<typeof sendToSubagent>[2] & { softTimeoutMs: number });

    expect(res.status).toBe('running');
    const runningRow = db.prepare<{ id: string }, { status: string }>('SELECT status FROM subagents WHERE id=?').get(sp.subagentId);
    expect(runningRow?.status).toBe('running');

    await eventually(() => {
      const row = db.prepare<{ id: string }, { status: string }>('SELECT status FROM subagents WHERE id=?').get(sp.subagentId);
      expect(row?.status).toBe('completed');
      const msgs = getMessages(db, sessionId, { subagentId: sp.subagentId });
      expect(msgs.some((m) => m.kind === 'sub_to_main' && m.content === 'slow done')).toBe(true);
    });
  });

  it('sendToSubagent does not start or queue a second send while the subagent is already running', async () => {
    const observedMessages: string[] = [];
    const r = new AdapterRegistry();
    r.register('slow', countingDelayedAdapter(80, { status: 'completed', reply: 'first done' }, observedMessages));
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, r, { sessionId, alias: 'slow', cli: 'slow', role: 'reviewer', message: 'go' });

    const first = await sendToSubagent(db, r, {
      sessionId,
      alias: 'slow',
      message: 'first task',
      wait: true,
      softTimeoutMs: 20,
    } as Parameters<typeof sendToSubagent>[2] & { softTimeoutMs: number });
    const second = await sendToSubagent(db, r, { sessionId, alias: 'slow', message: 'second task', wait: true });

    expect(first.status).toBe('running');
    expect(second.status).toBe('running');
    expect(observedMessages).toHaveLength(1);
    expect(observedMessages[0]).toContain('first task');
    const msgsBeforeCompletion = getMessages(db, sessionId, { subagentId: sp.subagentId });
    expect(msgsBeforeCompletion.some((m) => m.kind === 'main_to_sub' && m.content === 'second task')).toBe(false);
    expect(msgsBeforeCompletion.some((m) => m.kind === 'sub_status' && m.content?.includes('already running'))).toBe(true);

    await eventually(() => {
      expect(observedMessages).toHaveLength(1);
      expect(observedMessages[0]).toContain('first task');
      const msgs = getMessages(db, sessionId, { subagentId: sp.subagentId });
      expect(msgs.some((m) => m.kind === 'sub_to_main' && m.content === 'first done')).toBe(true);
    });
  });

  it('waitForSubagent returns as soon as a running subagent completes', async () => {
    const bus = new EventBus();
    const r = new AdapterRegistry();
    r.register('slow', delayedAdapter(40, { status: 'completed', reply: 'waited done' }));
    const { sessionId } = startSession(db, { cwd: '.', task: 't' }, bus);
    await spawnSubagent(db, r, { sessionId, alias: 'slow', cli: 'slow', role: 'reviewer', message: 'go' }, bus);

    const sent = await sendToSubagent(db, r, {
      sessionId,
      alias: 'slow',
      message: 'review slowly',
      wait: true,
      softTimeoutMs: 10,
    } as Parameters<typeof sendToSubagent>[2] & { softTimeoutMs: number }, bus);
    expect(sent.status).toBe('running');

    const waited = await waitForSubagent(db, {
      sessionId,
      alias: 'slow',
      afterMessageId: sent.messageId,
      timeoutMs: 500,
    }, bus);

    expect(waited.status).toBe('completed');
    expect(waited.reply).toBe('waited done');
    expect(waited.messageId).toMatch(/^msg_/);
  });

  it('waitForSubagent returns a choice request from a running subagent', async () => {
    const bus = new EventBus();
    const r = new AdapterRegistry();
    r.register('slowchoice', delayedAdapter(40, { status: 'completed', reply: CHOICE_REPLY }));
    const { sessionId } = startSession(db, { cwd: '.', task: 't' }, bus);
    await spawnSubagent(db, r, { sessionId, alias: 'slowchoice', cli: 'slowchoice', role: 'reviewer', message: 'go' }, bus);

    const sent = await sendToSubagent(db, r, {
      sessionId,
      alias: 'slowchoice',
      message: 'review slowly',
      wait: true,
      softTimeoutMs: 10,
    } as Parameters<typeof sendToSubagent>[2] & { softTimeoutMs: number }, bus);
    expect(sent.status).toBe('running');

    const waited = await waitForSubagent(db, {
      sessionId,
      alias: 'slowchoice',
      afterMessageId: sent.messageId,
      timeoutMs: 500,
    }, bus);

    expect(waited.status).toBe('choice_requested');
    expect(waited.choiceRequested).toBe(true);
    expect(waited.choice?.question).toBe('Modal or standalone page?');
  });

  it('sendToSubagent marks timeout results and passes the hard timeout budget to the adapter', async () => {
    const observedHardTimeouts: (number | undefined)[] = [];
    const r = new AdapterRegistry();
    r.register('timeoutspy', hardTimeoutSpyAdapter(observedHardTimeouts));
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, r, { sessionId, alias: 'ts', cli: 'timeoutspy', role: 'reviewer', message: 'go' });

    const res = await sendToSubagent(db, r, {
      sessionId,
      alias: 'ts',
      message: 'review with hard timeout',
      wait: true,
      hardTimeoutMs: 75,
    } as Parameters<typeof sendToSubagent>[2] & { hardTimeoutMs: number });

    expect(res.status).toBe('timeout');
    expect(res.rawTail).toBe('hard timeout after budget');
    expect(observedHardTimeouts).toEqual([75]);
    const row = db.prepare<{ id: string }, { status: string; context_summary: string | null }>('SELECT status, context_summary FROM subagents WHERE id=?').get(sp.subagentId);
    expect(row).toEqual({ status: 'timeout', context_summary: 'hard timeout after budget' });
    const msgs = getMessages(db, sessionId, { subagentId: sp.subagentId });
    expect(msgs.some((m) => m.kind === 'sub_status' && m.content?.includes('timed out'))).toBe(true);
  });

  it('sendToSubagent [BLOCK] propagates native_cli_blocked and updates subagent row', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, registry, { sessionId, alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    const res = await sendToSubagent(db, registry, { sessionId, alias: 'a', message: '[BLOCK]', wait: true });
    expect(res.status).toBe('native_cli_blocked');
    expect(res.rawTail).toBeTruthy();
    const row = db.prepare<{ id: string }, { status: string }>('SELECT status FROM subagents WHERE id=?').get(sp.subagentId);
    expect(row?.status).toBe('native_cli_blocked');
  });

  it('spawnSubagent rejects duplicate alias with alias_in_use', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    await spawnSubagent(db, registry, { sessionId, alias: 'rev', cli: 'mock', role: 'r', message: 'go' });
    await expect(spawnSubagent(db, registry, { sessionId, alias: 'rev', cli: 'mock', role: 'r', message: 'go' })).rejects.toMatchObject({ code: 'alias_in_use' });
  });

  it('spawnSubagent rejects unknown cli with unknown_cli_type', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    await expect(spawnSubagent(db, registry, { sessionId, alias: 'x', cli: 'codex', role: 'r', message: 'go' })).rejects.toMatchObject({ code: 'unknown_cli_type' });
  });

  it('spawnSubagent rolls back the starting row and rethrows when the adapter throws', async () => {
    const r = new AdapterRegistry();
    r.register('throwy', throwingAdapter());
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    await expect(
      spawnSubagent(db, r, { sessionId, alias: 'th', cli: 'throwy', role: 'reviewer', message: 'go' })
    ).rejects.toThrow(/native spawn blew up/);
    // row must be gone
    const rows = db.prepare<{ session_id: string }, { id: string }>(
      'SELECT id FROM subagents WHERE session_id=?'
    ).all(sessionId);
    expect(rows).toHaveLength(0);
  });

  it('sendToSubagent passes the subagent cwd to adapter.send', async () => {
    let observedCwd: string | undefined = undefined;
    const spyAdapter: CliAdapter = {
      cliType: 'mock',
      detect: async () => ({ available: true }),
      capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
      spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
      send: async (input) => { observedCwd = input.cwd; return { status: 'completed', reply: 'ok' }; },
    };
    const r = new AdapterRegistry();
    r.register('spy', spyAdapter);
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    await spawnSubagent(db, r, { sessionId, alias: 'sp', cli: 'spy', role: 'r', cwd: '/my/repo', message: 'go' });
    await sendToSubagent(db, r, { sessionId, alias: 'sp', message: 'hi', wait: true });
    expect(observedCwd).toBe('/my/repo');
  });

  it('spawnSubagent defaults cwd to the session repo_path when omitted', async () => {
    let observedSpawnCwd: string | undefined;
    let observedSendCwd: string | undefined;
    const spyAdapter: CliAdapter = {
      cliType: 'mock',
      detect: async () => ({ available: true }),
      capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
      spawnSubagent: async (i) => {
        observedSpawnCwd = i.cwd;
        return { subagentId: i.subagentId, status: 'ready' };
      },
      send: async (input) => {
        observedSendCwd = input.cwd;
        return { status: 'completed', reply: 'ok' };
      },
    };
    const r = new AdapterRegistry();
    r.register('cwdspy', spyAdapter);
    const { sessionId } = startSession(db, { cwd: '/repo/main', task: 't' });
    await spawnSubagent(db, r, { sessionId, alias: 'sp', cli: 'cwdspy', role: 'r', message: 'go' });
    await sendToSubagent(db, r, { sessionId, alias: 'sp', message: 'hi', wait: true });
    expect(observedSpawnCwd).toBe('/repo/main');
    expect(observedSendCwd).toBe('/repo/main');
  });

  it('sendToSubagent passes the subagent permission_profile to adapter.send', async () => {
    let observed: string | undefined;
    const spyAdapter: CliAdapter = {
      cliType: 'mock',
      detect: async () => ({ available: true }),
      capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
      spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
      send: async (input) => { observed = input.permissionProfile; return { status: 'completed', reply: 'ok' }; },
    };
    const r = new AdapterRegistry();
    r.register('profilespy', spyAdapter);
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    await spawnSubagent(db, r, { sessionId, alias: 'ps', cli: 'profilespy', role: 'r', message: 'go', permissionProfile: 'codex_readonly_auto' });
    await sendToSubagent(db, r, { sessionId, alias: 'ps', message: 'hi', wait: true });
    expect(observed).toBe('codex_readonly_auto');
  });

  it('sendToSubagent passes the subagent model and reasoning_effort to adapter.send', async () => {
    let observed: { model?: string; reasoningEffort?: string } = {};
    const spyAdapter: CliAdapter = {
      cliType: 'mock',
      detect: async () => ({ available: true }),
      capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
      spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
      send: async (input) => {
        observed = { model: input.model, reasoningEffort: input.reasoningEffort };
        return { status: 'completed', reply: 'ok' };
      },
    };
    const r = new AdapterRegistry();
    r.register('modelspy', spyAdapter);
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    await spawnSubagent(db, r, {
      sessionId,
      alias: 'ms',
      cli: 'modelspy',
      role: 'r',
      message: 'go',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
    });
    await sendToSubagent(db, r, { sessionId, alias: 'ms', message: 'hi', wait: true });
    expect(observed).toEqual({ model: 'gpt-5.5', reasoningEffort: 'xhigh' });
  });

  it('sendToSubagent resolves by subagentId when alias omitted', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, registry, { sessionId, alias: 'rev', cli: 'mock', role: 'r', message: 'go' });
    const res = await sendToSubagent(db, registry, { sessionId, subagentId: sp.subagentId, message: 'review', wait: true });
    expect(res.status).toBe('completed');
  });

  it('sendToSubagent maps adapter status:failed → internal_error', async () => {
    const r = new AdapterRegistry();
    r.register('failcli', failingAdapter());
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    await spawnSubagent(db, r, { sessionId, alias: 'fc', cli: 'failcli', role: 'r', message: 'go' });
    try {
      await sendToSubagent(db, r, { sessionId, alias: 'fc', message: 'x', wait: true });
      throw new Error('expected throw');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('internal_error');
      expect((e as Error).message).toContain('codex crashed');
    }
  });

  it('sendToSubagent persists native_session_id from a completed send result', async () => {
    const r = new AdapterRegistry();
    r.register('threadcap', threadCapturingAdapter());
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, r, { sessionId, alias: 'tc', cli: 'threadcap', role: 'r', message: 'go' });
    await sendToSubagent(db, r, { sessionId, alias: 'tc', message: 'hi', wait: true });
    const row = db.prepare<{ id: string }, { native_session_id: string | null }>('SELECT native_session_id FROM subagents WHERE id=?').get(sp.subagentId);
    expect(row?.native_session_id).toBe('thread-xyz');
  });

  it('sendToSubagent passes persisted native_session_id to subsequent sends', async () => {
    const observedNativeSessionIds: (string | undefined)[] = [];
    const r = new AdapterRegistry();
    r.register('threadcap', threadCapturingAdapter(observedNativeSessionIds));
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    await spawnSubagent(db, r, { sessionId, alias: 'tc', cli: 'threadcap', role: 'r', message: 'go' });

    await sendToSubagent(db, r, { sessionId, alias: 'tc', message: 'first', wait: true });
    await sendToSubagent(db, r, { sessionId, alias: 'tc', message: 'second', wait: true });

    expect(observedNativeSessionIds).toEqual([undefined, 'thread-xyz']);
  });

  it('sendToSubagent includes the spawn assignment on the first native send only', async () => {
    const observedMessages: string[] = [];
    const r = new AdapterRegistry();
    r.register('msgcap', messageCapturingThreadAdapter(observedMessages));
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    await spawnSubagent(db, r, {
      sessionId,
      alias: 'rev',
      cli: 'msgcap',
      role: 'reviewer',
      message: 'Full code-review task from spawn.',
    });

    await sendToSubagent(db, r, { sessionId, alias: 'rev', message: 'Continue.', wait: true });
    await sendToSubagent(db, r, { sessionId, alias: 'rev', message: 'User answered. Resume.', wait: true });

    expect(observedMessages).toHaveLength(2);
    expect(observedMessages[0]).toContain('Full code-review task from spawn.');
    expect(observedMessages[0]).toContain('Continue.');
    expect(observedMessages[1]).toBe('User answered. Resume.');
  });

  it('sendToSubagent returns structured choice details when reply contains a choice block', async () => {
    const r = new AdapterRegistry();
    r.register('choicecli', choiceReplyAdapter());
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    await spawnSubagent(db, r, { sessionId, alias: 'chooser', cli: 'choicecli', role: 'r', message: 'go' });
    const res = await sendToSubagent(db, r, { sessionId, alias: 'chooser', message: 'continue', wait: true });
    const choice = (res as typeof res & { choice?: { choiceId?: string; question?: string; options?: { id: string }[]; recommendation?: { option_id: string } } }).choice;
    expect(res.status).toBe('choice_requested');
    expect(choice?.choiceId).toMatch(/^ch_/);
    expect(choice?.question).toBe('Modal or standalone page?');
    expect(choice?.options?.map((o) => o.id)).toEqual(['modal', 'page']);
    expect(choice?.recommendation?.option_id).toBe('page');
    expect(res.reply).toBe('Need a product direction before continuing.');
  });

  it('sendToSubagent returns every structured choice when a reply contains multiple choice blocks', async () => {
    const r = new AdapterRegistry();
    r.register('multichoicecli', multiChoiceReplyAdapter());
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    await spawnSubagent(db, r, { sessionId, alias: 'chooser', cli: 'multichoicecli', role: 'r', message: 'go' });
    const res = await sendToSubagent(db, r, { sessionId, alias: 'chooser', message: 'continue', wait: true });
    const choices = (res as typeof res & { choices?: { choiceId?: string; question?: string; options?: { id: string }[] }[] }).choices;
    expect(res.status).toBe('choice_requested');
    expect(choices?.map((c) => c.question)).toEqual(['Layout?', 'Density?']);
    expect(choices?.map((c) => c.choiceId).every((id) => id?.startsWith('ch_'))).toBe(true);
    expect((res as typeof res & { choice?: { choiceId?: string } }).choice?.choiceId).toBe(choices?.[0].choiceId);
    expect(res.reply).toBe('Need two decisions before continuing.');
    const rows = db.prepare<{ session_id: string }, { question: string }>('SELECT question FROM choices WHERE session_id=?').all(sessionId);
    expect(rows.map((r) => r.question).sort()).toEqual(['Density?', 'Layout?']);
    const choiceMessages = getMessages(db, sessionId).filter((m) => m.kind === 'choice_request');
    expect(choiceMessages).toHaveLength(2);
  });

  it('sendToSubagent validation_error when neither alias nor subagentId', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    await expect(sendToSubagent(db, registry, { sessionId, message: 'x', wait: true })).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('postArtifact + getArtifact', () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const { artifactId } = postArtifact(db, { sessionId, kind: 'summary', content: 'hi', metadata: { a: 1 } });
    const art = getArtifact(db, artifactId);
    expect(art.kind).toBe('summary');
    expect(art.content).toBe('hi');
    expect(JSON.parse(art.metadata_json ?? '{}')).toEqual({ a: 1 });
  });

  it('postArtifact on unknown session throws session_not_found', () => {
    try {
      postArtifact(db, { sessionId: 'sess_does_not_exist', kind: 'summary', content: 'x' });
      throw new Error('expected postArtifact to throw');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('session_not_found');
    }
  });

  it('getArtifact on missing id throws artifact_not_found', () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    postArtifact(db, { sessionId, kind: 'summary', content: 'hi' }); // ensure session exists
    try {
      getArtifact(db, 'art_missing');
      throw new Error('expected getArtifact to throw');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('artifact_not_found');
    }
  });

  it('listSubagentTypes reports mock available with roles, strengths, and weaknesses', async () => {
    const info = await listSubagentTypes(db, registry);
    const mock = info.available_subagents.find((s) => s.type === 'mock');
    expect(mock?.status).toBe('available');
    expect(mock?.roles.length).toBeGreaterThan(0);
    expect(mock?.strengths.length).toBeGreaterThan(0);
    expect(mock?.weaknesses.length).toBeGreaterThan(0);
  });

  it('listSubagentTypes reports model selection metadata from adapters', async () => {
    const metadataAdapter: CliAdapter = {
      cliType: 'mock',
      detect: async () => ({ available: true }),
      capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
      roles: ['reviewer'],
      strengths: 'review',
      weaknesses: 'none',
      modelSelection: {
        model: { parameter: 'model', source: 'mock models', examples: ['mock-pro'] },
        reasoningEffort: { parameter: 'reasoning_effort', source: 'mock effort', values: ['low', 'high'] },
      },
      spawnSubagent: async (i: SpawnInput) => ({ subagentId: i.subagentId, status: 'ready' }),
      send: async (_input: SendInput) => ({ status: 'completed', reply: 'ok' }),
    };
    const r = new AdapterRegistry();
    r.register('modelmeta', metadataAdapter);
    const info = await listSubagentTypes(db, r);
    const modelmeta = info.available_subagents.find((s) => s.type === 'modelmeta');
    expect(modelmeta?.model_selection).toEqual(metadataAdapter.modelSelection);
  });
});
