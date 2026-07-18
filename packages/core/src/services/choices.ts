import type { Db } from '../db/client.js';
import { AppError } from '../errors.js';
import { newId } from '../ids.js';
import { appendMessage } from './messages.js';
import { ChoicesWaiter, type WaitChoiceResult } from './choices-waiter.js';
import type { EventBus } from '../events.js';

export interface ChoiceOption { id: string; label: string; tradeoff?: string }
export interface ChoiceRecommendation { option_id: string; reason: string; confidence?: 'low' | 'medium' | 'high' }

export interface RequestChoiceInput {
  sessionId: string; subagentId: string; question: string;
  options: ChoiceOption[]; recommendation?: ChoiceRecommendation; blocking: boolean;
  timeoutMs?: number;
}
export interface RequestChoiceResult {
  choiceId: string;
  status: 'pending_main_agent' | 'resolved' | 'expired';
  selected?: string;
  rationale?: string;
}

export interface ResolveChoiceInput { sessionId: string; choiceId: string; selected: string; rationale?: string }
export interface ResolveChoiceResult { status: 'resolved' }

export interface WaitChoiceInput { sessionId: string; choiceId: string; timeoutMs?: number }

export interface ChoiceRow {
  id: string; session_id: string; requester_subagent_id: string; target_peer_id: string | null;
  question: string; options_json: string; recommendation_json: string | null;
  status: string; selected: string | null; rationale: string | null;
  created_at: string; resolved_at: string | null;
}

const DEFAULT_TIMEOUT_MS = 300_000;

export interface ChoicesService {
  requestChoice(input: RequestChoiceInput): Promise<RequestChoiceResult>;
  resolveChoice(input: ResolveChoiceInput): Promise<ResolveChoiceResult>;
  waitChoice(input: WaitChoiceInput): Promise<WaitChoiceResult>;
  getChoice(choiceId: string): ChoiceRow;
}

function validateSessionAndSubagent(db: Db, sessionId: string, subagentId: string): void {
  const s = db.prepare<[string], { id: string }>('SELECT id FROM sessions WHERE id=?').get(sessionId);
  if (!s) throw new AppError('session_not_found', `session not found: ${sessionId}`);
  const sub = db.prepare<[string, string], { id: string }>('SELECT id FROM subagents WHERE id=? AND session_id=?').get(subagentId, sessionId);
  if (!sub) throw new AppError('subagent_not_found', `subagent not found: ${subagentId} in session ${sessionId}`);
}

