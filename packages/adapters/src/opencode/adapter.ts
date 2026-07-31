import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type {
  AdapterCapabilities,
  CliAdapter,
  DetectResult,
  ModelDiscoveryInput,
  ModelDiscoveryResult,
  ModelProfileCatalog,
  ModelSelectionInfo,
  SendInput,
  SendResult,
  SpawnInput,
  SubagentHandle,
} from '@agent-squad/core';
import { opencodeParser } from './jsonl.js';
import { resolveProfile, runArgs } from './profiles.js';
import { filterEnv } from '../shared/env.js';
import { runJsonlProcess } from '../shared/jsonl-runner.js';
import {
  KeyedModelDiscoveryCache,
  parseModelLines,
  runDiscoveryCommand,
} from '../shared/model-discovery.js';
import { runPtyProcess } from '../shared/pty-runner.js';
import { injectInstruction, injectAgentSquadEnv } from '../shared/subagent-context.js';
import { OFFICIAL_MODEL_PROFILES } from '../model-profiles.js';

export interface OpencodeAdapterOpts {
  env?: NodeJS.ProcessEnv;
  binary?: string;
  usePty?: boolean;
  modelDiscoveryTimeoutMs?: number;
  modelProfileOverrides?: ModelProfileCatalog;
}

export class OpencodeAdapter implements CliAdapter {
  readonly cliType = 'opencode' as const;
  private readonly opts: OpencodeAdapterOpts;
  private readonly discoveryCache: KeyedModelDiscoveryCache;
  private detectCache: DetectResult | null = null;
  private idleTimeoutMs = 15_000;
  private blockAfterMs = 30_000;
  readonly roles = ['implementer', 'tester', 'fallback_generalist', 'reviewer'];
  readonly strengths = 'Multi-model support with flexible fallback. Good at implementation, testing, and general-purpose tasks across different model providers.';
  readonly weaknesses = 'Review quality may vary by model. Not specialized for UI design.';
  readonly modelProfiles = OFFICIAL_MODEL_PROFILES.opencode;
  readonly modelProfileOverrides: ModelProfileCatalog;
  readonly modelSelection: ModelSelectionInfo = {
    model: {
      parameter: 'model',
      source: 'opencode run --model <provider/model>; accepts provider/model ids configured in opencode.',
      examples: ['opencode-go/minimax-m3'],
    },
    reasoningEffort: {
      parameter: 'reasoning_effort',
      source: 'opencode run --variant <value>; variants are provider-specific.',
    },
  };

  constructor(opts: OpencodeAdapterOpts = {}) {
    this.opts = opts;
    this.modelProfileOverrides = opts.modelProfileOverrides ?? {};
    this.discoveryCache = new KeyedModelDiscoveryCache(
      'opencode models',
      async (cwd) => ({
        status: 'available',
        source: 'opencode models',
        models: parseModelLines(await runDiscoveryCommand({
          binary: this.opts.binary ?? 'opencode',
          args: ['models'],
          env: this.opts.env ?? process.env,
          cwd,
          timeoutMs: this.opts.modelDiscoveryTimeoutMs,
        })),
      }),
    );
  }

  setBlockTimingsForTest(idle: number, block: number): void { this.idleTimeoutMs = idle; this.blockAfterMs = block; }

  async detect(): Promise<DetectResult> {
    if (this.detectCache) return this.detectCache;
    const bin = this.opts.binary ?? 'opencode';
    return new Promise((resolve) => {
      const child = spawn(bin, ['--version'], { env: this.opts.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('error', () => { this.detectCache = { available: false }; resolve(this.detectCache); });
      child.on('close', (code) => {
        this.detectCache = code === 0 ? { available: true, version: out.trim() || undefined, path: bin } : { available: false };
        resolve(this.detectCache);
      });
    });
  }

  capabilities(): AdapterCapabilities {
    return { mcp: false, plugin: false, headless: true, resume: true, persistentServer: false, autoApprove: true, structuredOutput: true };
  }

  discoverModels(input: ModelDiscoveryInput = {}): Promise<ModelDiscoveryResult> {
    const cwd = resolve(input.cwd ?? process.cwd());
    return this.discoveryCache.get(cwd);
  }

  async spawnSubagent(input: SpawnInput): Promise<SubagentHandle> {
    resolveProfile(input.permissionProfile);
    return { subagentId: input.subagentId, nativeSessionId: undefined, status: 'ready' };
  }

  async send(input: SendInput): Promise<SendResult> {
    const profile = resolveProfile(input.permissionProfile);
    const cwd = input.cwd ?? '.';
    const isResume = !!input.nativeSessionId;
    const message = isResume ? input.message : injectInstruction(input.message);
    const runOptions = { model: input.model, reasoningEffort: input.reasoningEffort };
    const args = input.nativeSessionId
      ? [...runArgs(profile, cwd, runOptions), '-s', input.nativeSessionId, input.message]
      : [...runArgs(profile, cwd, runOptions), message];
    const env = injectAgentSquadEnv(filterEnv(this.opts.env ?? process.env), input);
    const result = this.opts.usePty === false
      ? await runJsonlProcess({
          binary: this.opts.binary ?? 'opencode', args, env,
          parser: opencodeParser,
          idleTimeoutMs: this.idleTimeoutMs, blockAfterMs: this.blockAfterMs,
          hardTimeoutMs: input.hardTimeoutMs,
          onOutput: input.onOutput,
        })
      : await runPtyProcess({
          binary: this.opts.binary ?? 'opencode', args, env, cwd,
          parser: opencodeParser,
          idleTimeoutMs: this.idleTimeoutMs, blockAfterMs: this.blockAfterMs,
          hardTimeoutMs: input.hardTimeoutMs,
          onOutput: input.onOutput,
        });
    return result;  // RunJsonlResult is structurally a SendResult
  }
}
