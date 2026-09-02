import type { LineEvent, LineParser } from '../shared/line-parser.js';
import type { ContextCompaction, ContextUsage } from '@agent-squad/core';

interface ClaudeEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  result?: unknown;
  error?: unknown;
  message?: unknown;
  usage?: unknown;
  compact_metadata?: unknown;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function contextUsage(value: unknown): ContextUsage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const usage = value as Record<string, unknown>;
  const normalized: ContextUsage = {
    inputTokens: tokenCount(usage.input_tokens),
    cachedInputTokens: tokenCount(usage.cache_read_input_tokens),
    cacheWriteInputTokens: tokenCount(usage.cache_creation_input_tokens),
    outputTokens: tokenCount(usage.output_tokens),
  };
  return Object.values(normalized).some((count) => count !== undefined) ? normalized : undefined;
}

function contextCompaction(value: unknown): ContextCompaction {
  const metadata = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
  const rawTrigger = metadata.trigger;
  const trigger = rawTrigger === 'auto' || rawTrigger === 'manual' ? rawTrigger : 'unknown';
  const preTokens = tokenCount(metadata.pre_tokens);
  return { trigger, ...(preTokens === undefined ? {} : { preTokens }) };
}

function errorMessage(error: unknown): string | null {
  if (typeof error === 'string') return error;
  if (typeof error !== 'object' || error === null) return null;
  const e = error as { message?: unknown; error?: unknown };
  if (typeof e.message === 'string') return e.message;
  if (typeof e.error === 'string') return e.error;
  return null;
}

export function parseClaudeLine(line: string): LineEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { type: 'unknown', raw: trimmed };
  }
  if (typeof obj !== 'object' || obj === null) return { type: 'unknown', raw: obj };
  const o = obj as ClaudeEvent;

  if (o.type === 'system' && o.subtype === 'init' && typeof o.session_id === 'string') {
    return { type: 'session_id', sessionId: o.session_id };
  }
  if (o.type === 'system' && o.subtype === 'compact_boundary') {
    return {
      type: 'context_compaction',
      sessionId: typeof o.session_id === 'string' ? o.session_id : undefined,
      compaction: contextCompaction(o.compact_metadata),
    };
  }
  if (o.type === 'result' && o.subtype === 'success' && typeof o.result === 'string') {
    const usage = contextUsage(o.usage);
    return {
      type: 'reply_text',
      text: o.result,
      sessionId: typeof o.session_id === 'string' ? o.session_id : undefined,
      ...(usage ? { usage } : {}),
    };
  }
  if (o.type === 'result' && o.subtype === 'success') {
    const usage = contextUsage(o.usage);
    if (usage) {
      return {
        type: 'context_usage',
        sessionId: typeof o.session_id === 'string' ? o.session_id : undefined,
        usage,
      };
    }
  }
  if ((o.type === 'result' && o.subtype === 'error') || o.type === 'error') {
    const usage = contextUsage(o.usage);
    return {
      type: 'error',
      message: errorMessage(o.error) ?? errorMessage(o.message) ?? 'Claude Code returned an error',
      sessionId: typeof o.session_id === 'string' ? o.session_id : undefined,
      ...(usage ? { usage } : {}),
    };
  }
  return { type: 'unknown', raw: o };
}

export const claudeParser: LineParser = { parse: parseClaudeLine };
