import { AppError } from '@agent-squad/core';
import type {
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';

export type KimiPermissionProfile = 'kimi_auto' | 'kimi_readonly';

export interface ResolvedProfile {
  name: KimiPermissionProfile;
  readonly: boolean;
}

const PROFILES: Record<KimiPermissionProfile, Omit<ResolvedProfile, 'name'>> = {
  kimi_auto: { readonly: false },
  kimi_readonly: { readonly: true },
};

export const DEFAULT_PROFILE: KimiPermissionProfile = 'kimi_auto';

export function resolveProfile(name?: string): ResolvedProfile {
  const selected = name ?? DEFAULT_PROFILE;
  if (!(selected in PROFILES)) {
    throw new AppError('permission_profile_unknown', `unknown kimi permission profile: ${selected}`);
  }
  const profileName = selected as KimiPermissionProfile;
  return { name: profileName, ...PROFILES[profileName] };
}

export function selectPermissionResponse(
  profile: ResolvedProfile,
  request: RequestPermissionRequest,
): RequestPermissionResponse {
  // Kimi's ACP approval payload does not reliably include a read/write tool kind.
  // Reject every prompted operation in readonly mode; unprompted reads still work.
  const allow = !profile.readonly;
  const option = allow
    ? findOption(request.options, ['allow_once', 'allow_always'])
    : findOption(request.options, ['reject_once', 'reject_always']);

  return option
    ? { outcome: { outcome: 'selected', optionId: option.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

function findOption(
  options: PermissionOption[],
  preferredKinds: PermissionOption['kind'][],
): PermissionOption | undefined {
  for (const kind of preferredKinds) {
    const option = options.find((candidate) => candidate.kind === kind);
    if (option) return option;
  }
  return undefined;
}
