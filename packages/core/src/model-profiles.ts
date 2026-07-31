import type {
  ModelCapabilityDetails,
  ModelCapabilityProfile,
  ModelProfileCatalog,
  ModelProfileSource,
  ResolvedModelCapabilityProfile,
} from './adapters/types.js';

function globMatches(pattern: string, modelId: string): boolean {
  const expression = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${expression}$`, 'i').test(modelId);
}

function patternSpecificity(pattern: string): [literalLength: number, wildcardCount: number] {
  return [
    pattern.replaceAll('*', '').length,
    [...pattern].filter((character) => character === '*').length,
  ];
}

function matchingProfiles(catalog: ModelProfileCatalog, modelId: string): ModelCapabilityProfile[] {
  return Object.entries(catalog)
    .filter(([pattern]) => globMatches(pattern, modelId))
    .sort(([left], [right]) => {
      const [leftLength, leftWildcards] = patternSpecificity(left);
      const [rightLength, rightWildcards] = patternSpecificity(right);
      return leftLength - rightLength
        || rightWildcards - leftWildcards
        || left.localeCompare(right);
    })
    .map(([, profile]) => profile);
}

function mergeEffortProfiles(
  base: Record<string, ModelCapabilityDetails> | undefined,
  overlay: Record<string, ModelCapabilityDetails> | undefined,
): Record<string, ModelCapabilityDetails> | undefined {
  if (!base && !overlay) return undefined;
  const merged: Record<string, ModelCapabilityDetails> = {};
  for (const [effort, details] of Object.entries(base ?? {})) {
    merged[effort] = { ...details };
  }
  for (const [effort, details] of Object.entries(overlay ?? {})) {
    merged[effort] = { ...merged[effort], ...details };
  }
  return merged;
}

export function mergeModelCapabilityProfiles(
  base: ModelCapabilityProfile,
  overlay: ModelCapabilityProfile,
): ModelCapabilityProfile {
  const {
    effortProfiles: baseEffortProfiles,
    ...baseDetails
  } = base;
  const {
    effortProfiles: overlayEffortProfiles,
    ...overlayDetails
  } = overlay;
  const effortProfiles = mergeEffortProfiles(baseEffortProfiles, overlayEffortProfiles);
  return {
    ...baseDetails,
    ...overlayDetails,
    ...(effortProfiles ? { effortProfiles } : {}),
  };
}

export function resolveModelCapabilityProfile(
  modelId: string,
  officialProfiles: ModelProfileCatalog = {},
  userOverrides: ModelProfileCatalog = {},
): ResolvedModelCapabilityProfile | undefined {
  const officialMatches = matchingProfiles(officialProfiles, modelId);
  const overrideMatches = matchingProfiles(userOverrides, modelId);
  if (officialMatches.length === 0 && overrideMatches.length === 0) return undefined;

  let profile: ModelCapabilityProfile = {};
  for (const candidate of officialMatches) {
    profile = mergeModelCapabilityProfiles(profile, candidate);
  }
  for (const candidate of overrideMatches) {
    profile = mergeModelCapabilityProfiles(profile, candidate);
  }

  let source: ModelProfileSource = 'official_default';
  if (overrideMatches.length > 0) {
    source = officialMatches.length > 0 ? 'merged' : 'user_override';
  }
  return { ...profile, source };
}
