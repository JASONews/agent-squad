import type { Db } from '../db/client.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type {
  CliAdapter,
  ModelDiscoveryErrorCode,
  ModelDiscoveryInput,
  ModelDiscoveryResult,
  ModelDiscoveryStatus,
  ModelSelectionInfo,
} from '../adapters/types.js';

export interface ModelDiscoveryInfo {
  status: ModelDiscoveryStatus;
  source: string;
  models: Array<{
    id: string;
    label?: string;
    is_default?: boolean;
    reasoning_efforts?: string[];
    default_reasoning_effort?: string;
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
      model_discovery: serializeDiscovery(discovery),
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

function serializeDiscovery(discovery: ModelDiscoveryResult): ModelDiscoveryInfo {
  return {
    status: discovery.status,
    source: discovery.source,
    models: discovery.models.map((model) => ({
      id: model.id,
      ...(model.label ? { label: model.label } : {}),
      ...(model.isDefault === undefined ? {} : { is_default: model.isDefault }),
      ...(model.reasoningEfforts === undefined
        ? {}
        : { reasoning_efforts: model.reasoningEfforts }),
      ...(model.defaultReasoningEffort === undefined
        ? {}
        : { default_reasoning_effort: model.defaultReasoningEffort }),
    })),
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
