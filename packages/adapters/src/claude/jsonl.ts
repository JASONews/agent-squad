import type { LineEvent, LineParser } from '../shared/line-parser.js';

interface ClaudeEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  result?: unknown;
  error?: unknown;
  message?: unknown;
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
  if (o.type === 'result' && o.subtype === 'success' && typeof o.result === 'string') {
    return { type: 'reply_text', text: o.result, sessionId: typeof o.session_id === 'string' ? o.session_id : undefined };
  }
  if ((o.type === 'result' && o.subtype === 'error') || o.type === 'error') {
    return {
      type: 'error',
      message: errorMessage(o.error) ?? errorMessage(o.message) ?? 'Claude Code returned an error',
      sessionId: typeof o.session_id === 'string' ? o.session_id : undefined,
    };
  }
  return { type: 'unknown', raw: o };
}

export const claudeParser: LineParser = { parse: parseClaudeLine };
