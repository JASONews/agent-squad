import { describe, it, expect } from 'vitest';
import { resolveProfile, profileFlags, DEFAULT_PROFILE } from '../src/antigravity/profiles.js';

describe('resolveProfile', () => {
  it('defaults to antigravity_sandbox', () => {
    expect(resolveProfile().name).toBe('antigravity_sandbox');
    expect(DEFAULT_PROFILE).toBe('antigravity_sandbox');
  });
  it('antigravity_sandbox has sandbox=true, skipPermissions=false', () => {
    const p = resolveProfile('antigravity_sandbox');
    expect(p.sandbox).toBe(true);
    expect(p.skipPermissions).toBe(false);
  });
  it('antigravity_auto has sandbox=false, skipPermissions=true', () => {
    const p = resolveProfile('antigravity_auto');
    expect(p.sandbox).toBe(false);
    expect(p.skipPermissions).toBe(true);
  });
  it('throws permission_profile_unknown on bad name', () => {
    try { resolveProfile('bogus'); throw new Error('expected throw'); }
    catch (e) { expect((e as { code?: string }).code).toBe('permission_profile_unknown'); }
  });
});

describe('profileFlags', () => {
  it('antigravity_sandbox → ["--sandbox"]', () => {
    expect(profileFlags(resolveProfile('antigravity_sandbox'))).toEqual(['--sandbox']);
  });
  it('antigravity_auto → ["--dangerously-skip-permissions"]', () => {
    expect(profileFlags(resolveProfile('antigravity_auto'))).toEqual(['--dangerously-skip-permissions']);
  });
});
