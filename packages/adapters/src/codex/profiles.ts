import { AppError } from '@agent-squad/core';

export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface ResolvedProfile {
  name: string;
  sandbox: CodexSandbox;
  dangerous: boolean;
}

const PROFILES: Record<string, { sandbox: CodexSandbox; dangerous: boolean }> = {
  codex_workspace_auto: { sandbox: 'workspace-write', dangerous: false },
  codex_readonly_auto: { sandbox: 'read-only', dangerous: false },
  codex_full_auto: { sandbox: 'danger-full-access', dangerous: true },
};

export const DEFAULT_PROFILE = 'codex_workspace_auto';
export const APPROVAL_CONFIG = 'approval_policy="never"';

export interface CodexRunOptions {
  model?: string;
  reasoningEffort?: string;
}

export function resolveProfile(name?: string): ResolvedProfile {
  const n = name ?? DEFAULT_PROFILE;
  const p = PROFILES[n];
  if (!p) throw new AppError('permission_profile_unknown', `unknown codex permission profile: ${n}`);
  return { name: n, ...p };
}

function selectedModelArgs(options: CodexRunOptions): string[] {
  const args: string[] = [];
  if (options.model) args.push('--model', options.model);
  if (options.reasoningEffort) args.push('-c', `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`);
  return args;
}

/** Args for `codex exec` (first send). Includes sandbox + approval config. The PROMPT is appended by the caller. */
export function firstSendArgs(profile: ResolvedProfile, cwd: string, outputLastMessagePath: string, options: CodexRunOptions = {}): string[] {
  return [
    'exec',
    ...selectedModelArgs(options),
    '--cd', cwd,
    '--sandbox', profile.sandbox,
    '-c', APPROVAL_CONFIG,
    '--json',
    '--output-last-message', outputLastMessagePath,
  ];
}

/** Args for `codex exec resume <id>` (subsequent sends). NO --sandbox AND NO --cd — `codex exec resume`
 * accepts neither (verified: it rejects --cd with "unexpected argument" and rejects --sandbox); the
 * resumed session reuses the original's working dir + sandbox + approval policy. Only -c, --json,
 * --output-last-message are safe here. The id + PROMPT are appended by the caller. The `cwd` param
 * is accepted for signature symmetry with firstSendArgs but intentionally unused. */
export function resumeArgs(_profile: ResolvedProfile, _cwd: string, outputLastMessagePath: string, options: CodexRunOptions = {}): string[] {
  return [
    'exec', 'resume',
    ...selectedModelArgs(options),
    '-c', APPROVAL_CONFIG,
    '--json',
    '--output-last-message', outputLastMessagePath,
  ];
}
