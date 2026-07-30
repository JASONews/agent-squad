import { describe, it, expect } from 'vitest';
import { parseJsonlLine } from '../src/codex/jsonl.js';

describe('parseJsonlLine', () => {
  it('parses thread.started → session_id', () => {
    const e = parseJsonlLine('{"type":"thread.started","thread_id":"abc-123"}');
    expect(e).toEqual({ type: 'session_id', sessionId: 'abc-123' });
  });
  it('parses item.completed agent_message → reply_text', () => {
    const e = parseJsonlLine('{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"pong"}}');
    expect(e).toEqual({ type: 'reply_text', text: 'pong' });
  });
  it('parses item.completed agent_message content blocks → reply_text', () => {
    const e = parseJsonlLine(JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_2',
        type: 'agent_message',
        content: [
          { type: 'text', text: 'Need a decision.\n' },
          { type: 'output_text', text: '%%AGENT_SQUAD_CHOICE%%\n{"question":"Q?","options":[{"id":"a","label":"A"}]}\n%%END_AGENT_SQUAD_CHOICE%%' },
        ],
      },
    }));
    expect(e).toEqual({
      type: 'reply_text',
      text: 'Need a decision.\n%%AGENT_SQUAD_CHOICE%%\n{"question":"Q?","options":[{"id":"a","label":"A"}]}\n%%END_AGENT_SQUAD_CHOICE%%',
    });
  });
  it('parses response.output_item.done message content blocks → reply_text', () => {
    const e = parseJsonlLine(JSON.stringify({
      type: 'response.output_item.done',
      item: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'pong' }],
      },
    }));
    expect(e).toEqual({ type: 'reply_text', text: 'pong' });
  });
  it('parses response.completed assistant output content blocks → reply_text', () => {
    const e = parseJsonlLine(JSON.stringify({
      type: 'response.completed',
      response: {
        output: [
          { type: 'reasoning', content: [{ type: 'summary_text', text: 'thinking' }] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'final answer' }] },
        ],
      },
    }));
    expect(e).toEqual({ type: 'reply_text', text: 'final answer' });
  });
  it('parses item.completed error item → error', () => {
    const e = parseJsonlLine('{"type":"item.completed","item":{"id":"item_0","type":"error","message":"boom"}}');
    expect(e).toEqual({ type: 'error', message: 'boom' });
  });
  it('treats reasoning item.completed as unknown (NOT reply_text)', () => {
    const e = parseJsonlLine('{"type":"item.completed","item":{"id":"item_1","type":"reasoning","text":"thinking..."}}');
    expect(e?.type).toBe('unknown');
  });
  it('treats turn.started as unknown and normalizes turn.completed usage', () => {
    expect(parseJsonlLine('{"type":"turn.started"}')?.type).toBe('unknown');
    expect(parseJsonlLine(JSON.stringify({
      type: 'turn.completed',
      usage: {
        input_tokens: 17916,
        cached_input_tokens: 4992,
        output_tokens: 34,
        reasoning_output_tokens: 27,
      },
    }))).toEqual({
      type: 'context_usage',
      usage: {
        inputTokens: 17916,
        cachedInputTokens: 4992,
        outputTokens: 34,
        reasoningOutputTokens: 27,
      },
    });
    expect(parseJsonlLine('{"type":"turn.completed","usage":{}}')?.type).toBe('unknown');
  });
  it('returns unknown for an unrecognized future event (forward-compat, no throw)', () => {
    const e = parseJsonlLine('{"type":"some.future.event","foo":"bar"}');
    expect(e?.type).toBe('unknown');
    expect(e?.raw).toEqual({ type: 'some.future.event', foo: 'bar' });
  });
  it('returns null for blank lines', () => {
    expect(parseJsonlLine('')).toBeNull();
    expect(parseJsonlLine('   ')).toBeNull();
  });
  it('returns unknown (raw string) for unparseable lines, does not throw', () => {
    const e = parseJsonlLine('not json at all');
    expect(e?.type).toBe('unknown');
  });
});
