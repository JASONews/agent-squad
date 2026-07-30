import { describe, it, expect } from 'vitest';
import { reduceEvents, initState } from '../src/store.js';
import type { AgentSquadEvent } from '@agent-squad/core';

function feed(events: AgentSquadEvent[]) {
  return events.reduce(reduceEvents, initState());
}

describe('reduceEvents', () => {
  it('session_created adds a session', () => {
    const s = feed([{ type: 'session_created', payload: { session_id: 'sess_1', task: 'build it' } }]);
    expect(Object.keys(s.sessions)).toContain('sess_1');
    expect(s.sessions['sess_1'].task).toBe('build it');
  });

  it('tracks last active time from session and later events', () => {
    const s = feed([
      { type: 'session_created', payload: { session_id: 'sess_1', task: 't', created_at: '2026-07-05T10:00:00.000Z' } },
      { type: 'message_appended', payload: { message_id: 'msg_1', session_id: 'sess_1', kind: 'user_task', created_at: '2026-07-05T10:05:00.000Z' } },
      { type: 'choice_resolved', payload: { choice_id: 'ch_1', session_id: 'sess_1', selected: 'page', resolved_at: '2026-07-05T10:03:00.000Z' } },
      { type: 'artifact_posted', payload: { artifact_id: 'art_1', session_id: 'sess_1', kind: 'summary', created_at: '2026-07-05T10:07:00.000Z' } },
    ]);
    expect(s.sessions['sess_1'].lastActiveAt).toBe('2026-07-05T10:07:00.000Z');
  });

  it('message_appended appends to session messages', () => {
    const s = feed([
      { type: 'session_created', payload: { session_id: 'sess_1', task: 't' } },
      { type: 'message_appended', payload: { message_id: 'msg_1', session_id: 'sess_1', kind: 'user_task' } },
      { type: 'message_appended', payload: { message_id: 'msg_2', session_id: 'sess_1', kind: 'main_to_sub' } },
    ]);
    expect(s.messages['sess_1']).toHaveLength(2);
    expect(s.messages['sess_1'][0].id).toBe('msg_1');
  });

  it('subagent_status updates subagent status', () => {
    const s = feed([
      { type: 'session_created', payload: { session_id: 'sess_1', task: 't' } },
      { type: 'subagent_status', payload: { session_id: 'sess_1', subagent_id: 'sub_1', alias: 'rev', cli_type: 'codex', status: 'ready' } },
      { type: 'subagent_status', payload: { session_id: 'sess_1', subagent_id: 'sub_1', alias: 'rev', cli_type: 'codex', status: 'completed' } },
    ]);
    const sub = s.subagents['sess_1'].find((x) => x.id === 'sub_1');
    expect(sub?.status).toBe('completed');
  });

  it('subagent_blocked marks subagent blocked', () => {
    const s = feed([
      { type: 'session_created', payload: { session_id: 'sess_1', task: 't' } },
      { type: 'subagent_status', payload: { session_id: 'sess_1', subagent_id: 'sub_1', alias: 'a', cli_type: 'agy', status: 'ready' } },
      { type: 'subagent_blocked', payload: { session_id: 'sess_1', subagent_id: 'sub_1', raw_tail: 'awaiting approval' } },
    ]);
    const sub = s.subagents['sess_1'].find((x) => x.id === 'sub_1');
    expect(sub?.blocked).toBe(true);
    expect(sub?.rawTail).toBe('awaiting approval');
  });

  it('subagent_output updates the visible raw tail', () => {
    const s = feed([
      { type: 'session_created', payload: { session_id: 'sess_1', task: 't' } },
      { type: 'subagent_status', payload: { session_id: 'sess_1', subagent_id: 'sub_1', alias: 'rev', cli_type: 'codex', status: 'running' } },
      { type: 'subagent_output', payload: { session_id: 'sess_1', subagent_id: 'sub_1', alias: 'rev', cli_type: 'codex', stream: 'stdout', text: 'line 2', raw_tail: 'line 1\nline 2', last_seen_at: '2026-07-05T10:05:00.000Z' } },
    ]);
    const sub = s.subagents['sess_1'].find((x) => x.id === 'sub_1');
    expect(sub?.status).toBe('running');
    expect(sub?.rawTail).toBe('line 1\nline 2');
    expect(sub?.lastOutputAt).toBe('2026-07-05T10:05:00.000Z');
  });

  it('choice_created adds pending choice; choice_resolved marks resolved', () => {
    const s = feed([
      { type: 'session_created', payload: { session_id: 'sess_1', task: 't' } },
      { type: 'choice_created', payload: { choice_id: 'ch_1', session_id: 'sess_1', question: 'modal or page?' } },
      { type: 'choice_resolved', payload: { choice_id: 'ch_1', session_id: 'sess_1', selected: 'page' } },
    ]);
    const ch = s.choices['sess_1'].find((x) => x.id === 'ch_1');
    expect(ch?.status).toBe('resolved');
    expect(ch?.selected).toBe('page');
  });

  it('artifact_posted adds artifact ref', () => {
    const s = feed([
      { type: 'session_created', payload: { session_id: 'sess_1', task: 't' } },
      { type: 'artifact_posted', payload: { artifact_id: 'art_1', session_id: 'sess_1', kind: 'review_json' } },
    ]);
    expect(s.artifacts['sess_1']).toContainEqual({ id: 'art_1', kind: 'review_json' });
  });

  it('hello event is a no-op', () => {
    const s = feed([{ type: 'hello', payload: {} }]);
    expect(Object.keys(s.sessions)).toHaveLength(0);
  });
});
