import { describe, it, expect } from 'vitest';
import {
  StartSessionSchema, SpawnSubagentSchema, SendToSubagentBodySchema, PostArtifactSchema,
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
  it('PostArtifactSchema requires kind + content', () => {
    expect(PostArtifactSchema.safeParse({ kind: 'summary' }).success).toBe(false);
    expect(PostArtifactSchema.safeParse({ kind: 'summary', content: 'x' }).success).toBe(true);
  });
});
