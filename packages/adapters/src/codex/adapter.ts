import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
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
import { codexParser } from './jsonl.js';
import { discoverCodexModels } from './model-discovery.js';
import { resolveProfile, firstSendArgs, resumeArgs } from './profiles.js';
import { filterEnv } from '../shared/env.js';
import { runJsonlProcess } from '../shared/jsonl-runner.js';
import { KeyedModelDiscoveryCache } from '../shared/model-discovery.js';
import { runPtyProcess } from '../shared/pty-runner.js';
import { injectInstruction, injectAgentSquadEnv } from '../shared/subagent-context.js';
import { OFFICIAL_MODEL_PROFILES } from '../model-profiles.js';

export interface CodexAdapterOpts {
  env?: NodeJS.ProcessEnv;
  binary?: string;
  usePty?: boolean;  // default true for real codex; false for tests/stubs
  modelDiscoveryTimeoutMs?: number;
  modelProfileOverrides?: ModelProfileCatalog;
}

export class CodexAdapter implements CliAdapter {
  readonly cliType = 'codex' as const;
  private readonly opts: CodexAdapterOpts;
  private readonly discoveryCache: KeyedModelDiscoveryCache;
  private detectCache: DetectResult | null = null;
  private idleTimeoutMs = 15_000;
  private blockAfterMs = 30_000;
  readonly roles = ['reviewer', 'bug_finder', 'fixer', 'implementer'];
  readonly strengths = 'High-quality code review, bug detection, and precise fixes. Strong at reasoning about diffs and edge cases.';
  readonly weaknesses = 'Not ideal for UI/design tasks. Can be slow for large-scale implementation.';
  readonly modelProfiles = OFFICIAL_MODEL_PROFILES.codex;
  readonly modelProfileOverrides: ModelProfileCatalog;
  readonly modelSelection: ModelSelectionInfo = {
    model: {
      parameter: 'model',
      source: 'codex exec --model <model>; accepts model ids available to the local Codex account/config.',
      examples: ['gpt-6.2-sol', 'gpt-6.2-astra'],
    },
    reasoningEffort: {
      parameter: 'reasoning_effort',
      source: 'codex exec -c model_reasoning_effort="<value>"; valid values are model-specific and reported by model discovery.',
    },
  };

  constructor(opts: CodexAdapterOpts = {}) {
    this.opts = opts;
    this.modelProfileOverrides = opts.modelProfileOverrides ?? {};
    this.discoveryCache = new KeyedModelDiscoveryCache(
      'codex app-server model/list',
      (cwd) => discoverCodexModels({
        binary: this.opts.binary ?? 'codex',
        env: this.opts.env ?? process.env,
        cwd,
        timeoutMs: this.opts.modelDiscoveryTimeoutMs,
      }),
    );
  }

  /** Test-only: shorten block-detection thresholds. */
  setBlockTimingsForTest(idle: number, block: number): void {
    this.idleTimeoutMs = idle;
    this.blockAfterMs = block;
  }

  async detect(): Promise<DetectResult> {
    if (this.detectCache) return this.detectCache;
    const bin = this.opts.binary ?? 'codex';
    return new Promise((resolve) => {
      const child = spawn(bin, ['--version'], { env: this.opts.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('error', () => { this.detectCache = { available: false }; resolve(this.detectCache); });
      child.on('close', (code) => {
        if (code === 0) {
          this.detectCache = { available: true, version: out.trim() || undefined, path: bin };
        } else {
          this.detectCache = { available: false };
        }
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
    // validate profile (throws permission_profile_unknown on bad name)
    resolveProfile(input.permissionProfile);
    return { subagentId: input.subagentId, nativeSessionId: undefined, status: 'ready' };
  }

  async send(input: SendInput): Promise<SendResult> {
    const profile = resolveProfile(input.permissionProfile);
    const isResume = !!input.nativeSessionId;
    const isFirstTurn = input.isFirstTurn ?? !isResume;
    const workDir = mkdtempSync(join(tmpdir(), 'asq-codex-'));
    const lastMsgPath = join(workDir, `last-${input.subagentId}-${randomUUID()}.txt`);
    try {
      const cwd = input.cwd ?? '.';
      const message = isFirstTurn ? injectInstruction(input.message) : input.message;
      const runOptions = { model: input.model, reasoningEffort: input.reasoningEffort };
      const args = isResume
        ? [...resumeArgs(profile, cwd, lastMsgPath, runOptions), input.nativeSessionId as string, message]
        : [...firstSendArgs(profile, cwd, lastMsgPath, runOptions), message];
      const baseEnv = filterEnv(this.opts.env ?? process.env);
      const env = injectAgentSquadEnv(baseEnv, input);
      const result = this.opts.usePty === false
        ? await runJsonlProcess({
            binary: this.opts.binary ?? 'codex', args, env,
            parser: codexParser, outputLastMessagePath: lastMsgPath,
            idleTimeoutMs: this.idleTimeoutMs, blockAfterMs: this.blockAfterMs,
            hardTimeoutMs: input.hardTimeoutMs,
            onOutput: input.onOutput,
            onSessionStarted: input.onSessionStarted,
          })
        : await runPtyProcess({
            binary: this.opts.binary ?? 'codex', args, env, cwd,
            parser: codexParser, outputLastMessagePath: lastMsgPath,
            idleTimeoutMs: this.idleTimeoutMs, blockAfterMs: this.blockAfterMs,
            hardTimeoutMs: input.hardTimeoutMs,
            onOutput: input.onOutput,
            onSessionStarted: input.onSessionStarted,
          });
      return result;  // RunJsonlResult is structurally a SendResult (status/nativeSessionId/reply/rawTail)
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}
