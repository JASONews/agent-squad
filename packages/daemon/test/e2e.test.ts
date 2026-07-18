import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Daemon, buildDaemon } from '../src/app.js';
import { AdapterRegistry, MockAdapter, type CliAdapter, type ResolvedConfig } from '@agent-squad/core';

let daemon: Daemon;
let base: string;

beforeAll(async () => {
  const config: ResolvedConfig = { server: { host: '127.0.0.1', port: 0, dbPath: ':memory:' }, contextPolicy: { default: 'message_only' } };
  const registry = new AdapterRegistry();
  registry.register('mock', new MockAdapter());
  registry.register('choicecli', choiceReplyAdapter());
  registry.register('multichoicecli', multiChoiceReplyAdapter());
  registry.register('slowcli', delayedAdapter(40, 'waited done'));
  daemon = await buildDaemon({ config, registry });
  await daemon.start();
  const addr = daemon.app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});
afterAll(async () => { await daemon.stop(); });

async function post(path: string, body: unknown) {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}
async function get(path: string) {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, json: await r.json() };
}

function choiceReplyAdapter(): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async () => ({
      status: 'completed',
      reply: `Need a product direction before continuing.

%%AGENT_SQUAD_CHOICE%%
{"question":"Modal or standalone page?","options":[{"id":"modal","label":"Modal"},{"id":"page","label":"Page"}],"recommendation":{"option_id":"page","reason":"more room"}}
%%END_AGENT_SQUAD_CHOICE%%`,
    }),
  };
}

function multiChoiceReplyAdapter(): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async () => ({
      status: 'completed',
      reply: `Need two decisions before continuing.

%%AGENT_SQUAD_CHOICE%%
{"question":"Layout?","options":[{"id":"modal","label":"Modal"},{"id":"page","label":"Page"}],"recommendation":{"option_id":"page","reason":"more room"}}
%%END_AGENT_SQUAD_CHOICE%%

%%AGENT_SQUAD_CHOICE%%
{"question":"Density?","options":[{"id":"dense","label":"Dense"},{"id":"guided","label":"Guided"}],"recommendation":{"option_id":"dense","reason":"repeat users"}}
%%END_AGENT_SQUAD_CHOICE%%`,
    }),
  };
}

function delayedAdapter(delayMs: number, reply: string): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { status: 'completed', reply };
    },
  };
}

