import { describe, it, expect } from 'vitest';
import { firstSendArgs, resumeArgs, resolveProfile } from '../src/claude/profiles.js';

describe('resolveClaudeProfile', () => {
  it('defaults to claude_auto', () => {
    expect(resolveProfile().name).toBe('claude_auto');
  });

  it('resolves known permission profiles', () => {
    expect(resolveProfile('claude_auto').permissionMode).toBe('bypassPermissions');
    expect(resolveProfile('claude_prompt').permissionMode).toBe('default');
    expect(resolveProfile('claude_plan').permissionMode).toBe('plan');
  });

  it('throws permission_profile_unknown on unknown name', () => {
    try {
      resolveProfile('bogus');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('permission_profile_unknown');
    }
  });
});

describe('claude firstSendArgs', () => {
  it('uses print mode with stream-json output and permission mode', () => {
    const args = firstSendArgs(resolveProfile('claude_auto'));
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--permission-mode');
    expect(args).toContain('bypassPermissions');
  });

  it('defaults to Claude default model with max effort', () => {
    const args = firstSendArgs(resolveProfile('claude_auto'));
    expect(args).toContain('--model');
    expect(args).toContain('default');
    expect(args).toContain('--effort');
    expect(args).toContain('max');
  });

  it('includes model and effort when selected', () => {
    const args = firstSendArgs(resolveProfile('claude_auto'), { model: 'sonnet', reasoningEffort: 'high' });
    expect(args).toContain('--model');
    expect(args).toContain('sonnet');
    expect(args).toContain('--effort');
    expect(args).toContain('high');
  });
});

describe('claude resumeArgs', () => {
  it('resumes by session id and preserves print stream-json mode', () => {
    const args = resumeArgs(resolveProfile('claude_auto'), 'claude-session');
    expect(args).toContain('-p');
    expect(args).toContain('--resume');
    expect(args).toContain('claude-session');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--model');
    expect(args).toContain('default');
    expect(args).toContain('--effort');
    expect(args).toContain('max');
  });
});
