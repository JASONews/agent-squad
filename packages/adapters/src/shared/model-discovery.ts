import { spawn } from 'node:child_process';
import type {
  DiscoveredModel,
  ModelDiscoveryErrorCode,
  ModelDiscoveryResult,
} from '@agent-squad/core';

const DEFAULT_DISCOVERY_TIMEOUT_MS = 5_000;
const DEFAULT_SUCCESS_TTL_MS = 5 * 60_000;
const DEFAULT_FAILURE_TTL_MS = 30_000;
const MAX_DISCOVERY_OUTPUT_BYTES = 512 * 1024;
const ANSI_ESCAPE_RE = /\u001B\[[0-?]*[ -/]*[@-~]/g;

export interface DiscoveryCommandOptions {
  binary: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutMs?: number;
}

export class ModelDiscoveryCommandError extends Error {
  constructor(readonly code: ModelDiscoveryErrorCode) {
    super(code);
    this.name = 'ModelDiscoveryCommandError';
  }
}

export class ModelDiscoveryCache {
  private cached: { expiresAt: number; result: ModelDiscoveryResult } | null = null;
  private inFlight: Promise<ModelDiscoveryResult> | null = null;

  constructor(
    private readonly source: string,
    private readonly load: () => Promise<ModelDiscoveryResult>,
    private readonly successTtlMs = DEFAULT_SUCCESS_TTL_MS,
    private readonly failureTtlMs = DEFAULT_FAILURE_TTL_MS,
  ) {}

  async get(): Promise<ModelDiscoveryResult> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.result;
    if (this.inFlight) return this.inFlight;

    const pending = this.load().catch((error: unknown): ModelDiscoveryResult => ({
      status: 'failed',
      source: this.source,
      models: [],
      error: modelDiscoveryErrorCode(error),
    }));
    this.inFlight = pending;
    try {
      const result = await pending;
      const ttl = result.status === 'failed' ? this.failureTtlMs : this.successTtlMs;
      this.cached = { expiresAt: Date.now() + ttl, result };
      return result;
    } finally {
      if (this.inFlight === pending) this.inFlight = null;
    }
  }
}

export class KeyedModelDiscoveryCache {
  private readonly caches = new Map<string, ModelDiscoveryCache>();

  constructor(
    private readonly source: string,
    private readonly load: (key: string) => Promise<ModelDiscoveryResult>,
    private readonly maxEntries = 32,
  ) {}

  get(key: string): Promise<ModelDiscoveryResult> {
    let cache = this.caches.get(key);
    if (cache) {
      this.caches.delete(key);
      this.caches.set(key, cache);
      return cache.get();
    }

    cache = new ModelDiscoveryCache(this.source, () => this.load(key));
    this.caches.set(key, cache);
    if (this.caches.size > this.maxEntries) {
      const oldestKey = this.caches.keys().next().value as string | undefined;
      if (oldestKey !== undefined) this.caches.delete(oldestKey);
    }
    return cache.get();
  }
}

export function runDiscoveryCommand(options: DiscoveryCommandOptions): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(options.binary, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let outputBytes = 0;
    let settled = false;

    const finish = (error?: ModelDiscoveryCommandError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(stripAnsi(stdout));
    };

    const append = (chunk: Buffer, include: boolean): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_DISCOVERY_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(new ModelDiscoveryCommandError('model_discovery_protocol_error'));
        return;
      }
      if (include) stdout += chunk.toString();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new ModelDiscoveryCommandError('model_discovery_timeout'));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => append(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => append(chunk, false));
    child.once('error', () => {
      finish(new ModelDiscoveryCommandError('model_discovery_spawn_failed'));
    });
    child.once('close', (code) => {
      if (code !== 0) {
        finish(new ModelDiscoveryCommandError('model_discovery_command_failed'));
        return;
      }
      finish();
    });
  });
}

export function parseModelLines(output: string): DiscoveredModel[] {
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const rawLine of stripAnsi(output).split(/\r?\n/)) {
    const id = rawLine.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id });
  }
  return models;
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_RE, '');
}

function modelDiscoveryErrorCode(error: unknown): ModelDiscoveryErrorCode {
  return error instanceof ModelDiscoveryCommandError
    ? error.code
    : 'model_discovery_failed';
}