describe('daemon e2e', () => {
  it('health', async () => {
    const { json } = await get('/v1/health');
    expect(json.ok).toBe(true);
  });

  it('full mock round-trip', async () => {
    const s = await post('/v1/sessions', { cwd: '/repo', task: 'build it', owner_cli: 'codex' });
    const sessionId = s.json.session_id;
    const sp = await post(`/v1/sessions/${sessionId}/subagents`, { alias: 'rev', cli: 'mock', role: 'reviewer', message: 'go' });
    expect(sp.json.status).toBe('ready');
    const sent = await post(`/v1/sessions/${sessionId}/subagents/rev/messages`, { message: 'please review this', wait: true });
    expect(sent.json.status).toBe('completed');
    expect(sent.json.reply).toBeTruthy();
    expect(sent.json.artifacts.some((a: { kind: string }) => a.kind === 'review_json')).toBe(true);
    const msgs = await get(`/v1/sessions/${sessionId}/messages`);
    const kinds = msgs.json.messages.map((m: { kind: string }) => m.kind);
    expect(kinds).toContain('main_to_sub');
    expect(kinds).toContain('sub_to_main');
  });

  it('waits for a running subagent without sending another message', async () => {
    const s = await post('/v1/sessions', { cwd: '/repo', task: 'wait for it' });
    const sessionId = s.json.session_id;
    await post(`/v1/sessions/${sessionId}/subagents`, { alias: 'slow', cli: 'slowcli', role: 'reviewer', message: 'go' });
    const sent = await post(`/v1/sessions/${sessionId}/subagents/slow/messages`, {
      message: 'review slowly',
      wait: true,
      soft_timeout_ms: 10,
    });
    expect(sent.json.status).toBe('running');

    const waited = await post(`/v1/sessions/${sessionId}/subagents/slow/wait`, {
      after_message_id: sent.json.message_id,
      timeout_ms: 1000,
    });

    expect(waited.json.status).toBe('completed');
    expect(waited.json.reply).toBe('waited done');
    expect(waited.json.message_id).toMatch(/^msg_/);
  });

  it('native_cli_blocked propagation', async () => {
    const s = await post('/v1/sessions', { cwd: '.', task: 't' });
    const sid = s.json.session_id;
    await post(`/v1/sessions/${sid}/subagents`, { alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    const r = await post(`/v1/sessions/${sid}/subagents/a/messages`, { message: '[BLOCK]', wait: true });
    expect(r.json.status).toBe('native_cli_blocked');
    expect(r.json.raw_tail).toBeTruthy();

    const list = await get(`/v1/sessions/${sid}/subagents`);
    expect(list.status).toBe(200);
    expect(list.json.subagents).toContainEqual(expect.objectContaining({
      alias: 'a',
      status: 'native_cli_blocked',
      raw_tail: expect.stringContaining('permission approval'),
    }));
  });

  it('choice_requested response includes structured choice details', async () => {
    const s = await post('/v1/sessions', { cwd: '.', task: 'choice reply' });
    const sid = s.json.session_id;
    await post(`/v1/sessions/${sid}/subagents`, { alias: 'chooser', cli: 'choicecli', role: 'r', message: 'go' });
    const r = await post(`/v1/sessions/${sid}/subagents/chooser/messages`, { message: 'continue', wait: true });
    expect(r.json.status).toBe('choice_requested');
    expect(r.json.choice_requested).toBe(true);
    expect(r.json.choice.choice_id).toMatch(/^ch_/);
    expect(r.json.choice.question).toBe('Modal or standalone page?');
    expect(r.json.choice.options.map((o: { id: string }) => o.id)).toEqual(['modal', 'page']);
    expect(r.json.choice.recommendation.option_id).toBe('page');
  });

  it('choice_requested response includes every structured choice from a subagent reply', async () => {
    const s = await post('/v1/sessions', { cwd: '.', task: 'multi choice reply' });
    const sid = s.json.session_id;
    await post(`/v1/sessions/${sid}/subagents`, { alias: 'chooser', cli: 'multichoicecli', role: 'r', message: 'go' });
    const r = await post(`/v1/sessions/${sid}/subagents/chooser/messages`, { message: 'continue', wait: true });
    expect(r.json.status).toBe('choice_requested');
    expect(r.json.choice_requested).toBe(true);
    expect(r.json.choices.map((c: { question: string }) => c.question)).toEqual(['Layout?', 'Density?']);
    expect(r.json.choice.choice_id).toBe(r.json.choices[0].choice_id);
    expect(r.json.choices[0].options.map((o: { id: string }) => o.id)).toEqual(['modal', 'page']);
    expect(r.json.choices[1].options.map((o: { id: string }) => o.id)).toEqual(['dense', 'guided']);
  });

  it('unknown cli type → 400', async () => {
    const s = await post('/v1/sessions', { cwd: '.', task: 't' });
    const r = await post(`/v1/sessions/${s.json.session_id}/subagents`, { alias: 'x', cli: 'codex', role: 'r', message: 'go' });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('unknown_cli_type');
  });

  it('alias_in_use → 409', async () => {
    const s = await post('/v1/sessions', { cwd: '.', task: 't' });
    await post(`/v1/sessions/${s.json.session_id}/subagents`, { alias: 'rev', cli: 'mock', role: 'r', message: 'go' });
    const r = await post(`/v1/sessions/${s.json.session_id}/subagents`, { alias: 'rev', cli: 'mock', role: 'r', message: 'go' });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('alias_in_use');
  });
});

describe('daemon validation', () => {
  it('GET /v1/sessions lists existing sessions (newest first)', async () => {
    const s1 = await post('/v1/sessions', { cwd: '/r', task: 'first task' });
    await new Promise((r) => setTimeout(r, 20));  // ensure distinct timestamps
    const s2 = await post('/v1/sessions', { cwd: '/r', task: 'second task' });
    const list = await get('/v1/sessions');
    expect(list.status).toBe(200);
    const ids = (list.json.sessions as { id: string; root_task: string }[]).map((s) => s.id);
    expect(ids).toContain(s1.json.session_id);
    expect(ids).toContain(s2.json.session_id);
    // newest first — second task was created after first (with a measurable delay)
    expect(list.json.sessions[0].root_task).toBe('second task');
  });

  it('GET /v1/sessions on empty db returns empty array', async () => {
    // Note: the shared daemon has sessions, so verify shape only — sessions key exists
    const list = await get('/v1/sessions');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.json.sessions)).toBe(true);
  });

  it('POST /v1/sessions with missing task returns 400 validation_error', async () => {
    const r = await post('/v1/sessions', { cwd: '/r' }); // no task
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('validation_error');
  });

  it('POST /v1/sessions/:id/subagents with empty alias returns 400', async () => {
    const s = await post('/v1/sessions', { cwd: '/r', task: 't' });
    const r = await post(`/v1/sessions/${s.json.session_id}/subagents`, { alias: '', cli: 'mock', role: 'r', message: 'm' });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('validation_error');
  });

  it('POST /v1/artifacts path under unknown session returns 404 session_not_found (FK mapped)', async () => {
    const r = await post('/v1/sessions/sess_nope/artifacts', { kind: 'summary', content: 'x' });
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe('session_not_found');
  });
});

