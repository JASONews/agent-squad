import type { Db } from '../db/client.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type {
  CliAdapter,
  ModelDiscoveryErrorCode,
  ModelDiscoveryInput,
  ModelDiscoveryResult,
  ModelDiscoveryStatus,
  ModelCapabilityDetails,
  ModelProfileCatalog,
  ResolvedModelCapabilityProfile,
  ModelSelectionInfo,
} from '../adapters/types.js';
import { resolveModelCapabilityProfile } from '../model-profiles.js';

export interface ModelCapabilityDetailsInfo {
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
  recommended_for?: string[];
  avoid_for?: string[];
  cost_tier?: string;
  latency_tier?: string;
  priority?: number;
}

export interface ModelCapabilityProfileInfo extends ModelCapabilityDetailsInfo {
  source: 'official_default' | 'user_override' | 'merged';
  effort_profiles?: Record<string, ModelCapabilityDetailsInfo>;
}

export interface ModelDiscoveryInfo {
  status: ModelDiscoveryStatus;
  source: string;
  models: Array<{
    id: string;
    label?: string;
    is_default?: boolean;
    reasoning_efforts?: string[];
    default_reasoning_effort?: string;
    profile?: ModelCapabilityProfileInfo;
  }>;
  default_model?: string;
  reasoning_efforts?: string[];
  default_reasoning_effort?: string;
  error?: ModelDiscoveryErrorCode;
}

export interface SubagentTypeInfo {
  type: string;
  roles: string[];
  strengths: string;
  weaknesses: string;
  model_selection?: ModelSelectionInfo;
  model_discovery: ModelDiscoveryInfo;
  status: 'available' | 'missing' | 'not_configured';
}

export async function listSubagentTypes(
  _db: Db,
  registry: AdapterRegistry,
  input: ModelDiscoveryInput = {},
): Promise<{
  available_subagents: SubagentTypeInfo[];
}> {
  const avail = await registry.listAvailable();
  const available_subagents = await Promise.all(avail.map(async (entry): Promise<SubagentTypeInfo> => {
    const adapter = registry.get(entry.type);
    const discovery = await discoverModels(adapter, entry.available, input);
    return {
      type: entry.type,
      roles: adapter.roles ?? [],
      strengths: adapter.strengths ?? '',
      weaknesses: adapter.weaknesses ?? '',
      model_selection: adapter.modelSelection,
      model_discovery: serializeDiscovery(
        discovery,
        adapter.modelProfiles,
        adapter.modelProfileOverrides,
      ),
      status: entry.available ? 'available' : 'missing',
    };
  }));
  return {
    available_subagents,
  };
}

async function discoverModels(
  adapter: CliAdapter,
  available: boolean,
  input: ModelDiscoveryInput,
): Promise<ModelDiscoveryResult> {
  if (!available) {
    return {
      status: 'unavailable',
      source: 'CLI unavailable',
      models: [],
    };
  }
  if (!adapter.discoverModels) {
    return {
      status: 'unsupported',
      source: 'adapter does not support model discovery',
      models: [],
    };
  }
  try {
    return await adapter.discoverModels(input);
  } catch {
    return {
      status: 'failed',
      source: 'adapter model discovery',
      models: [],
      error: 'model_discovery_failed',
    };
  }
}

function serializeDiscovery(
  discovery: ModelDiscoveryResult,
  officialProfiles: ModelProfileCatalog = {},
  userOverrides: ModelProfileCatalog = {},
): ModelDiscoveryInfo {
  return {
    status: discovery.status,
    source: discovery.source,
    models: discovery.models.map((model) => {
      const profile = resolveModelCapabilityProfile(
        model.id,
        officialProfiles,
        userOverrides,
      );
      return {
        id: model.id,
        ...(model.label ? { label: model.label } : {}),
        ...(model.isDefault === undefined ? {} : { is_default: model.isDefault }),
        ...(model.reasoningEfforts === undefined
          ? {}
          : { reasoning_efforts: model.reasoningEfforts }),
        ...(model.defaultReasoningEffort === undefined
          ? {}
          : { default_reasoning_effort: model.defaultReasoningEffort }),
        ...(profile === undefined ? {} : { profile: serializeModelProfile(profile) }),
      };
    }),
    ...(discovery.defaultModel === undefined ? {} : { default_model: discovery.defaultModel }),
    ...(discovery.reasoningEfforts === undefined
      ? {}
      : { reasoning_efforts: discovery.reasoningEfforts }),
    ...(discovery.defaultReasoningEffort === undefined
      ? {}
      : { default_reasoning_effort: discovery.defaultReasoningEffort }),
    ...(discovery.error === undefined ? {} : { error: discovery.error }),
  };
}

function serializeCapabilityDetails(
  details: ModelCapabilityDetails,
): ModelCapabilityDetailsInfo {
  return {
    ...(details.summary === undefined ? {} : { summary: details.summary }),
    ...(details.strengths === undefined ? {} : { strengths: details.strengths }),
    ...(details.weaknesses === undefined ? {} : { weaknesses: details.weaknesses }),
    ...(details.recommendedFor === undefined
      ? {}
      : { recommended_for: details.recommendedFor }),
    ...(details.avoidFor === undefined ? {} : { avoid_for: details.avoidFor }),
    ...(details.costTier === undefined ? {} : { cost_tier: details.costTier }),
    ...(details.latencyTier === undefined ? {} : { latency_tier: details.latencyTier }),
    ...(details.priority === undefined ? {} : { priority: details.priority }),
  };
}

function serializeModelProfile(
  profile: ResolvedModelCapabilityProfile,
): ModelCapabilityProfileInfo {
  const { source, effortProfiles, ...details } = profile;
  return {
    source,
    ...serializeCapabilityDetails(details),
    ...(effortProfiles === undefined
      ? {}
      : {
          effort_profiles: Object.fromEntries(
            Object.entries(effortProfiles).map(([effort, effortDetails]) => [
              effort,
              serializeCapabilityDetails(effortDetails),
            ]),
          ),
        }),
  };
}
