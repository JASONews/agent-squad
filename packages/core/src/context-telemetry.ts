export interface ContextUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  contextWindowTokens?: number;
}

export interface ContextCompaction {
  trigger?: 'auto' | 'manual' | 'unknown';
  preTokens?: number;
}

/** Telemetry observed during one native CLI invocation. */
export interface ContextTelemetry {
  usage?: ContextUsage;
  compactions?: ContextCompaction[];
}

export interface StoredContextCompaction extends ContextCompaction {
  occurredAt: string;
}

/** Latest persisted usage plus cumulative compaction history metadata. */
export interface ContextTelemetrySnapshot {
  usage?: ContextUsage;
  compactionCount: number;
  lastCompaction?: StoredContextCompaction;
  updatedAt?: string;
}

export interface SerializedContextTelemetry {
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    cache_write_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
    total_tokens?: number;
    context_window_tokens?: number;
  };
  compaction_count: number;
  last_compaction?: {
    trigger?: ContextCompaction['trigger'];
    pre_tokens?: number;
    occurred_at: string;
  };
  updated_at?: string;
}

export function serializeContextTelemetry(snapshot: ContextTelemetrySnapshot | undefined): SerializedContextTelemetry | undefined {
  if (!snapshot) return undefined;
  const usage = snapshot.usage ? {
    input_tokens: snapshot.usage.inputTokens,
    cached_input_tokens: snapshot.usage.cachedInputTokens,
    cache_write_input_tokens: snapshot.usage.cacheWriteInputTokens,
    output_tokens: snapshot.usage.outputTokens,
    reasoning_output_tokens: snapshot.usage.reasoningOutputTokens,
    total_tokens: snapshot.usage.totalTokens,
    context_window_tokens: snapshot.usage.contextWindowTokens,
  } : undefined;
  const lastCompaction = snapshot.lastCompaction ? {
    trigger: snapshot.lastCompaction.trigger,
    pre_tokens: snapshot.lastCompaction.preTokens,
    occurred_at: snapshot.lastCompaction.occurredAt,
  } : undefined;
  return {
    ...(usage ? { usage } : {}),
    compaction_count: snapshot.compactionCount,
    ...(lastCompaction ? { last_compaction: lastCompaction } : {}),
    ...(snapshot.updatedAt ? { updated_at: snapshot.updatedAt } : {}),
  };
}
