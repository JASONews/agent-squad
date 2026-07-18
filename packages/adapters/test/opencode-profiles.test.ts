import { describe, it, expect } from 'vitest';
import { resolveProfile, runArgs, DEFAULT_PROFILE } from '../src/opencode/profiles.js';

describe('resolveProfile', () => {
  it('defaults to opencode_auto', () => {
    expect(resolveProfile().name).toBe('opencode_auto');
    expect(DEFAULT_PROFILE).toBe('opencode_auto');
  });
  it('opencode_auto has skipPermissions true; opencode_prompt false', () => {
    expect(resolveProfile('opencode_auto').skipPermissions).toBe(true);
    expect(resolveProfile('opencode_prompt').skipPermissions).toBe(false);
  });
  it('throws permission_profile_unknown on bad name', () => {
    try { resolveProfile('bogus'); throw new Error('expected throw'); }
    catch (e) { expect((e as { code?: string }).code).toBe('permission_profile_unknown'); }
  });
});

describe('runArgs', () => {
  it('opencode_auto includes --dangerously-skip-permissions, --format json, --dir', () => {
    const args = runArgs(resolveProfile('opencode_auto'), '/repo');
    expect(args).toContain('run');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--format');
    expect(args).toContain('json');
    expect(args).toContain('--dir');
    expect(args).toContain('/repo');
  });
  it('opencode_prompt does NOT include --dangerously-skip-permissions', () => {
    const args = runArgs(resolveProfile('opencode_prompt'), '/repo');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });
  it('includes model and variant when selected', () => {
    const args = runArgs(resolveProfile('opencode_auto'), '/repo', { model: 'opencode-go/minimax-m3', reasoningEffort: 'thinking' });
    expect(args).toContain('--model');
    expect(args).toContain('opencode-go/minimax-m3');
    expect(args).toContain('--variant');
    expect(args).toContain('thinking');
  });
});
