import type { Db } from '../db/client.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import { AppError } from '../errors.js';
import { newId } from '../ids.js';
import type { Artifact, Message, Session, Subagent, SubagentStatus } from '../types.js';
import type { SubagentHandle } from '../adapters/types.js';
import { appendMessage } from './messages.js';
import { parseChoicesFromReply } from '../choice-parser.js';
import type { ParsedChoiceRequest } from '../choice-parser.js';
import { postArtifact } from './artifacts.js';
import type { EventBus } from '../events.js';
import {
  serializeContextTelemetry,
  type ContextTelemetry,
  type ContextTelemetrySnapshot,
  type ContextUsage,
  type StoredContextCompaction,
} from '../context-telemetry.js';
import {
  RUN_STALL_SUSPECT_MS,
  buildSubagentRunProgress,
  type SubagentRunProgress,
} from '../run-progress.js';

export interface SpawnSubagentInput {
  sessionId: string; alias: string; cli: string; role: string;
  cwd?: string; message: string; permissionProfile?: string;
  model?: string; reasoningEffort?: string;
}
export interface SpawnSubagentResult {
  subagentId: string; alias: string; nativeSessionId?: string; status: SubagentStatus;
}

function getSession(db: Db, sessionId: string): Session {
  const row = db.prepare<[string], Session>('SELECT * FROM sessions WHERE id=?').get(sessionId);
  if (!row) throw new AppError('session_not_found', `session not found: ${sessionId}`);
  return row;
}

