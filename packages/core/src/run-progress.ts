export const RUN_RECENT_OUTPUT_MS = 60_000;
export const RUN_STALL_SUSPECT_MS = 3 * 60_000;

export type RunProgressAssessment =
  | 'not_started'
  | 'starting'
  | 'progressing'
  | 'quiet'
  | 'possibly_stalled'
  | 'orphaned'
  | 'completed'
  | 'blocked'
  | 'timed_out'
  | 'failed';

export type RunProgressAction =
  | 'send'
  | 'wait'
  | 'inspect_then_wait'
  | 'consider_split'
  | 'retry_smaller'
  | 'resolve_block'
  | 'none';

export interface SubagentRunProgress {
  assessment: RunProgressAssessment;
  recommendedAction: RunProgressAction;
  runActive: boolean;
  startedAt?: string;
  lastOutputAt?: string;
  elapsedMs?: number;
  idleMs?: number;
  outputEvents: number;
  newOutputEvents: number;
  hasNewOutput: boolean;
  rawTail?: string;
  recentOutputThresholdMs: number;
  stallSuspectThresholdMs: number;
}

export interface RunProgressSource {
  status: string;
  runActive: boolean;
  startedAt?: string;
  lastOutputAt?: string;
  outputEvents: number;
  rawTail?: string;
}

export interface SerializedSubagentRunProgress {
  assessment: RunProgressAssessment;
  recommended_action: RunProgressAction;
  run_active: boolean;
  started_at?: string;
  last_output_at?: string;
  elapsed_ms?: number;
  idle_ms?: number;
  output_events: number;
  new_output_events: number;
  has_new_output: boolean;
  raw_tail?: string;
  recent_output_threshold_ms: number;
  stall_suspect_threshold_ms: number;
}

function timestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function terminalAssessment(status: string): Pick<SubagentRunProgress, 'assessment' | 'recommendedAction'> | undefined {
  if (status === 'completed') return { assessment: 'completed', recommendedAction: 'none' };
  if (status === 'native_cli_blocked') return { assessment: 'blocked', recommendedAction: 'resolve_block' };
  if (status === 'timeout') return { assessment: 'timed_out', recommendedAction: 'retry_smaller' };
  if (status === 'failed') return { assessment: 'failed', recommendedAction: 'retry_smaller' };
  return undefined;
}

export function buildSubagentRunProgress(
  source: RunProgressSource,
  afterOutputEventCount = 0,
  nowMs = Date.now(),
): SubagentRunProgress {
  const startedMs = timestampMs(source.startedAt);
  const lastOutputMs = timestampMs(source.lastOutputAt);
  const elapsedMs = startedMs === undefined ? undefined : Math.max(0, nowMs - startedMs);
  const idleMs = lastOutputMs === undefined ? elapsedMs : Math.max(0, nowMs - lastOutputMs);
  const outputEvents = Number.isInteger(source.outputEvents) && source.outputEvents >= 0 ? source.outputEvents : 0;
  const baseline = Number.isInteger(afterOutputEventCount) && afterOutputEventCount >= 0 ? afterOutputEventCount : 0;
  const newOutputEvents = Math.max(0, outputEvents - baseline);

  let state = terminalAssessment(source.status);
  const runActive = state ? false : source.runActive;
  if (!state && source.status === 'ready') {
    state = { assessment: 'not_started', recommendedAction: 'send' };
  } else if (!state && !runActive && source.status === 'running') {
    state = { assessment: 'orphaned', recommendedAction: 'retry_smaller' };
  } else if (!state && runActive) {
    if (idleMs === undefined || idleMs < RUN_RECENT_OUTPUT_MS) {
      state = {
        assessment: outputEvents === 0 ? 'starting' : 'progressing',
        recommendedAction: 'wait',
      };
    } else if (idleMs < RUN_STALL_SUSPECT_MS) {
      state = { assessment: 'quiet', recommendedAction: 'inspect_then_wait' };
    } else {
      state = { assessment: 'possibly_stalled', recommendedAction: 'consider_split' };
    }
  } else if (!state) {
    state = { assessment: 'starting', recommendedAction: 'wait' };
  }

  return {
    ...state,
    runActive,
    ...(source.startedAt ? { startedAt: source.startedAt } : {}),
    ...(source.lastOutputAt ? { lastOutputAt: source.lastOutputAt } : {}),
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
    ...(idleMs === undefined ? {} : { idleMs }),
    outputEvents,
    newOutputEvents,
    hasNewOutput: newOutputEvents > 0,
    ...(source.rawTail ? { rawTail: source.rawTail } : {}),
    recentOutputThresholdMs: RUN_RECENT_OUTPUT_MS,
    stallSuspectThresholdMs: RUN_STALL_SUSPECT_MS,
  };
}

export function serializeSubagentRunProgress(progress: SubagentRunProgress): SerializedSubagentRunProgress {
  return {
    assessment: progress.assessment,
    recommended_action: progress.recommendedAction,
    run_active: progress.runActive,
    ...(progress.startedAt ? { started_at: progress.startedAt } : {}),
    ...(progress.lastOutputAt ? { last_output_at: progress.lastOutputAt } : {}),
    ...(progress.elapsedMs === undefined ? {} : { elapsed_ms: progress.elapsedMs }),
    ...(progress.idleMs === undefined ? {} : { idle_ms: progress.idleMs }),
    output_events: progress.outputEvents,
    new_output_events: progress.newOutputEvents,
    has_new_output: progress.hasNewOutput,
    ...(progress.rawTail ? { raw_tail: progress.rawTail } : {}),
    recent_output_threshold_ms: progress.recentOutputThresholdMs,
    stall_suspect_threshold_ms: progress.stallSuspectThresholdMs,
  };
}
