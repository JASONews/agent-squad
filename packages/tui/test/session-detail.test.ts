import { describe, expect, it } from 'vitest';
import { buildSessionDetailLines } from '../src/views/SessionDetail.js';
import type { TuiState } from '../src/store.js';

describe('buildSessionDetailLines', () => {
  it('places the live output tail at the end for follow-latest paging', () => {
    const state: TuiState = {
      sessions: {
        session: { id: 'session', task: 'review', lastActiveAt: null },
      },
      messages: {
        session: [{ id: 'message', kind: 'assistant' }],
      },
      subagents: {
        session: [{
          id: 'subagent',
          alias: 'reviewer',
          cliType: 'codex',
          status: 'running',
          blocked: false,
          rawTail: 'first\nlatest',
          lastOutputAt: '2026-07-05T10:00:00.000Z',
        }],
      },
      choices: { session: [] },
      artifacts: { session: [] },
    };

    const lines = buildSessionDetailLines(state, 'session');
    expect(lines.at(-1)?.text).toBe('    latest');
    expect(lines.find((line) => line.key === 'tails-heading')?.text).toBe('Live output tails');
  });

  it('puts the most recently updated subagent tail on the final page', () => {
    const state: TuiState = {
      sessions: {},
      messages: {},
      subagents: {
        session: [
          {
            id: 'newer',
            alias: 'newer',
            cliType: 'codex',
            status: 'running',
            blocked: false,
            rawTail: 'new output',
            lastOutputAt: '2026-07-05T10:05:00.000Z',
          },
          {
            id: 'older',
            alias: 'older',
            cliType: 'claude',
            status: 'running',
            blocked: false,
            rawTail: 'old output',
            lastOutputAt: '2026-07-05T10:00:00.000Z',
          },
        ],
      },
      choices: {},
      artifacts: {},
    };

    expect(buildSessionDetailLines(state, 'session').at(-1)?.text).toBe('    new output');
  });
});
