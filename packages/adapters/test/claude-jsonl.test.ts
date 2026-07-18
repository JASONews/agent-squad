import { describe, it, expect } from 'vitest';
import { claudeParser, parseClaudeLine } from '../src/claude/jsonl.js';
import { LineAccumulator } from '../src/shared/line-parser.js';

describe('parseClaudeLine', () => {
  it('parses system init session_id', () => {
    const e = parseClaudeLine('{"type":"system","subtype":"init","session_id":"claude-session"}');
    expect(e).toEqual({ type: 'session_id', sessionId: 'claude-session' });
  });

  it('parses result success into final reply text and session id', () => {
    const e = parseClaudeLine('{"type":"result","subtype":"success","session_id":"claude-session","result":"final answer"}');
    expect(e).toEqual({ type: 'reply_text', text: 'final answer', sessionId: 'claude-session' });
  });

  it('parses result error into error', () => {
    const e = parseClaudeLine('{"type":"result","subtype":"error","session_id":"claude-session","error":"boom"}');
    expect(e).toEqual({ type: 'error', message: 'boom', sessionId: 'claude-session' });
  });

  it('treats assistant messages as unknown so final result text is not duplicated', () => {
    const e = parseClaudeLine(JSON.stringify({
      type: 'assistant',
      session_id: 'claude-session',
      message: { role: 'assistant', content: [{ type: 'text', text: 'intermediate answer' }] },
    }));
    expect(e?.type).toBe('unknown');
  });

  it('returns null for blank lines', () => {
    expect(parseClaudeLine('')).toBeNull();
    expect(parseClaudeLine('   ')).toBeNull();
  });

  it('returns unknown for unparseable lines', () => {
    const e = parseClaudeLine('not json');
    expect(e?.type).toBe('unknown');
  });
});

describe('claudeParser accumulation', () => {
  it('captures session id and final result', () => {
    const acc = new LineAccumulator();
    for (const line of [
      '{"type":"system","subtype":"init","session_id":"claude-session"}',
      '{"type":"assistant","session_id":"claude-session","message":{"role":"assistant","content":[{"type":"text","text":"ignored"}]}}',
      '{"type":"result","subtype":"success","session_id":"claude-session","result":"final answer"}',
    ]) {
      const e = claudeParser.parse(line);
      if (e) acc.add(e);
    }
    expect(acc.sessionId).toBe('claude-session');
    expect(acc.replyText).toBe('final answer');
  });
});
