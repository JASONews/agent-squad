import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/db/client.js';
import type { Db } from '../src/db/client.js';
import { AdapterRegistry, MockAdapter } from '../src/index.js';
import { startSession } from '../src/services/sessions.js';
import { spawnSubagent } from '../src/services/subagents.js';
import { getMessages } from '../src/services/messages.js';
import { createChoices } from '../src/services/choices.js';
import { ChoicesWaiter } from '../src/services/choices-waiter.js';

let db: Db;
let choices: ReturnType<typeof createChoices>;
let registry: AdapterRegistry;
beforeEach(() => {
  db = openDb({ server: { host: '', port: 0, dbPath: ':memory:' }, contextPolicy: { default: 'message_only' } });
  registry = new AdapterRegistry();
  registry.register('mock', new MockAdapter());
  choices = createChoices(db, new ChoicesWaiter());
});

describe('ChoicesService — request_choice non-blocking', () => {
  it('returns pending_main_agent + appends a choice_request message', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, registry, { sessionId, alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    const r = await choices.requestChoice({
      sessionId, subagentId: sp.subagentId, question: 'modal or page?',
      options: [{ id: 'modal', label: 'Modal' }, { id: 'page', label: 'Page' }],
      recommendation: { option_id: 'page', reason: 'more space' }, blocking: false,
    });
    expect(r.status).toBe('pending_main_agent');
    expect(r.choiceId).toMatch(/^ch_/);
    const msgs = getMessages(db, sessionId);
    expect(msgs.some((m) => m.kind === 'choice_request')).toBe(true);
  });

  it('rejects empty options (validation_error)', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, registry, { sessionId, alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    await expect(choices.requestChoice({ sessionId, subagentId: sp.subagentId, question: 'q', options: [], blocking: false }))
      .rejects.toMatchObject({ code: 'validation_error' });
  });

  it('rejects recommendation without reason (validation_error)', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, registry, { sessionId, alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    await expect(choices.requestChoice({
      sessionId, subagentId: sp.subagentId, question: 'q',
      options: [{ id: 'a', label: 'A' }], recommendation: { option_id: 'a' } as { option_id: string; reason: string }, blocking: false,
    })).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('rejects unknown session (session_not_found)', async () => {
    await expect(choices.requestChoice({ sessionId: 'sess_nope', subagentId: 'sub_nope', question: 'q', options: [{ id: 'a', label: 'A' }], blocking: false }))
      .rejects.toMatchObject({ code: 'session_not_found' });
  });

  it('rejects unknown subagent (subagent_not_found)', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    await expect(choices.requestChoice({ sessionId, subagentId: 'sub_nope', question: 'q', options: [{ id: 'a', label: 'A' }], blocking: false }))
      .rejects.toMatchObject({ code: 'subagent_not_found' });
  });
});

describe('ChoicesService — blocking + resolve (concurrent)', () => {
  it('blocking request_choice resolves when a concurrent resolve_choice arrives', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, registry, { sessionId, alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    const request = choices.requestChoice({
      sessionId, subagentId: sp.subagentId, question: 'q',
      options: [{ id: 'modal', label: 'Modal' }, { id: 'page', label: 'Page' }], blocking: true, timeoutMs: 5000,
    });
    // Drive deterministically: poll the DB until the choice row exists, then resolve it.
    const resolveAfterCreated = async () => {
      for (let i = 0; i < 200; i++) {
        const row = db.prepare<{ session_id: string }, { id: string }>('SELECT id FROM choices WHERE session_id=?').get(sessionId);
        if (row) { await choices.resolveChoice({ sessionId, choiceId: row.id, selected: 'page', rationale: 'user picked' }); return; }
        await new Promise((r) => setTimeout(r, 5));
      }
    };
    const [reqResult] = await Promise.all([request, resolveAfterCreated()]);
    expect(reqResult.status).toBe('resolved');
    expect(reqResult.selected).toBe('page');
    expect(reqResult.rationale).toBe('user picked');
  }, 15000);

  it('blocking request_choice times out → expired + DB row expired', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, registry, { sessionId, alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    const r = await choices.requestChoice({
      sessionId, subagentId: sp.subagentId, question: 'q',
      options: [{ id: 'a', label: 'A' }], blocking: true, timeoutMs: 50,
    });
    expect(r.status).toBe('expired');
    const row = choices.getChoice(r.choiceId);
    expect(row.status).toBe('expired');
  }, 10000);
});

describe('ChoicesService — resolve_choice', () => {
  it('rejects selected not matching an option id (validation_error)', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, registry, { sessionId, alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    const r = await choices.requestChoice({ sessionId, subagentId: sp.subagentId, question: 'q', options: [{ id: 'a', label: 'A' }], blocking: false });
    await expect(choices.resolveChoice({ sessionId, choiceId: r.choiceId, selected: 'nope' }))
      .rejects.toMatchObject({ code: 'validation_error' });
  });

  it('idempotent on already-resolved', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, registry, { sessionId, alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    const r = await choices.requestChoice({ sessionId, subagentId: sp.subagentId, question: 'q', options: [{ id: 'a', label: 'A' }], blocking: false });
    await choices.resolveChoice({ sessionId, choiceId: r.choiceId, selected: 'a' });
    // second resolve: no throw, no change
    await expect(choices.resolveChoice({ sessionId, choiceId: r.choiceId, selected: 'a' })).resolves.toEqual({ status: 'resolved' });
    const row = choices.getChoice(r.choiceId);
    expect(row.status).toBe('resolved');
  });

  it('appends a choice_resolved message', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, registry, { sessionId, alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    const r = await choices.requestChoice({ sessionId, subagentId: sp.subagentId, question: 'q', options: [{ id: 'a', label: 'A' }], blocking: false });
    await choices.resolveChoice({ sessionId, choiceId: r.choiceId, selected: 'a' });
    const msgs = getMessages(db, sessionId);
    expect(msgs.some((m) => m.kind === 'choice_resolved')).toBe(true);
  });
});

describe('ChoicesService — wait_choice', () => {
  it('returns immediately with resolved when the choice is already resolved', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, registry, { sessionId, alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    const r = await choices.requestChoice({ sessionId, subagentId: sp.subagentId, question: 'q', options: [{ id: 'a', label: 'A' }], blocking: false });
    await choices.resolveChoice({ sessionId, choiceId: r.choiceId, selected: 'a', rationale: 'because' });
    const w = await choices.waitChoice({ sessionId, choiceId: r.choiceId, timeoutMs: 1000 });
    expect(w.status).toBe('resolved');
    expect(w.selected).toBe('a');
  });

  it('blocks then resolves when a concurrent resolve arrives', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, registry, { sessionId, alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    const r = await choices.requestChoice({ sessionId, subagentId: sp.subagentId, question: 'q', options: [{ id: 'a', label: 'A' }], blocking: false });
    const wait = choices.waitChoice({ sessionId, choiceId: r.choiceId, timeoutMs: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await choices.resolveChoice({ sessionId, choiceId: r.choiceId, selected: 'a' });
    const w = await wait;
    expect(w.status).toBe('resolved');
    expect(w.selected).toBe('a');
  });

  it('timeout → {status:"pending"} and does NOT mutate the DB row', async () => {
    const { sessionId } = startSession(db, { cwd: '.', task: 't' });
    const sp = await spawnSubagent(db, registry, { sessionId, alias: 'a', cli: 'mock', role: 'r', message: 'go' });
    const r = await choices.requestChoice({ sessionId, subagentId: sp.subagentId, question: 'q', options: [{ id: 'a', label: 'A' }], blocking: false });
    const w = await choices.waitChoice({ sessionId, choiceId: r.choiceId, timeoutMs: 50 });
    expect(w.status).toBe('pending');
    expect(choices.getChoice(r.choiceId).status).toBe('pending_main_agent');  // unchanged
  }, 10000);
});
