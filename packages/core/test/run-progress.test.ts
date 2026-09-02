import { describe, expect, it } from 'vitest';
import {
  RUN_RECENT_OUTPUT_MS,
  RUN_STALL_SUSPECT_MS,
  buildSubagentRunProgress,
  serializeSubagentRunProgress,
} from '../src/run-progress.js';

const NOW = Date.parse('2026-07-29T12:00:00.000Z');

describe('buildSubagentRunProgress', () => {
  it('distinguishes not started, active progress, and terminal states', () => {
    expect(buildSubagentRunProgress({
      status: 'ready',
      runActive: false,
      outputEvents: 0,
    }, 0, NOW)).toMatchObject({
      assessment: 'not_started',
      recommendedAction: 'send',
      runActive: false,
    });

    expect(buildSubagentRunProgress({
      status: 'running',
      runActive: true,
      startedAt: '2026-07-29T11:55:00.000Z',
      lastOutputAt: '2026-07-29T11:59:30.000Z',
      outputEvents: 12,
    }, 10, NOW)).toMatchObject({
      assessment: 'progressing',
      recommendedAction: 'wait',
      outputEvents: 12,
      newOutputEvents: 2,
      hasNewOutput: true,
      idleMs: 30_000,
    });

    expect(buildSubagentRunProgress({
      status: 'completed',
      runActive: true,
      startedAt: '2026-07-29T11:55:00.000Z',
      outputEvents: 12,
    }, 0, NOW)).toMatchObject({
      assessment: 'completed',
      recommendedAction: 'none',
      runActive: false,
    });
  });

  it('uses conservative quiet and possibly-stalled thresholds', () => {
    const quiet = buildSubagentRunProgress({
      status: 'running',
      runActive: true,
      startedAt: new Date(NOW - RUN_RECENT_OUTPUT_MS - 1).toISOString(),
      outputEvents: 0,
    }, 0, NOW);
    expect(quiet).toMatchObject({
      assessment: 'quiet',
      recommendedAction: 'inspect_then_wait',
    });

    const stalled = buildSubagentRunProgress({
      status: 'running',
      runActive: true,
      startedAt: new Date(NOW - RUN_STALL_SUSPECT_MS).toISOString(),
      outputEvents: 0,
    }, 0, NOW);
    expect(stalled).toMatchObject({
      assessment: 'possibly_stalled',
      recommendedAction: 'consider_split',
    });
  });

  it('marks an untracked running row as orphaned', () => {
    expect(buildSubagentRunProgress({
      status: 'running',
      runActive: false,
      startedAt: '2026-07-29T11:55:00.000Z',
      lastOutputAt: '2026-07-29T11:56:00.000Z',
      outputEvents: 4,
    }, 4, NOW)).toMatchObject({
      assessment: 'orphaned',
      recommendedAction: 'retry_smaller',
      hasNewOutput: false,
    });
  });

  it('serializes diagnostics with snake_case API fields', () => {
    const progress = buildSubagentRunProgress({
      status: 'timeout',
      runActive: false,
      startedAt: '2026-07-29T11:50:00.000Z',
      lastOutputAt: '2026-07-29T11:54:00.000Z',
      outputEvents: 8,
      rawTail: 'last line',
    }, 3, NOW);

    expect(serializeSubagentRunProgress(progress)).toMatchObject({
      assessment: 'timed_out',
      recommended_action: 'retry_smaller',
      run_active: false,
      output_events: 8,
      new_output_events: 5,
      has_new_output: true,
      raw_tail: 'last line',
      recent_output_threshold_ms: RUN_RECENT_OUTPUT_MS,
      stall_suspect_threshold_ms: RUN_STALL_SUSPECT_MS,
    });
  });
});
