import { describe, it, expect } from 'vitest';
import {
  StartSessionSchema, SpawnSubagentSchema, SendToSubagentBodySchema,
  WaitSubagentBodySchema, InspectSubagentQuerySchema, PostArtifactSchema,
} from '../src/validation/schemas.js';

describe('validation schemas', () => {
  it('StartSessionSchema accepts a valid body and rejects missing task', () => {
    expect(StartSessionSchema.safeParse({ cwd: '/r', task: 'do it' }).success).toBe(true);
    const r = StartSessionSchema.safeParse({ cwd: '/r' });
    expect(r.success).toBe(false);
  });
  it('SpawnSubagentSchema rejects empty alias', () => {
    expect(SpawnSubagentSchema.safeParse({ alias: '', cli: 'mock', role: 'r', message: 'm' }).success).toBe(false);
    expect(SpawnSubagentSchema.safeParse({ alias: 'a', cli: 'mock', role: 'r', message: 'm' }).success).toBe(true);
  });
  it('SpawnSubagentSchema accepts model and reasoning_effort selection', () => {
    const parsed = SpawnSubagentSchema.safeParse({
      alias: 'a',
      cli: 'codex',
      role: 'reviewer',
      message: 'm',
      model: 'gpt-5.5',
      reasoning_effort: 'xhigh',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.model).toBe('gpt-5.5');
    expect(parsed.success && parsed.data.reasoning_effort).toBe('xhigh');
  });
  it('SendToSubagentBodySchema requires message', () => {
    expect(SendToSubagentBodySchema.safeParse({}).success).toBe(false);
    expect(SendToSubagentBodySchema.safeParse({ message: 'hi' }).success).toBe(true);
  });
  it('progress baselines accept nonnegative integers only', () => {
    expect(WaitSubagentBodySchema.safeParse({ after_output_event_count: 0 }).success).toBe(true);
    expect(WaitSubagentBodySchema.safeParse({ after_output_event_count: -1 }).success).toBe(false);
    const query = InspectSubagentQuerySchema.safeParse({ after_output_event_count: '12' });
    expect(query.success && query.data.after_output_event_count).toBe(12);
    expect(InspectSubagentQuerySchema.safeParse({ after_output_event_count: '1.5' }).success).toBe(false);
  });
  it('PostArtifactSchema requires kind + content', () => {
    expect(PostArtifactSchema.safeParse({ kind: 'summary' }).success).toBe(false);
    expect(PostArtifactSchema.safeParse({ kind: 'summary', content: 'x' }).success).toBe(true);
  });
});
