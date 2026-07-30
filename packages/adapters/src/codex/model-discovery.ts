import { spawn } from 'node:child_process';
import { AGENT_SQUAD_VERSION } from '@agent-squad/core';
import type { DiscoveredModel, ModelDiscoveryResult } from '@agent-squad/core';
import { ModelDiscoveryCommandError } from '../shared/model-discovery.js';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_PROTOCOL_OUTPUT_BYTES = 512 * 1024;
const MAX_MODEL_PAGES = 100;

interface DiscoverCodexModelsOptions {
  binary: string;
  env: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutMs?: number;
}

export function discoverCodexModels(options: DiscoverCodexModelsOptions): Promise<ModelDiscoveryResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.binary, ['app-server', '--stdio'], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buffer = '';
    let outputBytes = 0;
    let initialized = false;
    let nextRequestId = 2;
    let pendingModelRequestId: number | null = null;
    let pageCount = 0;
    const seenCursors = new Set<string>();
    const discoveredModels: DiscoveredModel[] = [];
    let settled = false;

    const finish = (result?: ModelDiscoveryResult, error?: ModelDiscoveryCommandError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill('SIGTERM');
      if (error) reject(error);
      else resolve(result as ModelDiscoveryResult);
    };

    const write = (message: Record<string, unknown>): void => {
      if (!child.stdin.writable) {
        finish(undefined, new ModelDiscoveryCommandError('model_discovery_command_failed'));
        return;
      }
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const requestModelPage = (cursor?: string): void => {
      pageCount += 1;
      if (pageCount > MAX_MODEL_PAGES) {
        finish(undefined, new ModelDiscoveryCommandError('model_discovery_protocol_error'));
        return;
      }
      const id = nextRequestId;
      nextRequestId += 1;
      pendingModelRequestId = id;
      write({
        jsonrpc: '2.0',
        id,
        method: 'model/list',
        params: cursor === undefined ? {} : { cursor },
      });
    };

    const acceptLine = (line: string): void => {
      if (!line.trim()) return;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        finish(undefined, new ModelDiscoveryCommandError('model_discovery_protocol_error'));
        return;
      }
      if (!isRecord(message)) {
        finish(undefined, new ModelDiscoveryCommandError('model_discovery_protocol_error'));
        return;
      }
      if (typeof message.method === 'string') return;
      if (message.id === 1 && !initialized) {
        if (!Object.prototype.hasOwnProperty.call(message, 'result')) {
          finish(undefined, new ModelDiscoveryCommandError('model_discovery_protocol_error'));
          return;
        }
        initialized = true;
        write({ jsonrpc: '2.0', method: 'initialized' });
        requestModelPage();
        return;
      }
      if (message.id === pendingModelRequestId) {
        if (!Object.prototype.hasOwnProperty.call(message, 'result')) {
          finish(undefined, new ModelDiscoveryCommandError('model_discovery_protocol_error'));
          return;
        }
        try {
          const page = parseModelListPage(message.result);
          discoveredModels.push(...page.models);
          if (page.nextCursor === undefined) {
            finish(modelDiscoveryResult(discoveredModels));
            return;
          }
          if (seenCursors.has(page.nextCursor)) {
            finish(undefined, new ModelDiscoveryCommandError('model_discovery_protocol_error'));
            return;
          }
          seenCursors.add(page.nextCursor);
          requestModelPage(page.nextCursor);
        } catch {
          finish(undefined, new ModelDiscoveryCommandError('model_discovery_protocol_error'));
        }
      }
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(undefined, new ModelDiscoveryCommandError('model_discovery_timeout'));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_PROTOCOL_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(undefined, new ModelDiscoveryCommandError('model_discovery_protocol_error'));
        return;
      }
      buffer += chunk.toString();
      let newline = buffer.indexOf('\n');
      while (newline >= 0 && !settled) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        acceptLine(line);
        newline = buffer.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_PROTOCOL_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(undefined, new ModelDiscoveryCommandError('model_discovery_protocol_error'));
      }
    });
    child.stdin.once('error', () => {
      finish(undefined, new ModelDiscoveryCommandError('model_discovery_command_failed'));
    });
    child.once('error', () => {
      finish(undefined, new ModelDiscoveryCommandError('model_discovery_spawn_failed'));
    });
    child.once('close', () => {
      if (!settled) finish(undefined, new ModelDiscoveryCommandError('model_discovery_command_failed'));
    });

    write({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'agent-squad',
          title: 'agent-squad',
          version: AGENT_SQUAD_VERSION,
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: [],
        },
      },
    });
  });
}

function parseModelListPage(value: unknown): {
  models: DiscoveredModel[];
  nextCursor?: string;
} {
  if (!isRecord(value) || !Array.isArray(value.data)) throw new Error('invalid model list');
  const models: DiscoveredModel[] = [];
  for (const item of value.data) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0) {
      throw new Error('invalid model');
    }
    if (item.hidden === true) continue;
    const reasoningEfforts = parseReasoningEfforts(item.supportedReasoningEfforts);
    models.push({
      id: item.id,
      ...(typeof item.displayName === 'string' && item.displayName.length > 0
        ? { label: item.displayName }
        : {}),
      ...(item.isDefault === true ? { isDefault: true } : {}),
      ...(reasoningEfforts === undefined ? {} : { reasoningEfforts }),
      ...(typeof item.defaultReasoningEffort === 'string'
        ? { defaultReasoningEffort: item.defaultReasoningEffort }
        : {}),
    });
  }
  if (value.nextCursor !== null
    && value.nextCursor !== undefined
    && typeof value.nextCursor !== 'string') {
    throw new Error('invalid model cursor');
  }
  return {
    models,
    ...(typeof value.nextCursor === 'string' && value.nextCursor.length > 0
      ? { nextCursor: value.nextCursor }
      : {}),
  };
}

function modelDiscoveryResult(discoveredModels: DiscoveredModel[]): ModelDiscoveryResult {
  const models = [...new Map(discoveredModels.map((model) => [model.id, model])).values()];
  const defaultModel = models.find((model) => model.isDefault)?.id;
  return {
    status: 'available',
    source: 'codex app-server model/list',
    models,
    ...(defaultModel ? { defaultModel } : {}),
  };
}

function parseReasoningEfforts(value: unknown): string[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('invalid reasoning efforts');
  return value.map((effort) => {
    if (typeof effort === 'string' && effort.length > 0) return effort;
    if (isRecord(effort) && typeof effort.reasoningEffort === 'string') {
      return effort.reasoningEffort;
    }
    throw new Error('invalid reasoning effort');
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
