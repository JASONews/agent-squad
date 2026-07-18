import type { LineEvent, LineParser } from '../shared/line-parser.js';

interface CodexItem {
  type?: string;
  role?: string;
  text?: string;
  message?: string;
  content?: unknown;
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
  const o = obj as { type?: string; thread_id?: string; item?: CodexItem; response?: unknown };

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
    if (replyText !== null) return { type: 'reply_text', text: replyText };
  }
  return { type: 'unknown', raw: o };
}

/** codex's LineParser implementation. */
export const codexParser: LineParser = { parse: parseJsonlLine };
