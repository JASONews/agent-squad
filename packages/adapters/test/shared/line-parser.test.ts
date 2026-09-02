import { describe, it, expect } from 'vitest';
import { LineAccumulator, LineBuffer } from '../../src/shared/line-parser.js';
import type { LineEvent } from '../../src/shared/line-parser.js';

describe('LineAccumulator', () => {
  it('first session_id wins', () => {
    const a = new LineAccumulator();
    a.add({ type: 'session_id', sessionId: 'ses_one' });
    a.add({ type: 'session_id', sessionId: 'ses_two' });
    expect(a.sessionId).toBe('ses_one');
  });
  it('reply_text accumulates', () => {
    const a = new LineAccumulator();
    a.add({ type: 'reply_text', text: 'hello' });
    a.add({ type: 'reply_text', text: ' world' });
    expect(a.replyText).toBe('hello world');
  });
  it('first error wins', () => {
    const a = new LineAccumulator();
    a.add({ type: 'error', message: 'first' });
    a.add({ type: 'error', message: 'second' });
    expect(a.error).toBe('first');
  });
  it('unknown events are ignored', () => {
    const a = new LineAccumulator();
    a.add({ type: 'unknown', raw: { foo: 1 } });
    expect(a.sessionId).toBeNull();
    expect(a.replyText).toBe('');
    expect(a.error).toBeNull();
  });
  it('keeps the latest usage snapshot and accumulates compaction boundaries', () => {
    const a = new LineAccumulator();
    a.add({ type: 'context_usage', usage: { inputTokens: 100, outputTokens: 5 } });
    a.add({ type: 'context_compaction', compaction: { trigger: 'auto', preTokens: 100 } });
    a.add({ type: 'context_usage', usage: { inputTokens: 40, cachedInputTokens: 12, outputTokens: 7 } });
    a.add({ type: 'context_compaction', compaction: { trigger: 'manual', preTokens: 40 } });

    expect(a.contextTelemetry).toEqual({
      usage: { inputTokens: 40, cachedInputTokens: 12, outputTokens: 7 },
      compactions: [
        { trigger: 'auto', preTokens: 100 },
        { trigger: 'manual', preTokens: 40 },
      ],
    });
  });
  it('initial state', () => {
    const a = new LineAccumulator();
    expect(a.sessionId).toBeNull();
    expect(a.replyText).toBe('');
    expect(a.error).toBeNull();
    expect(a.contextTelemetry).toBeUndefined();
  });
});

describe('LineBuffer', () => {
  it('emits complete lines across chunk boundaries', () => {
    const lines: string[] = [];
    const buffer = new LineBuffer();

    buffer.push('{"type":"thread.', (line) => lines.push(line));
    buffer.push('started"}\n{"type":"text"', (line) => lines.push(line));
    buffer.push('}\n', (line) => lines.push(line));

    expect(lines).toEqual(['{"type":"thread.started"}', '{"type":"text"}']);
  });

  it('flushes the final unterminated line', () => {
    const lines: string[] = [];
    const buffer = new LineBuffer();

    buffer.push('tail-without-newline', (line) => lines.push(line));
    expect(lines).toEqual([]);
    buffer.flush((line) => lines.push(line));

    expect(lines).toEqual(['tail-without-newline']);
  });
});