export async function spawnSubagent(db: Db, registry: AdapterRegistry, input: SpawnSubagentInput, bus?: EventBus): Promise<SpawnSubagentResult> {
  const session = getSession(db, input.sessionId);
  if (!registry.has(input.cli)) throw new AppError('unknown_cli_type', `Unknown cli type: ${input.cli}`);
  const adapter = registry.get(input.cli);
  adapter.validateMessage?.(input.message);
  const subagentId = newId('sub');
  const now = new Date().toISOString();
  const effectiveCwd = input.cwd ?? session.repo_path ?? '.';
  // insert row first as starting; the UNIQUE(session_id, alias) constraint may fire
  // on a duplicate alias — map that SqliteError to AppError('alias_in_use') so callers
  // see a stable error code instead of a raw SQLITE_CONSTRAINT_UNIQUE.
  try {
    db.prepare(
      `INSERT INTO subagents (id, session_id, alias, cli_type, role, native_session_id, cwd, launch_mode, permission_profile, model, reasoning_effort, status, pid, last_seen_at, context_summary)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(subagentId, input.sessionId, input.alias, input.cli, input.role, null, effectiveCwd, 'resumable_headless', input.permissionProfile ?? null, input.model ?? null, input.reasoningEffort ?? null, 'starting', null, now, null);
  } catch (e) {
    // better-sqlite3 raises a SqliteError with code 'SQLITE_CONSTRAINT_UNIQUE' on the
    // UNIQUE(session_id, alias) violation; map it to a stable AppError('alias_in_use').
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) {
      throw new AppError('alias_in_use', `alias already in use in session ${input.sessionId}: ${input.alias}`);
    }
    throw e;
  }

  let handle: SubagentHandle;
  try {
    handle = await adapter.spawnSubagent({
      sessionId: input.sessionId, subagentId, alias: input.alias, role: input.role,
      cwd: effectiveCwd, message: input.message, permissionProfile: input.permissionProfile,
      model: input.model, reasoningEffort: input.reasoningEffort,
    });
  } catch (e) {
    // adapter failed to spawn — remove the 'starting' row so it doesn't leak as a ghost
    // and collide with UNIQUE(session_id, alias) on retry.
    db.prepare('DELETE FROM subagents WHERE id=?').run(subagentId);
    throw e;
  }

  db.prepare('UPDATE subagents SET native_session_id=?, status=?, last_seen_at=? WHERE id=?')
    .run(handle.nativeSessionId ?? null, handle.status, new Date().toISOString(), subagentId);

  appendMessage(db, { sessionId: input.sessionId, fromPeerId: 'main', toPeerId: subagentId, kind: 'main_to_sub', content: input.message });

  bus?.emit({ type: 'subagent_status', payload: { session_id: input.sessionId, subagent_id: subagentId, alias: input.alias, cli_type: input.cli, status: handle.status } });

  return { subagentId, alias: input.alias, nativeSessionId: handle.nativeSessionId, status: handle.status };
}

export interface SendToSubagentInput {
  sessionId: string; alias?: string; subagentId?: string;
  message: string; wait?: boolean;
  softTimeoutMs?: number; hardTimeoutMs?: number;
}
export interface SendToSubagentResult {
  messageId: string; status: 'sent' | 'running' | 'completed' | 'failed' | 'native_cli_blocked' | 'choice_requested' | 'timeout';
  reply?: string; artifacts?: { id: string; kind: string }[]; rawTail?: string;
  contextTelemetry?: ContextTelemetrySnapshot;
  progress?: SubagentRunProgress;
  choiceRequested?: boolean;
  choice?: ParsedChoiceRequest & { choiceId: string };
  choices?: (ParsedChoiceRequest & { choiceId: string })[];
}

export const SEND_SOFT_TIMEOUT_MS = 30_000;
export const SEND_HARD_TIMEOUT_MS = 20 * 60_000;
export const WAIT_SUBAGENT_MAX_TIMEOUT_MS = 300_000;
export const WAIT_SUBAGENT_TIMEOUT_MS = WAIT_SUBAGENT_MAX_TIMEOUT_MS;

interface ActiveRunProgress {
  startedAt: string;
  lastOutputAt?: string;
  outputEvents: number;
  rawTail?: string;
  lastPersistedAtMs: number;
  persistTimer?: NodeJS.Timeout;
}

const activeSends = new Map<string, Promise<SendToSubagentResult>>();
const activeRunProgress = new Map<string, ActiveRunProgress>();
const RUN_PROGRESS_PERSIST_INTERVAL_MS = 1_000;

interface ResolveSubagentInput {
  sessionId: string;
  alias?: string;
  subagentId?: string;
}

export interface InspectSubagentInput extends ResolveSubagentInput {
  afterOutputEventCount?: number;
}

function resolveSubagent(db: Db, input: ResolveSubagentInput): Subagent {
  getSession(db, input.sessionId);
  let row: Subagent | undefined;
  if (input.subagentId) {
    row = db.prepare<[string, string], Subagent>('SELECT * FROM subagents WHERE id=? AND session_id=?').get(input.subagentId, input.sessionId);
  } else if (input.alias) {
    row = db.prepare<[string, string], Subagent>('SELECT * FROM subagents WHERE session_id=? AND alias=?').get(input.sessionId, input.alias);
  } else {
    throw new AppError('validation_error', 'sendToSubagent requires alias or subagentId');
  }
  if (!row) throw new AppError('subagent_not_found', `subagent not found in session ${input.sessionId}`);
  return row;
}

export interface WaitForSubagentInput {
  sessionId: string;
  alias?: string;
  subagentId?: string;
  afterMessageId?: string;
  afterOutputEventCount?: number;
  timeoutMs?: number;
}

export interface InspectSubagentResult {
  subagent: Subagent;
  contextTelemetry?: ContextTelemetrySnapshot;
  progress: SubagentRunProgress;
}

export type WaitForSubagentResult = Omit<SendToSubagentResult, 'messageId'> & {
  messageId?: string;
};

interface MessageWithRowId extends Message {
  rowid: number;
}

export async function sendToSubagent(db: Db, registry: AdapterRegistry, input: SendToSubagentInput, bus?: EventBus): Promise<SendToSubagentResult> {
  const sub = resolveSubagent(db, input);
  if (activeSends.has(sub.id)) {
    const messageId = appendMessage(db, {
      sessionId: input.sessionId,
      fromPeerId: 'main',
      toPeerId: sub.id,
      kind: 'sub_status',
      content: 'Subagent is already running; new message was not delivered. Call wait_subagent for the result before sending a follow-up.',
    }, bus);
    return {
      messageId,
      status: 'running',
      rawTail: 'subagent is already running; call wait_subagent before sending a follow-up',
      contextTelemetry: readContextTelemetrySnapshot(sub),
      progress: readSubagentRunProgress(sub),
    };
  }
  registry.get(sub.cli_type).validateMessage?.(input.message);
  const messageId = appendMessage(db, { sessionId: input.sessionId, fromPeerId: 'main', toPeerId: sub.id, kind: 'main_to_sub', content: input.message }, bus);
  const progress: ActiveRunProgress = {
    startedAt: new Date().toISOString(),
    outputEvents: 0,
    lastPersistedAtMs: 0,
  };
  activeRunProgress.set(sub.id, progress);
  markSubagentRunning(db, sub, input.sessionId, progress, bus);
  const completion = runSubagentSend(db, registry, sub, input, messageId, progress, bus);
  activeSends.set(sub.id, completion);
  completion.then(
    () => {
      if (activeSends.get(sub.id) === completion) activeSends.delete(sub.id);
      if (activeRunProgress.get(sub.id) === progress) activeRunProgress.delete(sub.id);
    },
    () => {
      if (activeSends.get(sub.id) === completion) activeSends.delete(sub.id);
      if (activeRunProgress.get(sub.id) === progress) activeRunProgress.delete(sub.id);
    },
  );
  if (input.wait === false) {
    completion.catch(() => { /* result was persisted; caller chose not to wait */ });
    return {
      messageId,
      status: 'running',
      contextTelemetry: readContextTelemetrySnapshot(sub),
      progress: readCurrentRunProgress(db, sub.id),
    };
  }

  const result = await withSoftTimeout(completion, input.softTimeoutMs ?? SEND_SOFT_TIMEOUT_MS);
  if (result === SOFT_TIMEOUT) {
    completion.catch(() => { /* result was persisted; caller will observe status/messages later */ });
    return {
      messageId,
      status: 'running',
      contextTelemetry: readContextTelemetrySnapshot(sub),
      progress: readCurrentRunProgress(db, sub.id),
    };
  }
  return result;
}

export async function waitForSubagent(db: Db, input: WaitForSubagentInput, bus?: EventBus): Promise<WaitForSubagentResult> {
  const sub = resolveSubagent(db, input);
  const afterRowId = resolveAfterMessageRowId(db, input.sessionId, input.afterMessageId);
  const immediate = readWaitResult(db, input.sessionId, sub, afterRowId, input.afterOutputEventCount);
  if (immediate.status !== 'running') return immediate;
  if (progressNeedsAttention(immediate.progress)) return immediate;
  const timeoutMs = normalizeWaitTimeout(input.timeoutMs);
  const deadlineMs = Date.now() + timeoutMs;
  if (!bus) {
    let current = immediate;
    while (
      current.status === 'running'
      && !progressNeedsAttention(current.progress)
      && Date.now() < deadlineMs
    ) {
      await waitForSubagentTimeout(nextProgressWaitDelay(current.progress, deadlineMs));
      current = readWaitResult(db, input.sessionId, sub, afterRowId, input.afterOutputEventCount);
    }
    return current;
  }

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let timer: NodeJS.Timeout | undefined;
    const finish = (result: WaitForSubagentResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
      resolve(result);
    };
    const schedule = (result: WaitForSubagentResult) => {
      if (settled) return;
      if (timer) clearTimeout(timer);
      const delayMs = nextProgressWaitDelay(result.progress, deadlineMs);
      timer = setTimeout(() => {
        const next = readWaitResult(db, input.sessionId, sub, afterRowId, input.afterOutputEventCount);
        if (next.status !== 'running' || progressNeedsAttention(next.progress) || Date.now() >= deadlineMs) {
          finish(next);
          return;
        }
        schedule(next);
      }, delayMs);
    };

    unsubscribe = bus.on((event) => {
      const payload = event.payload;
      if (payload.session_id !== input.sessionId) return;
      if (payload.subagent_id && payload.subagent_id !== sub.id) return;
      if (payload.from_peer_id && payload.from_peer_id !== sub.id) return;
      if (payload.to_peer_id && payload.to_peer_id !== sub.id && payload.to_peer_id !== 'main') return;
      const result = readWaitResult(db, input.sessionId, sub, afterRowId, input.afterOutputEventCount);
      if (result.status !== 'running' || progressNeedsAttention(result.progress)) {
        finish(result);
        return;
      }
      schedule(result);
    });
    const afterSubscribe = readWaitResult(db, input.sessionId, sub, afterRowId, input.afterOutputEventCount);
    if (afterSubscribe.status !== 'running' || progressNeedsAttention(afterSubscribe.progress)) {
      finish(afterSubscribe);
      return;
    }
    schedule(afterSubscribe);
  });
}

function markSubagentRunning(db: Db, sub: Subagent, sessionId: string, progress: ActiveRunProgress, bus?: EventBus): void {
  db.prepare(
    `UPDATE subagents
     SET status='running',
         last_seen_at=?,
         context_summary=NULL,
         run_started_at=?,
         run_last_output_at=NULL,
         run_output_event_count=0
     WHERE id=?`
  ).run(progress.startedAt, progress.startedAt, sub.id);
  bus?.emit({ type: 'subagent_status', payload: { session_id: sessionId, subagent_id: sub.id, alias: sub.alias, cli_type: sub.cli_type, status: 'running', last_seen_at: progress.startedAt } });
}

function normalizeWaitTimeout(timeoutMs?: number): number {
  return Math.min(timeoutMs ?? WAIT_SUBAGENT_TIMEOUT_MS, WAIT_SUBAGENT_MAX_TIMEOUT_MS);
}

function waitForSubagentTimeout(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

function progressNeedsAttention(progress: SubagentRunProgress | undefined): boolean {
  return progress?.assessment === 'possibly_stalled' || progress?.assessment === 'orphaned';
}

function nextProgressWaitDelay(progress: SubagentRunProgress | undefined, deadlineMs: number): number {
  const nowMs = Date.now();
  const remainingMs = Math.max(1, deadlineMs - nowMs);
  if (!progress || progressNeedsAttention(progress)) return Math.min(1, remainingMs);
  const activityAt = progress.lastOutputAt ?? progress.startedAt;
  const activityMs = activityAt ? Date.parse(activityAt) : Number.NaN;
  if (!Number.isFinite(activityMs)) return remainingMs;
  return Math.max(1, Math.min(remainingMs, activityMs + RUN_STALL_SUSPECT_MS - nowMs));
}

function resolveAfterMessageRowId(db: Db, sessionId: string, afterMessageId?: string): number {
  if (!afterMessageId) return 0;
  const row = db.prepare<[string, string], { rowid: number }>(
    'SELECT rowid FROM messages WHERE id=? AND session_id=?'
  ).get(afterMessageId, sessionId);
  if (!row) throw new AppError('validation_error', `after_message_id not found in session ${sessionId}: ${afterMessageId}`);
  return row.rowid;
}

function readWaitResult(
  db: Db,
  sessionId: string,
  sub: Subagent,
  afterRowId: number,
  afterOutputEventCount = 0,
): WaitForSubagentResult {
  const row = db.prepare<[string, string], Subagent>('SELECT * FROM subagents WHERE id=? AND session_id=?').get(sub.id, sessionId);
  if (!row) throw new AppError('subagent_not_found', `subagent not found in session ${sessionId}`);
  const contextTelemetry = readContextTelemetrySnapshot(row);
  const progress = readSubagentRunProgress(row, afterOutputEventCount);

  const choices = getPendingChoicesAfter(db, sessionId, sub.id, afterRowId);
  if (choices.length > 0) {
    const firstChoice = choices[0]!;
    const latestReply = getLatestSubagentMessageAfter(db, sessionId, sub.id, afterRowId, 'sub_to_main');
    return {
      messageId: firstChoice.messageId,
      status: 'choice_requested',
      reply: latestReply?.content ?? undefined,
      choiceRequested: true,
      choice: firstChoice,
      choices,
      contextTelemetry,
      progress,
    };
  }

  const latestReply = getLatestSubagentMessageAfter(db, sessionId, sub.id, afterRowId, 'sub_to_main');
  if (latestReply && row.status === 'completed') {
    return {
      messageId: latestReply.id,
      status: 'completed',
      reply: latestReply.content ?? undefined,
      artifacts: resolveArtifactRefs(db, latestReply.artifact_refs),
      contextTelemetry,
      progress,
    };
  }

  if (row.status === 'failed' || row.status === 'native_cli_blocked' || row.status === 'timeout') {
    const latestStatus = getLatestSubagentMessageAfter(db, sessionId, sub.id, afterRowId, 'sub_status');
    return {
      messageId: latestStatus?.id,
      status: row.status,
      rawTail: row.context_summary ?? latestStatus?.content ?? undefined,
      contextTelemetry,
      progress,
    };
  }
  if (row.status === 'completed') return { status: 'completed', contextTelemetry, progress };
  return { status: 'running', contextTelemetry, progress };
}

function getLatestSubagentMessageAfter(db: Db, sessionId: string, subagentId: string, afterRowId: number, kind: string): MessageWithRowId | undefined {
  return db.prepare<{ session_id: string; subagent_id: string; after_rowid: number; kind: string }, MessageWithRowId>(
    `SELECT rowid, * FROM messages
     WHERE session_id=@session_id
       AND from_peer_id=@subagent_id
       AND to_peer_id='main'
       AND kind=@kind
       AND rowid>@after_rowid
     ORDER BY rowid DESC
     LIMIT 1`
  ).get({ session_id: sessionId, subagent_id: subagentId, after_rowid: afterRowId, kind });
}

function getPendingChoicesAfter(db: Db, sessionId: string, subagentId: string, afterRowId: number): (ParsedChoiceRequest & { choiceId: string; messageId: string })[] {
  const rows = db.prepare<{ session_id: string; subagent_id: string; after_rowid: number }, MessageWithRowId>(
    `SELECT rowid, * FROM messages
     WHERE session_id=@session_id
       AND from_peer_id=@subagent_id
       AND to_peer_id='main'
       AND kind='choice_request'
       AND rowid>@after_rowid
     ORDER BY rowid ASC`
  ).all({ session_id: sessionId, subagent_id: subagentId, after_rowid: afterRowId });
  const result: (ParsedChoiceRequest & { choiceId: string; messageId: string })[] = [];
  for (const row of rows) {
    if (!row.content) continue;
    try {
      const parsed = JSON.parse(row.content) as {
        choice_id?: unknown;
        question?: unknown;
        options?: unknown;
        recommendation?: unknown;
      };
      if (typeof parsed.choice_id !== 'string' || typeof parsed.question !== 'string' || !Array.isArray(parsed.options)) continue;
      const choiceRow = db.prepare<[string], { status: string }>('SELECT status FROM choices WHERE id=?').get(parsed.choice_id);
      if (choiceRow?.status !== 'pending_main_agent') continue;
      result.push({
        choiceId: parsed.choice_id,
        messageId: row.id,
        question: parsed.question,
        options: parsed.options as ParsedChoiceRequest['options'],
        recommendation: parsed.recommendation === null ? undefined : parsed.recommendation as ParsedChoiceRequest['recommendation'],
      });
    } catch {
      continue;
    }
  }
  return result;
}

function resolveArtifactRefs(db: Db, refsJson: string | null): { id: string; kind: string }[] {
  if (!refsJson) return [];
  let refs: string[];
  try {
    refs = JSON.parse(refsJson) as string[];
  } catch {
    return [];
  }
  return refs.flatMap((id) => {
    const row = db.prepare<[string], Artifact>('SELECT * FROM artifacts WHERE id=?').get(id);
    return row ? [{ id, kind: row.kind }] : [];
  });
}

function parseStoredObject<T extends object>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as T : undefined;
  } catch {
    return undefined;
  }
}

export function readContextTelemetrySnapshot(
  subagent: Pick<Subagent,
    'context_usage_json'
    | 'context_compaction_count'
    | 'context_last_compaction_json'
    | 'context_telemetry_updated_at'
  >,
): ContextTelemetrySnapshot | undefined {
  const usage = parseStoredObject<ContextUsage>(subagent.context_usage_json);
  const lastCompaction = parseStoredObject<StoredContextCompaction>(subagent.context_last_compaction_json);
  const compactionCount = Number.isInteger(subagent.context_compaction_count) && subagent.context_compaction_count >= 0
    ? subagent.context_compaction_count
    : 0;
  if (!usage && !lastCompaction && compactionCount === 0 && !subagent.context_telemetry_updated_at) {
    return undefined;
  }
  return {
    ...(usage ? { usage } : {}),
    compactionCount,
    ...(lastCompaction ? { lastCompaction } : {}),
    ...(subagent.context_telemetry_updated_at ? { updatedAt: subagent.context_telemetry_updated_at } : {}),
  };
}

function persistContextTelemetry(
  db: Db,
  sub: Subagent,
  sessionId: string,
  telemetry: ContextTelemetry | undefined,
  bus?: EventBus,
): ContextTelemetrySnapshot | undefined {
  const currentRow = db.prepare<[string], Subagent>('SELECT * FROM subagents WHERE id=?').get(sub.id) ?? sub;
  const current = readContextTelemetrySnapshot(currentRow);
  const observedUsage = telemetry?.usage;
  const compactions = telemetry?.compactions ?? [];
  if (!observedUsage && compactions.length === 0) return current;

  const now = new Date().toISOString();
  const usage = observedUsage ? { ...observedUsage } : current?.usage;
  const lastObservedCompaction = compactions.at(-1);
  const lastCompaction = lastObservedCompaction
    ? { ...lastObservedCompaction, occurredAt: now }
    : current?.lastCompaction;
  const snapshot: ContextTelemetrySnapshot = {
    ...(usage ? { usage } : {}),
    compactionCount: (current?.compactionCount ?? 0) + compactions.length,
    ...(lastCompaction ? { lastCompaction } : {}),
    updatedAt: now,
  };

  db.prepare(
    `UPDATE subagents
     SET context_usage_json=?,
         context_compaction_count=?,
         context_last_compaction_json=?,
         context_telemetry_updated_at=?
     WHERE id=?`
  ).run(
    usage ? JSON.stringify(usage) : null,
    snapshot.compactionCount,
    lastCompaction ? JSON.stringify(lastCompaction) : null,
    now,
    sub.id,
  );
  bus?.emit({
    type: 'subagent_context',
    payload: {
      session_id: sessionId,
      subagent_id: sub.id,
      alias: sub.alias,
      cli_type: sub.cli_type,
      context_telemetry: serializeContextTelemetry(snapshot),
    },
  });
  return snapshot;
}

export function readSubagentRunProgress(
  subagent: Pick<Subagent,
    'id'
    | 'status'
    | 'run_started_at'
    | 'run_last_output_at'
    | 'run_output_event_count'
    | 'context_summary'
  >,
  afterOutputEventCount = 0,
): SubagentRunProgress {
  const active = activeRunProgress.get(subagent.id);
  return buildSubagentRunProgress({
    status: subagent.status,
    runActive: active !== undefined,
    startedAt: active?.startedAt ?? subagent.run_started_at ?? undefined,
    lastOutputAt: active?.lastOutputAt ?? subagent.run_last_output_at ?? undefined,
    outputEvents: active?.outputEvents ?? subagent.run_output_event_count ?? 0,
    rawTail: active?.rawTail ?? subagent.context_summary ?? undefined,
  }, afterOutputEventCount);
}

function readCurrentRunProgress(db: Db, subagentId: string, afterOutputEventCount = 0): SubagentRunProgress {
  const row = db.prepare<[string], Subagent>('SELECT * FROM subagents WHERE id=?').get(subagentId);
  if (!row) throw new AppError('subagent_not_found', `subagent not found: ${subagentId}`);
  return readSubagentRunProgress(row, afterOutputEventCount);
}

export function inspectSubagent(db: Db, input: InspectSubagentInput): InspectSubagentResult {
  const subagent = resolveSubagent(db, input);
  return {
    subagent,
    contextTelemetry: readContextTelemetrySnapshot(subagent),
    progress: readSubagentRunProgress(subagent, input.afterOutputEventCount),
  };
}

function persistActiveRunProgress(db: Db, subagentId: string, progress: ActiveRunProgress, force = false): void {
  const nowMs = Date.now();
  const elapsedMs = nowMs - progress.lastPersistedAtMs;
  if (!force && elapsedMs < RUN_PROGRESS_PERSIST_INTERVAL_MS) {
    if (!progress.persistTimer) {
      progress.persistTimer = setTimeout(() => {
        progress.persistTimer = undefined;
        if (activeRunProgress.get(subagentId) === progress) {
          persistActiveRunProgress(db, subagentId, progress, true);
        }
      }, RUN_PROGRESS_PERSIST_INTERVAL_MS - elapsedMs);
      progress.persistTimer.unref?.();
    }
    return;
  }
  if (progress.persistTimer) {
    clearTimeout(progress.persistTimer);
    progress.persistTimer = undefined;
  }
  progress.lastPersistedAtMs = nowMs;
  const seenAt = progress.lastOutputAt ?? progress.startedAt;
  db.prepare(
    `UPDATE subagents
     SET run_started_at=?,
         run_last_output_at=?,
         run_output_event_count=?,
         context_summary=?,
         last_seen_at=?
     WHERE id=?`
  ).run(
    progress.startedAt,
    progress.lastOutputAt ?? null,
    progress.outputEvents,
    progress.rawTail ?? null,
    seenAt,
    subagentId,
  );
}

function recordRunOutput(db: Db, subagentId: string, progress: ActiveRunProgress, rawTail: string): void {
  progress.lastOutputAt = new Date().toISOString();
  progress.outputEvents++;
  progress.rawTail = rawTail;
  persistActiveRunProgress(db, subagentId, progress);
}

async function runSubagentSend(
  db: Db,
  registry: AdapterRegistry,
  sub: Subagent,
  input: SendToSubagentInput,
  messageId: string,
  progress: ActiveRunProgress,
  bus?: EventBus,
): Promise<SendToSubagentResult> {
  const adapter = registry.get(sub.cli_type);
  const adapterMessage = buildAdapterMessage(db, input.sessionId, sub, input.message);
  let result;
  try {
    result = await adapter.send({
      subagentId: sub.id,
      nativeSessionId: sub.native_session_id ?? undefined,
      cwd: sub.cwd ?? undefined,
      permissionProfile: sub.permission_profile ?? undefined,
      model: sub.model ?? undefined,
      reasoningEffort: sub.reasoning_effort ?? undefined,
      sessionId: input.sessionId,
      alias: sub.alias,
      message: adapterMessage,
      wait: true,
      hardTimeoutMs: input.hardTimeoutMs ?? SEND_HARD_TIMEOUT_MS,
      onOutput: (output) => {
        recordRunOutput(db, sub.id, progress, output.rawTail);
        bus?.emit({
          type: 'subagent_output',
          payload: {
            session_id: input.sessionId,
            subagent_id: sub.id,
            alias: sub.alias,
            cli_type: sub.cli_type,
            stream: output.stream,
            text: output.text,
            raw_tail: output.rawTail,
          },
        });
      },
    });
  } catch (e) {
    const now = new Date().toISOString();
    progress.rawTail = progress.rawTail ?? (e instanceof Error ? e.message : String(e));
    persistActiveRunProgress(db, sub.id, progress, true);
    db.prepare("UPDATE subagents SET status='failed', context_summary=?, last_seen_at=? WHERE id=?")
      .run(progress.rawTail, now, sub.id);
    bus?.emit({ type: 'subagent_status', payload: { session_id: input.sessionId, subagent_id: sub.id, alias: sub.alias, cli_type: sub.cli_type, status: 'failed', last_seen_at: now } });
    throw e;
  }

  if (result.rawTail) progress.rawTail = result.rawTail;
  persistActiveRunProgress(db, sub.id, progress, true);
  if (result.nativeSessionId && result.nativeSessionId !== sub.native_session_id) {
    db.prepare('UPDATE subagents SET native_session_id=? WHERE id=?').run(result.nativeSessionId, sub.id);
  }
  const contextTelemetry = persistContextTelemetry(db, sub, input.sessionId, result.contextTelemetry, bus);

  if (result.status === 'native_cli_blocked') {
    const now = new Date().toISOString();
    db.prepare("UPDATE subagents SET status='native_cli_blocked', context_summary=?, last_seen_at=? WHERE id=?")
      .run(result.rawTail ?? null, now, sub.id);
    bus?.emit({ type: 'subagent_blocked', payload: { session_id: input.sessionId, subagent_id: sub.id, raw_tail: result.rawTail ?? null, last_seen_at: now } });
    bus?.emit({ type: 'subagent_status', payload: { session_id: input.sessionId, subagent_id: sub.id, alias: sub.alias, cli_type: sub.cli_type, status: 'native_cli_blocked', last_seen_at: now } });
    return {
      messageId,
      status: 'native_cli_blocked',
      rawTail: result.rawTail,
      contextTelemetry,
      progress: readCurrentRunProgress(db, sub.id),
    };
  }

  if (result.status === 'timeout') {
    const now = new Date().toISOString();
    db.prepare("UPDATE subagents SET status='timeout', context_summary=?, last_seen_at=? WHERE id=?")
      .run(result.rawTail ?? null, now, sub.id);
    appendMessage(db, { sessionId: input.sessionId, fromPeerId: sub.id, toPeerId: 'main', kind: 'sub_status', content: 'Subagent timed out before completing.' }, bus);
    bus?.emit({ type: 'subagent_status', payload: { session_id: input.sessionId, subagent_id: sub.id, alias: sub.alias, cli_type: sub.cli_type, status: 'timeout', last_seen_at: now } });
    return {
      messageId,
      status: 'timeout',
      rawTail: result.rawTail,
      contextTelemetry,
      progress: readCurrentRunProgress(db, sub.id),
    };
  }

  if (result.status === 'failed') {
    const now = new Date().toISOString();
    db.prepare("UPDATE subagents SET status='failed', last_seen_at=? WHERE id=?").run(now, sub.id);
    appendMessage(db, { sessionId: input.sessionId, fromPeerId: sub.id, toPeerId: 'main', kind: 'sub_status', content: `${sub.cli_type} subagent failed: ${result.rawTail ?? '(no output)'}` }, bus);
    bus?.emit({ type: 'subagent_status', payload: { session_id: input.sessionId, subagent_id: sub.id, alias: sub.alias, cli_type: sub.cli_type, status: 'failed', last_seen_at: now } });
    throw new AppError('internal_error', `${sub.cli_type} subagent failed: ${result.rawTail ?? '(no output)'}`);
  }

  const persistedArts = (result.artifacts ?? []).map((a) => {
    const { artifactId } = postArtifact(db, { sessionId: input.sessionId, producerPeerId: sub.id, kind: a.kind, content: a.content, path: a.path, metadata: a.metadata ?? null });
    return { id: artifactId, kind: a.kind };
  });

  // Parse choice requests from reply (reply-resume path for headless CLI subagents).
  const { choices, cleanedReply } = parseChoicesFromReply(result.reply ?? '');

  appendMessage(db, { sessionId: input.sessionId, fromPeerId: sub.id, toPeerId: 'main', kind: 'sub_to_main', content: choices.length > 0 ? cleanedReply : (result.reply ?? null), artifactRefs: persistedArts.map((a) => a.id) }, bus);

  if (choices.length > 0) {
    // Subagent requested choices via the reply-resume path. Create non-blocking choices
    // via the service layer (the main agent will see it and resolve it; then resume the subagent
    // with the answers). We insert directly into the choices table + emit events — we don't
    // call createChoices() because we don't have the ChoicesService instance here, but the
    // INSERT + event + message is the same thing requestChoice does.
    const now = new Date().toISOString();
    const structuredChoices = choices.map((choice) => {
      const choiceId = newId('ch');
      db.prepare(
        'INSERT INTO choices (id, session_id, requester_subagent_id, question, options_json, recommendation_json, status, created_at) VALUES (?,?,?,?,?,?,?,?)'
      ).run(choiceId, input.sessionId, sub.id, choice.question, JSON.stringify(choice.options), choice.recommendation ? JSON.stringify(choice.recommendation) : null, 'pending_main_agent', now);
      appendMessage(db, { sessionId: input.sessionId, fromPeerId: sub.id, toPeerId: 'main', kind: 'choice_request', content: JSON.stringify({ choice_id: choiceId, question: choice.question, options: choice.options, recommendation: choice.recommendation ?? null }) }, bus);
      bus?.emit({ type: 'choice_created', payload: { choice_id: choiceId, session_id: input.sessionId, question: choice.question } });
      return { choiceId, ...choice };
    });
    db.prepare("UPDATE subagents SET status='completed', last_seen_at=? WHERE id=?").run(now, sub.id);
    bus?.emit({ type: 'subagent_status', payload: { session_id: input.sessionId, subagent_id: sub.id, alias: sub.alias, cli_type: sub.cli_type, status: 'completed', last_seen_at: now } });
    return {
      messageId,
      status: 'choice_requested',
      reply: cleanedReply,
      artifacts: persistedArts,
      rawTail: result.rawTail,
      choiceRequested: true,
      choice: structuredChoices[0],
      choices: structuredChoices,
      contextTelemetry,
      progress: readCurrentRunProgress(db, sub.id),
    };
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE subagents SET status='completed', last_seen_at=? WHERE id=?").run(now, sub.id);
  bus?.emit({ type: 'subagent_status', payload: { session_id: input.sessionId, subagent_id: sub.id, alias: sub.alias, cli_type: sub.cli_type, status: 'completed', last_seen_at: now } });
  return {
    messageId,
    status: 'completed',
    reply: result.reply,
    artifacts: persistedArts,
    rawTail: result.rawTail,
    contextTelemetry,
    progress: readCurrentRunProgress(db, sub.id),
  };
}

function buildAdapterMessage(db: Db, sessionId: string, sub: Subagent, currentMessage: string): string {
  if (sub.native_session_id) return currentMessage;
  const initialAssignment = getInitialSubagentAssignment(db, sessionId, sub.id);
  if (!initialAssignment || currentMessage.includes(initialAssignment)) return currentMessage;
  return [
    'Initial assignment from spawn_subagent:',
    initialAssignment,
    '',
    'Message from send_to_subagent:',
    currentMessage,
  ].join('\n');
}

function getInitialSubagentAssignment(db: Db, sessionId: string, subagentId: string): string | undefined {
  const row = db.prepare<{ session_id: string; subagent_id: string }, { content: string | null }>(
    `SELECT content FROM messages
     WHERE session_id=@session_id
       AND from_peer_id='main'
       AND to_peer_id=@subagent_id
       AND kind='main_to_sub'
     ORDER BY rowid ASC
     LIMIT 1`
  ).get({ session_id: sessionId, subagent_id: subagentId });
  return row?.content ?? undefined;
}

const SOFT_TIMEOUT = Symbol('send_soft_timeout');

function withSoftTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof SOFT_TIMEOUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof SOFT_TIMEOUT>((resolve) => { timer = setTimeout(() => resolve(SOFT_TIMEOUT), ms); });
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}
