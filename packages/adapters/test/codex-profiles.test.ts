import { describe, it, expect } from 'vitest';
import { resolveProfile, firstSendArgs, resumeArgs } from '../src/codex/profiles.js';

describe('resolveProfile', () => {
  it('defaults to codex_workspace_auto when name omitted', () => {
    expect(resolveProfile().name).toBe('codex_workspace_auto');
    expect(resolveProfile(undefined).name).toBe('codex_workspace_auto');
  });
  it('resolves the three known profiles', () => {
    expect(resolveProfile('codex_workspace_auto').sandbox).toBe('workspace-write');
    expect(resolveProfile('codex_readonly_auto').sandbox).toBe('read-only');
    expect(resolveProfile('codex_full_auto').sandbox).toBe('danger-full-access');
    expect(resolveProfile('codex_full_auto').dangerous).toBe(true);
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

describe('firstSendArgs', () => {
  const p = resolveProfile('codex_workspace_auto');
  it('includes --sandbox, -c approval_policy=never, --json, --output-last-message, --cd', () => {
    const args = firstSendArgs(p, '/repo', '/tmp/last.txt');
    expect(args).toContain('--sandbox');
    expect(args).toContain('workspace-write');
    expect(args.join(' ')).toContain('approval_policy');
    expect(args).toContain('--json');
    expect(args).toContain('--cd');
    expect(args).toContain('/repo');
    expect(args).toContain('--output-last-message');
    expect(args).toContain('/tmp/last.txt');
  });
  it('includes model and reasoning effort when selected', () => {
    const args = firstSendArgs(p, '/repo', '/tmp/last.txt', { model: 'gpt-5.5', reasoningEffort: 'xhigh' });
    expect(args).toContain('--model');
    expect(args).toContain('gpt-5.5');
    expect(args).toContain('model_reasoning_effort="xhigh"');
  });
});

describe('resumeArgs', () => {
  const p = resolveProfile('codex_workspace_auto');
  it('does NOT include --sandbox OR --cd (codex exec resume rejects both; resume reuses the original session dir + sandbox) but includes -c approval_policy, --json, --output-last-message', () => {
    const args = resumeArgs(p, '/repo', '/tmp/last.txt');
    expect(args).not.toContain('--sandbox');
    expect(args).not.toContain('-s');
    expect(args).not.toContain('--cd'); // resume rejects --cd
    expect(args.join(' ')).toContain('approval_policy');
    expect(args).toContain('--json');
    expect(args).toContain('--output-last-message');
    expect(args).toContain('/tmp/last.txt');
  });
  it('includes model and reasoning effort when selected', () => {
    const args = resumeArgs(p, '/repo', '/tmp/last.txt', { model: 'gpt-5.5', reasoningEffort: 'xhigh' });
    expect(args).toContain('--model');
    expect(args).toContain('gpt-5.5');
    expect(args).toContain('model_reasoning_effort="xhigh"');
  });
});
