import type { AgentSquadEvent } from '@agent-squad/core';

export interface SessionSummary { id: string; task: string; lastActiveAt: string | null; }
export interface MessageSummary { id: string; kind: string; }
export interface SubagentSummary { id: string; alias: string; cliType: string; status: string; blocked: boolean; rawTail: string | null; }
export interface ChoiceSummary { id: string; question: string; status: string; selected: string | null; }
export interface ArtifactSummary { id: string; kind: string; }

export interface TuiState {
  sessions: Record<string, SessionSummary>;
  messages: Record<string, MessageSummary[]>;
  subagents: Record<string, SubagentSummary[]>;
  choices: Record<string, ChoiceSummary[]>;
  artifacts: Record<string, ArtifactSummary[]>;
}

export function initState(): TuiState {
  return { sessions: {}, messages: {}, subagents: {}, choices: {}, artifacts: {} };
}

function payloadTime(payload: Record<string, unknown>): string | null {
  for (const key of ['last_active_at', 'updated_at', 'resolved_at', 'created_at', 'last_seen_at']) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return new Date().toISOString();
}

function newerTime(a: string | null, b: string | null): string | null {
  if (!b) return a;
  if (!a) return b;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

function touchSession(state: TuiState, sessionId: string, at: string | null): TuiState {
  const session = state.sessions[sessionId];
  if (!session || !at) return state;
  return {
    ...state,
    sessions: {
      ...state.sessions,
      [sessionId]: { ...session, lastActiveAt: newerTime(session.lastActiveAt, at) },
    },
  };
}

export function reduceEvents(state: TuiState, event: AgentSquadEvent): TuiState {
  switch (event.type) {
    case 'session_created': {
      const sid = event.payload.session_id as string;
      return {
        ...state,
        sessions: {
          ...state.sessions,
          [sid]: { id: sid, task: event.payload.task as string, lastActiveAt: payloadTime(event.payload) },
        },
      };
    }
    case 'message_appended': {
      const sid = event.payload.session_id as string;
      const msg = { id: event.payload.message_id as string, kind: event.payload.kind as string };
      return touchSession(
        { ...state, messages: { ...state.messages, [sid]: [...(state.messages[sid] ?? []), msg] } },
        sid,
        payloadTime(event.payload),
      );
    }
    case 'subagent_status': {
      const sid = event.payload.session_id as string;
      const subId = event.payload.subagent_id as string;
      const subs = state.subagents[sid] ?? [];
      const existing = subs.find((s) => s.id === subId);
      const updated: SubagentSummary = {
        id: subId, alias: event.payload.alias as string, cliType: event.payload.cli_type as string,
        status: event.payload.status as string,
        blocked: event.payload.status === 'native_cli_blocked',
        rawTail: existing?.rawTail ?? null,
      };
      const newSubs = existing ? subs.map((s) => (s.id === subId ? { ...updated, rawTail: s.rawTail } : s)) : [...subs, updated];
      return touchSession(
        { ...state, subagents: { ...state.subagents, [sid]: newSubs } },
        sid,
        payloadTime(event.payload),
      );
    }
    case 'subagent_blocked': {
      const sid = event.payload.session_id as string;
      const subId = event.payload.subagent_id as string;
      const subs = state.subagents[sid] ?? [];
      const newSubs = subs.map((s) => s.id === subId ? { ...s, blocked: true, status: 'native_cli_blocked', rawTail: event.payload.raw_tail as string } : s);
      return touchSession(
        { ...state, subagents: { ...state.subagents, [sid]: newSubs } },
        sid,
        payloadTime(event.payload),
      );
    }
    case 'subagent_output': {
      const sid = event.payload.session_id as string;
      const subId = event.payload.subagent_id as string;
      const subs = state.subagents[sid] ?? [];
      const existing = subs.find((s) => s.id === subId);
      const updated: SubagentSummary = {
        id: subId,
        alias: existing?.alias ?? event.payload.alias as string,
        cliType: existing?.cliType ?? event.payload.cli_type as string,
        status: existing?.status ?? 'running',
        blocked: existing?.blocked ?? false,
        rawTail: event.payload.raw_tail as string,
      };
      const newSubs = existing ? subs.map((s) => (s.id === subId ? updated : s)) : [...subs, updated];
      return touchSession(
        { ...state, subagents: { ...state.subagents, [sid]: newSubs } },
        sid,
        payloadTime(event.payload),
      );
    }
    case 'choice_created': {
      const sid = event.payload.session_id as string;
      const ch = { id: event.payload.choice_id as string, question: event.payload.question as string, status: 'pending', selected: null };
      return touchSession(
        { ...state, choices: { ...state.choices, [sid]: [...(state.choices[sid] ?? []), ch] } },
        sid,
        payloadTime(event.payload),
      );
    }
    case 'choice_resolved': {
      const sid = event.payload.session_id as string;
      const cid = event.payload.choice_id as string;
      const newChoices = (state.choices[sid] ?? []).map((c) => c.id === cid ? { ...c, status: 'resolved', selected: event.payload.selected as string } : c);
      return touchSession(
        { ...state, choices: { ...state.choices, [sid]: newChoices } },
        sid,
        payloadTime(event.payload),
      );
    }
    case 'artifact_posted': {
      const sid = event.payload.session_id as string;
      const art = { id: event.payload.artifact_id as string, kind: event.payload.kind as string };
      return touchSession(
        { ...state, artifacts: { ...state.artifacts, [sid]: [...(state.artifacts[sid] ?? []), art] } },
        sid,
        payloadTime(event.payload),
      );
    }
    case 'hello':
    default:
      return state;
  }
}