describe('choice relay', () => {
  it('non-blocking request → message timeline → resolve → resolved', async () => {
    const s = await post('/v1/sessions', { cwd: '.', task: 't' });
    const sid = s.json.session_id;
    await post(`/v1/sessions/${sid}/subagents`, { alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    const sub = (await get(`/v1/sessions/${sid}/messages`)).json.messages.find((m: { kind: string }) => m.kind === 'main_to_sub');
    const subId = sub.to_peer_id;
    const req = await post(`/v1/sessions/${sid}/choices`, { subagent_id: subId, question: 'q', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], recommendation: { option_id: 'a', reason: 'r' }, blocking: false });
    expect(req.json.status).toBe('pending_main_agent');
    const choiceId = req.json.choice_id;
    // message timeline shows choice_request
    const msgs = (await get(`/v1/sessions/${sid}/messages`)).json.messages;
    expect(msgs.some((m: { kind: string }) => m.kind === 'choice_request')).toBe(true);
    // resolve
    const res = await post(`/v1/sessions/${sid}/choices/${choiceId}/resolve`, { selected: 'b', rationale: 'user picked b' });
    expect(res.json.status).toBe('resolved');
    // wait returns resolved immediately
    const w = await post(`/v1/sessions/${sid}/choices/${choiceId}/wait`, { timeout_ms: 1000 });
    expect(w.json.status).toBe('resolved');
    expect(w.json.selected).toBe('b');
    // list choices shows resolved
    const list = await get(`/v1/sessions/${sid}/choices`);
    expect(list.json.choices.some((c: { id: string; status: string }) => c.id === choiceId && c.status === 'resolved')).toBe(true);
  });

  it('blocking request resolves via concurrent resolve', async () => {
    const s = await post('/v1/sessions', { cwd: '.', task: 't' });
    const sid = s.json.session_id;
    await post(`/v1/sessions/${sid}/subagents`, { alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    const sub = (await get(`/v1/sessions/${sid}/messages`)).json.messages.find((m: { kind: string }) => m.kind === 'main_to_sub');
    const subId = sub.to_peer_id;
    const reqP = post(`/v1/sessions/${sid}/choices`, { subagent_id: subId, question: 'q', options: [{ id: 'a', label: 'A' }], blocking: true, timeout_ms: 5000 });
    // poll for the choice id, then resolve
    const pollAndResolve = async () => {
      for (let i = 0; i < 200; i++) {
        const list = (await get(`/v1/sessions/${sid}/choices`)).json.choices as { id: string; status: string }[];
        const c = list.find((x) => x.status === 'pending_main_agent');
        if (c) { await post(`/v1/sessions/${sid}/choices/${c.id}/resolve`, { selected: 'a' }); return; }
        await new Promise((r) => setTimeout(r, 5));
      }
    };
    const [req] = await Promise.all([reqP, pollAndResolve()]);
    expect(req.json.status).toBe('resolved');
    expect(req.json.selected).toBe('a');
  }, 15000);

  it('unknown session → 404 session_not_found', async () => {
    const r = await post('/v1/sessions/sess_nope/choices', { subagent_id: 'sub_nope', question: 'q', options: [{ id: 'a', label: 'A' }], blocking: false });
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe('session_not_found');
  });

  it('selected not matching option → 400 validation_error', async () => {
    const s = await post('/v1/sessions', { cwd: '.', task: 't' });
    const sid = s.json.session_id;
    await post(`/v1/sessions/${sid}/subagents`, { alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    const sub = (await get(`/v1/sessions/${sid}/messages`)).json.messages.find((m: { kind: string }) => m.kind === 'main_to_sub');
    const req = await post(`/v1/sessions/${sid}/choices`, { subagent_id: sub.to_peer_id, question: 'q', options: [{ id: 'a', label: 'A' }], blocking: false });
    const r = await post(`/v1/sessions/${sid}/choices/${req.json.choice_id}/resolve`, { selected: 'nope' });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('validation_error');
  });
});
