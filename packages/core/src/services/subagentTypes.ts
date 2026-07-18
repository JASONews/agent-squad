import type { Db } from '../db/client.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { ModelSelectionInfo } from '../adapters/types.js';

export interface SubagentTypeInfo {
  type: string;
  roles: string[];
  strengths: string;
  weaknesses: string;
  model_selection?: ModelSelectionInfo;
  status: 'available' | 'missing' | 'not_configured';
}

export async function listSubagentTypes(_db: Db, registry: AdapterRegistry): Promise<{
  available_subagents: SubagentTypeInfo[];
}> {
  const avail = await registry.listAvailable();
  return {
    available_subagents: avail.map((a) => {
      const adapter = registry.get(a.type);
      return {
        type: a.type,
        roles: adapter.roles ?? [],
        strengths: adapter.strengths ?? '',
        weaknesses: adapter.weaknesses ?? '',
        model_selection: adapter.modelSelection,
        status: a.available ? 'available' : 'missing',
      };
    }),
  };
}