export function createChoices(db: Db, waiter: ChoicesWaiter, bus?: EventBus): ChoicesService {
  function getChoice(choiceId: string): ChoiceRow {
    const row = db.prepare<[string], ChoiceRow>('SELECT * FROM choices WHERE id=?').get(choiceId);
    if (!row) throw new AppError('validation_error', `choice not found: ${choiceId}`);
    return row;
  }

  async function requestChoice(input: RequestChoiceInput): Promise<RequestChoiceResult> {
    validateSessionAndSubagent(db, input.sessionId, input.subagentId);
    if (!Array.isArray(input.options) || input.options.length === 0) {
      throw new AppError('validation_error', 'request_choice requires a non-empty options array');
    }
    for (const o of input.options) {
      if (!o.id || !o.label) throw new AppError('validation_error', 'each option requires id and label');
    }
    if (input.recommendation && (!input.recommendation.reason || !input.recommendation.reason.trim())) {
      throw new AppError('validation_error', 'recommendation requires a non-empty reason');
    }
    const choiceId = newId('ch');
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO choices (id, session_id, requester_subagent_id, question, options_json, recommendation_json, status, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).run(
      choiceId, input.sessionId, input.subagentId, input.question,
      JSON.stringify(input.options), input.recommendation ? JSON.stringify(input.recommendation) : null,
      'pending_main_agent', now,
    );
    appendMessage(db, {
      sessionId: input.sessionId, fromPeerId: input.subagentId, toPeerId: 'main', kind: 'choice_request',
      content: JSON.stringify({ choice_id: choiceId, question: input.question, options: input.options, recommendation: input.recommendation ?? null }),
    });
    bus?.emit({ type: 'choice_created', payload: { choice_id: choiceId, session_id: input.sessionId, question: input.question } });

    if (!input.blocking) {
      return { choiceId, status: 'pending_main_agent' };
    }
    // blocking: wait until resolve_choice (or timeout)
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const result = await raceWait(waiter, choiceId, timeoutMs);
    if (result.status === 'resolved') {
      return { choiceId, status: 'resolved', selected: result.selected, rationale: result.rationale };
    }
    // raceWait returns {pending} on timeout, or {cancelled} from a future abort — both map to expired.
    // The UPDATE guard makes this idempotent against a concurrent resolve that won the race.
    db.prepare("UPDATE choices SET status='expired' WHERE id=? AND status='pending_main_agent'").run(choiceId);
    return { choiceId, status: 'expired' };
  }

  async function resolveChoice(input: ResolveChoiceInput): Promise<ResolveChoiceResult> {
    const row = getChoice(input.choiceId);
    if (row.session_id !== input.sessionId) {
      throw new AppError('validation_error', `choice ${input.choiceId} does not belong to session ${input.sessionId}`);
    }
    let options: ChoiceOption[] = [];
    try { options = JSON.parse(row.options_json); } catch { /* ignore */ }
    if (!options.some((o) => o.id === input.selected)) {
      throw new AppError('validation_error', `selected "${input.selected}" does not match any option id`);
    }
    if (row.status === 'pending_main_agent') {
      const now = new Date().toISOString();
      // Guarded UPDATE: only the resolve that actually flips the row appends the message + wakes the waiter.
      // Future-proofs against a future `await` between the read and the write (today the body is sync, but
      // the `AND status='pending_main_agent'` makes the invariant self-documenting, not load-bearing on synchronicity).
      const res = db.prepare("UPDATE choices SET status='resolved', selected=?, rationale=?, resolved_at=? WHERE id=? AND status='pending_main_agent'")
        .run(input.selected, input.rationale ?? null, now, input.choiceId);
      if (res.changes > 0) {
        appendMessage(db, {
          sessionId: input.sessionId, fromPeerId: 'main', toPeerId: row.requester_subagent_id, kind: 'choice_resolved',
          content: JSON.stringify({ choice_id: input.choiceId, selected: input.selected, rationale: input.rationale ?? null }),
        });
        waiter.resolve(input.choiceId, { status: 'resolved', selected: input.selected, rationale: input.rationale });
        bus?.emit({ type: 'choice_resolved', payload: { choice_id: input.choiceId, session_id: input.sessionId, selected: input.selected } });
      }
    }
    // idempotent: if already resolved/expired/cancelled, no-op success
    return { status: 'resolved' };
  }

  async function waitChoice(input: WaitChoiceInput): Promise<WaitChoiceResult> {
    const row = getChoice(input.choiceId);
    if (row.session_id !== input.sessionId) {
      throw new AppError('validation_error', `choice ${input.choiceId} does not belong to session ${input.sessionId}`);
    }
    if (row.status === 'resolved') return { status: 'resolved', selected: row.selected ?? undefined, rationale: row.rationale ?? undefined };
    if (row.status === 'expired') return { status: 'expired' };
    if (row.status === 'cancelled') return { status: 'cancelled' };
    // pending_main_agent: block
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return raceWait(waiter, input.choiceId, timeoutMs);
  }

  return { requestChoice, resolveChoice, waitChoice, getChoice };
}

/** Race the waiter's promise against a timeout. On timeout, returns {status:'pending'} (does NOT mutate the row).
 *  Cleans up the waiter-map entry on settle so a never-resolved choice doesn't leak the resolver. */
function raceWait(waiter: ChoicesWaiter, choiceId: string, timeoutMs: number): Promise<WaitChoiceResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<WaitChoiceResult>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'pending' }), timeoutMs);
  });
  return Promise.race([waiter.register(choiceId), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
    waiter.cancel(choiceId);   // no-op if already resolved/cancelled; otherwise frees the map slot
  });
}
