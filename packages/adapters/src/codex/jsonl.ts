import type { LineEvent, LineParser } from '../shared/line-parser.js';
import type { ContextUsage } from '@agent-squad/core';

interface CodexItem {
  type?: string;
  role?: string;
  text?: string;
  message?: string;
  content?: unknown;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function contextUsage(value: unknown): ContextUsage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const usage = value as Record<string, unknown>;
  const inputDetails = typeof usage.input_tokens_details === 'object' && usage.input_tokens_details !== null
    ? usage.input_tokens_details as Record<string, unknown>
    : {};
  const outputDetails = typeof usage.output_tokens_details === 'object' && usage.output_tokens_details !== null
    ? usage.output_tokens_details as Record<string, unknown>
    : {};
  const normalized: ContextUsage = {
    inputTokens: tokenCount(usage.input_tokens),
    cachedInputTokens: tokenCount(usage.cached_input_tokens) ?? tokenCount(inputDetails.cached_tokens),
    outputTokens: tokenCount(usage.output_tokens),
    reasoningOutputTokens: tokenCount(usage.reasoning_output_tokens) ?? tokenCount(outputDetails.reasoning_tokens),
    totalTokens: tokenCount(usage.total_tokens),
  };
  return Object.values(normalized).some((count) => count !== undefined) ? normalized : undefined;
}

function textFromContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts = content.flatMap((part) => {
    if (typeof part === 'string') return [part];
    if (typeof part !== 'object' || part === null) return [];
    const p = part as { text?: unknown; type?: unknown };
    return typeof p.text === 'string' ? [p.text] : [];
  });
  return parts.length > 0 ? parts.join('') : null;
}

function isAssistantMessageItem(item: CodexItem): boolean {
  return item.type === 'agent_message' || (item.type === 'message' && item.role === 'assistant');
}

function replyTextFromItem(item: CodexItem): string | null {
  if (!isAssistantMessageItem(item)) return null;
  if (typeof item.text === 'string') return item.text;
  return textFromContent(item.content);
}

function replyTextFromResponse(response: unknown): string | null {
  if (typeof response !== 'object' || response === null) return null;
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  const parts = output.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const text = replyTextFromItem(item as CodexItem);
    return text === null ? [] : [text];
  });
  return parts.length > 0 ? parts.join('') : null;
}

/** Parse one codex JSONL line into a normalized LineEvent. Pure. Returns null for blank lines. */
export function parseJsonlLine(line: string): LineEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { type: 'unknown', raw: trimmed };
  }
  if (typeof obj !== 'object' || obj === null) return { type: 'unknown', raw: obj };
  const o = obj as { type?: string; thread_id?: string; item?: CodexItem; response?: unknown; usage?: unknown };

  if (o.type === 'thread.started' && typeof o.thread_id === 'string') {
    return { type: 'session_id', sessionId: o.thread_id };
  }
  if ((o.type === 'item.completed' || o.type === 'response.output_item.done' || o.type === 'response.output_item.completed') && o.item && typeof o.item === 'object') {
    const replyText = replyTextFromItem(o.item);
    if (replyText !== null) return { type: 'reply_text', text: replyText };
    if (o.item.type === 'error' && typeof o.item.message === 'string') {
      return { type: 'error', message: o.item.message };
    }
  }
  if (o.type === 'response.completed') {
    const replyText = replyTextFromResponse(o.response);
    const response = typeof o.response === 'object' && o.response !== null
      ? o.response as { usage?: unknown }
      : undefined;
    const usage = contextUsage(response?.usage);
    if (replyText !== null) return { type: 'reply_text', text: replyText, ...(usage ? { usage } : {}) };
    if (usage) return { type: 'context_usage', usage };
  }
  if (o.type === 'turn.completed') {
    const usage = contextUsage(o.usage);
    if (usage) return { type: 'context_usage', usage };
  }
  return { type: 'unknown', raw: o };
}

/** codex's LineParser implementation. */
export const codexParser: LineParser = { parse: parseJsonlLine };
