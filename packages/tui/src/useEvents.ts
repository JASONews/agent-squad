import { useReducer, useEffect, useState } from 'react';
import { reduceEvents, initState, type TuiState } from './store.js';
import { connectSSE, restGet } from './client.js';
import type { AgentSquadEvent } from '@agent-squad/core';

interface SessionRow { id: string; root_task: string; created_at: string; updated_at: string; }
interface MessageRow { id: string; session_id: string; kind: string; created_at: string; }
interface SubagentRow { id: string; alias: string; cli_type: string; status: string; raw_tail: string | null; last_seen_at: string; }
interface ChoiceRow { id: string; session_id: string; question: string; status: string; selected: string | null; created_at: string; resolved_at: string | null; }

/**
 * Initial state load: fetch existing sessions, then their messages/choices,
 * dispatching real-shaped events so `reduceEvents` seeds the full state tree.
 * Falls back silently when the daemon isn't reachable yet (SSE will still try).
 */
async function seedInitialState(baseUrl: string, dispatch: (e: AgentSquadEvent) => void): Promise<void> {
  let sessions: SessionRow[];
  try {
    const res = await restGet<{ sessions: SessionRow[] }>(baseUrl, '/v1/sessions');
    sessions = res.sessions ?? [];
  } catch {
    return; // daemon may not be running yet
  }

  for (const s of sessions) {
    dispatch({ type: 'session_created', payload: { session_id: s.id, task: s.root_task, created_at: s.created_at, updated_at: s.updated_at } });

    // Per-session messages
    try {
      const mr = await restGet<{ messages: MessageRow[] }>(baseUrl, `/v1/sessions/${s.id}/messages`);
      for (const m of mr.messages ?? []) {
        dispatch({ type: 'message_appended', payload: { message_id: m.id, session_id: s.id, kind: m.kind, created_at: m.created_at } });
      }
    } catch { /* session vanished — skip */ }

    // Per-session subagents
    try {
      const sr = await restGet<{ subagents: SubagentRow[] }>(baseUrl, `/v1/sessions/${s.id}/subagents`);
      for (const sub of sr.subagents ?? []) {
        dispatch({
          type: 'subagent_status',
          payload: {
            session_id: s.id,
            subagent_id: sub.id,
            alias: sub.alias,
            cli_type: sub.cli_type,
            status: sub.status,
            last_seen_at: sub.last_seen_at,
          },
        });
        if (sub.raw_tail) {
          dispatch({
            type: sub.status === 'native_cli_blocked' ? 'subagent_blocked' : 'subagent_output',
            payload: {
              session_id: s.id,
              subagent_id: sub.id,
              alias: sub.alias,
              cli_type: sub.cli_type,
              stream: 'stdout',
              text: '',
              raw_tail: sub.raw_tail,
              last_seen_at: sub.last_seen_at,
            },
          });
        }
      }
    } catch { /* session vanished — skip */ }

    // Per-session choices
    try {
      const cr = await restGet<{ choices: ChoiceRow[] }>(baseUrl, `/v1/sessions/${s.id}/choices`);
      for (const c of cr.choices ?? []) {
        dispatch({ type: 'choice_created', payload: { choice_id: c.id, session_id: s.id, question: c.question, created_at: c.created_at } });
        if (c.status === 'resolved' || c.selected) {
          dispatch({ type: 'choice_resolved', payload: { choice_id: c.id, session_id: s.id, selected: c.selected, resolved_at: c.resolved_at } });
        }
      }
    } catch { /* session vanished — skip */ }
  }
}

export function useEvents(baseUrl: string): TuiState {
  const [state, dispatch] = useReducer(reduceEvents, undefined, initState);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Initial state load via REST (seeds existing sessions + their messages/choices)
    seedInitialState(baseUrl, dispatch).catch(() => { /* ignore — SSE still connects */ });
    // Connect SSE for live updates (fetch-streaming; Node has no global EventSource)
    const disconnect = connectSSE(baseUrl, (e: AgentSquadEvent) => {
      if (e.type === 'hello') setConnected(true);
      dispatch(e);
    });
    return () => disconnect();
  }, [baseUrl]);

  return state;
}
