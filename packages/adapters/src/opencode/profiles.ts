import { AppError } from '@agent-squad/core';

export interface ResolvedProfile {
  name: string;
  skipPermissions: boolean;
}

const PROFILES: Record<string, { skipPermissions: boolean }> = {
  opencode_auto: { skipPermissions: true },
  opencode_prompt: { skipPermissions: false },
};

export const DEFAULT_PROFILE = 'opencode_auto';

export interface OpencodeRunOptions {
  model?: string;
  reasoningEffort?: string;
}

export function resolveProfile(name?: string): ResolvedProfile {
  const n = name ?? DEFAULT_PROFILE;
  const p = PROFILES[n];
  if (!p) throw new AppError('permission_profile_unknown', `unknown opencode permission profile: ${n}`);
  return { name: n, ...p };
}

/** Args for `opencode run` (without the prompt; resume adds '-s', sessionId, prompt). */
export function runArgs(profile: ResolvedProfile, cwd: string, options: OpencodeRunOptions = {}): string[] {
  const args = ['run', '--format', 'json', '--dir', cwd];
  if (options.model) args.push('--model', options.model);
  if (options.reasoningEffort) args.push('--variant', options.reasoningEffort);
  if (profile.skipPermissions) args.push('--dangerously-skip-permissions');
  return args;
}
