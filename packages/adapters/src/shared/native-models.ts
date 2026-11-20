// Wire formats used by the independently released Core and Gateway adapters.
export function parseAgyModels(output: string): { id: string; label?: string }[] {
  const models = new Map<string, { id: string; label?: string }>();
  for (const raw of output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^(?:[-*]|\d+[.)])\s+/, '');
    if (!line || /^(?:(?:available\s+)?models?:?$|fetching available models\b)/i.test(line)) continue;
    const [key, name] = line.split('\t');
    const id = key?.trim();
    if (!id || models.has(id)) continue;
    const label = name?.trim();
    models.set(id, label ? { id, label } : { id });
  }
  return [...models.values()];
}

export function agyModelArgs(model?: string, effort?: string | null): string[] {
  // Older Agent Squad versions persisted the entire tab-separated catalog row.
  const id = model?.split('\t')[0]?.trim();
  const encoded = id?.match(/(?:-|\s\()(low|medium|high|xhigh|max)\)?$/i)?.[1]?.toLowerCase();
  return [
    ...(id ? ['--model', id] : []),
    ...(effort && effort !== encoded ? ['--effort', effort] : []),
  ];
}

export const CLAUDE_CATALOG_ARGS = [
  '--print', '--safe-mode', '--no-session-persistence', '--disable-slash-commands',
  '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '',
  '--permission-mode', 'dontAsk', '--no-chrome', '--verbose',
  '--input-format', 'stream-json', '--output-format', 'stream-json',
];

const catalogRequestId = 'agent-squad-model-catalog';
export const CLAUDE_CATALOG_INPUT = JSON.stringify({
  type: 'control_request', request_id: catalogRequestId, request: { subtype: 'initialize' },
}) + '\n';

interface ClaudeModel {
  id: string;
  label: string;
  efforts?: string[];
}

export function parseClaudeModels(output: string): ClaudeModel[] | undefined {
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    const response = event?.response;
    if (event?.type !== 'control_response' || response?.request_id !== catalogRequestId
      || response.subtype !== 'success' || !Array.isArray(response.response?.models)) continue;
    const models = new Map<string, ClaudeModel>();
    for (const row of response.response.models) {
      if (typeof row?.value !== 'string' || !row.value || models.has(row.value)) continue;
      const efforts = row.supportsEffort === false ? [] : row.supportedEffortLevels;
      models.set(row.value, {
        id: row.value, label: typeof row.displayName === 'string' ? row.displayName : row.value,
        ...(Array.isArray(efforts) ? { efforts: efforts.filter((v): v is string => typeof v === 'string' && !!v) } : {}),
      });
    }
    return [...models.values()];
  }
  return undefined;
}
