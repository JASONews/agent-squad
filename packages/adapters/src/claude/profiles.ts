import { AppError } from '@agent-squad/core';

export type ClaudePermissionMode = 'bypassPermissions' | 'default' | 'plan';

export interface ResolvedProfile {
  name: string;
  permissionMode: ClaudePermissionMode;
}

const PROFILES: Record<string, { permissionMode: ClaudePermissionMode }> = {
  claude_auto: { permissionMode: 'bypassPermissions' },
  claude_prompt: { permissionMode: 'default' },
  claude_plan: { permissionMode: 'plan' },
};

export const DEFAULT_PROFILE = 'claude_auto';
export const DEFAULT_MODEL = 'default';
export const DEFAULT_REASONING_EFFORT = 'max';

export interface ClaudeRunOptions {
  model?: string;
  reasoningEffort?: string;
}

export function resolveProfile(name?: string): ResolvedProfile {
  const n = name ?? DEFAULT_PROFILE;
  const p = PROFILES[n];
  if (!p) throw new AppError('permission_profile_unknown', `unknown claude permission profile: ${n}`);
  return { name: n, ...p };
}

function selectedModelArgs(options: ClaudeRunOptions): string[] {
  return [
    '--model', options.model ?? DEFAULT_MODEL,
    '--effort', options.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
  ];
}

function baseArgs(profile: ResolvedProfile, options: ClaudeRunOptions): string[] {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'text',
    '--permission-mode', profile.permissionMode,
    ...selectedModelArgs(options),
  ];
}

export function firstSendArgs(profile: ResolvedProfile, options: ClaudeRunOptions = {}): string[] {
  return baseArgs(profile, options);
}

export function resumeArgs(profile: ResolvedProfile, nativeSessionId: string, options: ClaudeRunOptions = {}): string[] {
  return [
    ...baseArgs(profile, options),
    '--resume', nativeSessionId,
  ];
}
