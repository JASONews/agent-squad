import type { LineEvent, LineParser } from '../shared/line-parser.js';
import type { ContextUsage } from '@agent-squad/core';

interface OpencodeTextSource {
  role?: string;
  text?: string;
  content?: unknown;
  tokens?: unknown;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function contextUsage(value: unknown): ContextUsage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const tokens = value as Record<string, unknown>;
  const cache = typeof tokens.cache === 'object' && tokens.cache !== null
    ? tokens.cache as Record<string, unknown>
    : {};
  const normalized: ContextUsage = {
    totalTokens: tokenCount(tokens.total),
    inputTokens: tokenCount(tokens.input),
    outputTokens: tokenCount(tokens.output),
    reasoningOutputTokens: tokenCount(tokens.reasoning),
    cachedInputTokens: tokenCount(cache.read),
    cacheWriteInputTokens: tokenCount(cache.write),
  };
  return Object.values(normalized).some((count) => count !== undefined) ? normalized : undefined;
}

function textFromContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts = content.flatMap((part) => {
    if (typeof part === 'string') return [part];
    if (typeof part !== 'object' || part === null) return [];
    const p = part as { text?: unknown };
    return typeof p.text === 'string' ? [p.text] : [];
  });
  return parts.length > 0 ? parts.join('') : null;
}

function textFromSource(source: OpencodeTextSource | undefined): string | null {
  if (!source || typeof source !== 'object') return null;
  if (typeof source.text === 'string') return source.text;
  return textFromContent(source.content);
}

/** Parse one opencode JSONL line into a normalized LineEvent. Pure. Returns null for blank lines. */
export function parseOpencodeLine(line: string): LineEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { type: 'unknown', raw: trimmed };
  }
  if (typeof obj !== 'object' || obj === null) return { type: 'unknown', raw: obj };
  const o = obj as { type?: string; sessionID?: string; part?: OpencodeTextSource; message?: OpencodeTextSource };

  // Reply events are checked first so their reply text isn't lost (their sessionID is dropped at parse time;
  // session id is captured from the preceding step_start line at the accumulator).
  if (o.type === 'text') {
    const text = textFromSource(o.part);
    if (text !== null) return { type: 'reply_text', text };
  }
  if (o.type === 'message' && o.message?.role === 'assistant') {
    const text = textFromSource(o.message);
    if (text !== null) return { type: 'reply_text', text };
  }
  if (o.type === 'step_finish') {
    const usage = contextUsage(o.part?.tokens);
    if (usage) {
      return {
        type: 'context_usage',
        sessionId: typeof o.sessionID === 'string' ? o.sessionID : undefined,
        usage,
      };
    }
  }
  if (typeof o.sessionID === 'string') {
    return { type: 'session_id', sessionId: o.sessionID };
  }
  return { type: 'unknown', raw: o };
}

export const opencodeParser: LineParser = { parse: parseOpencodeLine };
