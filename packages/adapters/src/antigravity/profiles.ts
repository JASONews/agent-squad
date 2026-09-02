import { AppError } from '@agent-squad/core';

export interface ResolvedProfile {
  name: string;
  sandbox: boolean;
  skipPermissions: boolean;
}

const PROFILES: Record<string, { sandbox: boolean; skipPermissions: boolean }> = {
  antigravity_sandbox: { sandbox: true, skipPermissions: false },
  antigravity_auto: { sandbox: false, skipPermissions: true },
};

export const DEFAULT_PROFILE = 'antigravity_sandbox';

export function resolveProfile(name?: string): ResolvedProfile {
  const n = name ?? DEFAULT_PROFILE;
  const p = PROFILES[n];
  if (!p) throw new AppError('permission_profile_unknown', `unknown antigravity permission profile: ${n}`);
  return { name: n, ...p };
}

/** Returns the profile's flags for `agy` (without --print and the prompt; caller adds those). */
export function profileFlags(profile: ResolvedProfile): string[] {
  if (profile.skipPermissions) return ['--dangerously-skip-permissions'];
  if (profile.sandbox) return ['--sandbox'];
  return [];
}
