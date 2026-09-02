import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { opencodeParser } from '../src/opencode/jsonl.js';
import { LineAccumulator } from '../src/shared/line-parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
function lines(name: string): string[] {
  return readFileSync(join(fixtures, name), 'utf8').split('\n').filter((l) => l.trim().length > 0);
}

describe('opencodeParser', () => {
  it('text event → reply_text', () => {
    const e = opencodeParser.parse('{"type":"text","sessionID":"ses-x","part":{"type":"text","text":"pong"}}');
    expect(e).toEqual({ type: 'reply_text', text: 'pong' });
  });
  it('assistant message content blocks → reply_text', () => {
    const e = opencodeParser.parse(JSON.stringify({
      type: 'message',
      sessionID: 'ses-x',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Need a decision.\n' },
          { type: 'text', text: '%%AGENT_SQUAD_CHOICE%%\n{"question":"Q?","options":[{"id":"a","label":"A"}]}\n%%END_AGENT_SQUAD_CHOICE%%' },
        ],
      },
    }));
    expect(e).toEqual({
      type: 'reply_text',
      text: 'Need a decision.\n%%AGENT_SQUAD_CHOICE%%\n{"question":"Q?","options":[{"id":"a","label":"A"}]}\n%%END_AGENT_SQUAD_CHOICE%%',
    });
  });
  it('assistant part content blocks → reply_text', () => {
    const e = opencodeParser.parse(JSON.stringify({
      type: 'text',
      sessionID: 'ses-x',
      part: {
        type: 'text',
        content: [{ type: 'text', text: 'pong' }],
      },
    }));
    expect(e).toEqual({ type: 'reply_text', text: 'pong' });
  });
  it('step_start (no part.text) → session_id from sessionID', () => {
    const e = opencodeParser.parse('{"type":"step_start","sessionID":"ses-y","part":{"type":"step-start"}}');
    expect(e).toEqual({ type: 'session_id', sessionId: 'ses-y' });
  });
  it('step_finish normalizes token usage', () => {
    const e = opencodeParser.parse(JSON.stringify({
      type: 'step_finish',
      sessionID: 'ses-y',
      part: {
        tokens: {
          total: 17061,
          input: 15134,
          output: 21,
          reasoning: 0,
          cache: { read: 1906, write: 0 },
        },
      },
    }));
    expect(e).toEqual({
      type: 'context_usage',
      sessionId: 'ses-y',
      usage: {
        totalTokens: 17061,
        inputTokens: 15134,
        outputTokens: 21,
        reasoningOutputTokens: 0,
        cachedInputTokens: 1906,
        cacheWriteInputTokens: 0,
      },
    });
  });
  it('blank line → null', () => {
    expect(opencodeParser.parse('')).toBeNull();
    expect(opencodeParser.parse('   ')).toBeNull();
  });
  it('non-JSON → unknown (no throw)', () => {
    const e = opencodeParser.parse('not json');
    expect(e?.type).toBe('unknown');
  });
  it('object without sessionID/text → unknown', () => {
    const e = opencodeParser.parse('{"type":"something_else"}');
    expect(e?.type).toBe('unknown');
  });
});

describe('opencodeParser over opencode-success.jsonl', () => {
  it('captures sessionID, reply text, and final usage', () => {
    const acc = new LineAccumulator();
    for (const l of lines('opencode-success.jsonl')) {
      const e = opencodeParser.parse(l);
      if (e) acc.add(e);
    }
    expect(acc.sessionId).toBe('ses_0d2337b5fffeiyrJobPy9dYLhs');
    expect(acc.replyText).toBe('pong');
    expect(acc.contextTelemetry).toEqual({
      usage: {
        totalTokens: 17061,
        inputTokens: 15134,
        outputTokens: 21,
        reasoningOutputTokens: 0,
        cachedInputTokens: 1906,
        cacheWriteInputTokens: 0,
      },
    });
  });
});

describe('opencodeParser over opencode-resume.jsonl', () => {
  it('captures sessionID + reply', () => {
    const acc = new LineAccumulator();
    for (const l of lines('opencode-resume.jsonl')) {
      const e = opencodeParser.parse(l);
      if (e) acc.add(e);
    }
    expect(acc.sessionId).toBe('ses_0d2337b5fffeiyrJobPy9dYLhs');
    expect(acc.replyText).toBe('pong');
    expect(acc.contextTelemetry).toEqual({
      usage: {
        totalTokens: 17116,
        inputTokens: 15181,
        outputTokens: 29,
        reasoningOutputTokens: 0,
        cachedInputTokens: 1906,
        cacheWriteInputTokens: 0,
      },
    });
  });
});
