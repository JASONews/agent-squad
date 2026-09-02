import { spawn } from 'node:child_process';
import type {
  AdapterCapabilities,
  CliAdapter,
  DetectResult,
  DiscoveredModel,
  ModelDiscoveryResult,
  ModelProfileCatalog,
  ModelSelectionInfo,
  SendInput,
  SendResult,
  SpawnInput,
  SubagentHandle,
} from '@agent-squad/core';
import { claudeParser } from './jsonl.js';
import { firstSendArgs, resolveProfile, resumeArgs } from './profiles.js';
import { filterEnv } from '../shared/env.js';
import { runJsonlProcess } from '../shared/jsonl-runner.js';
import { ModelDiscoveryCache, runDiscoveryCommand } from '../shared/model-discovery.js';
import { injectAgentSquadEnv, injectClaudeContinuation, injectClaudeInstruction } from '../shared/subagent-context.js';
import {
  assertClaudeInputPrimarilyEnglish,
  DEFAULT_CLAUDE_ENGLISH_INPUT_POLICY,
  type ClaudeEnglishInputPolicy,
} from './language.js';
import { OFFICIAL_MODEL_PROFILES } from '../model-profiles.js';

export interface ClaudeAdapterOpts {
  env?: NodeJS.ProcessEnv;
  binary?: string;
  modelDiscoveryTimeoutMs?: number;
  englishInputPolicy?: Partial<ClaudeEnglishInputPolicy>;
  modelProfileOverrides?: ModelProfileCatalog;
}

export class ClaudeAdapter implements CliAdapter {
  readonly cliType = 'claude' as const;
  private readonly opts: ClaudeAdapterOpts;
  private readonly englishInputPolicy: ClaudeEnglishInputPolicy;
  private readonly discoveryCache: ModelDiscoveryCache;
  private detectCache: DetectResult | null = null;
  private idleTimeoutMs = 15_000;
  private blockAfterMs = 30_000;
  readonly roles = ['reviewer', 'bug_finder', 'fixer', 'implementer', 'tester'];
  readonly strengths = 'Strong general coding agent with good repository navigation, implementation, testing, and review. An English-first input policy is enabled by default.';
  readonly weaknesses = 'Assignments and follow-ups that do not meet the configured English-input ratio are rejected before delivery. UI/product design is usually better assigned to antigravity.';
  readonly modelProfiles = OFFICIAL_MODEL_PROFILES.claude;
  readonly modelProfileOverrides: ModelProfileCatalog;
  readonly modelSelection: ModelSelectionInfo = {
    model: {
      parameter: 'model',
      source: 'claude --model <model>; defaults to default when omitted, letting Claude Code resolve its current Opus default. Accepts aliases such as default/sonnet/opus or full Claude Code model names.',
      examples: ['default', 'opus', 'sonnet'],
    },
    reasoningEffort: {
      parameter: 'reasoning_effort',
      source: 'claude --effort <level>; defaults to max when omitted.',
      values: ['low', 'medium', 'high', 'xhigh', 'max'],
    },
  };

  constructor(opts: ClaudeAdapterOpts = {}) {
    this.opts = opts;
    this.modelProfileOverrides = opts.modelProfileOverrides ?? {};
    this.englishInputPolicy = {
      ...DEFAULT_CLAUDE_ENGLISH_INPUT_POLICY,
      ...opts.englishInputPolicy,
    };
    if (!Number.isFinite(this.englishInputPolicy.minimumRatio)
      || this.englishInputPolicy.minimumRatio < 0
      || this.englishInputPolicy.minimumRatio > 1) {
      throw new RangeError('Claude English input minimumRatio must be between 0 and 1');
    }
    this.discoveryCache = new ModelDiscoveryCache(
      'claude --help aliases (partial)',
      async () => parseClaudeHelp(await runDiscoveryCommand({
        binary: this.opts.binary ?? 'claude',
        args: ['--help'],
        env: this.opts.env ?? process.env,
        timeoutMs: this.opts.modelDiscoveryTimeoutMs,
      })),
    );
  }

  setBlockTimingsForTest(idle: number, block: number): void {
    this.idleTimeoutMs = idle;
    this.blockAfterMs = block;
  }

  async detect(): Promise<DetectResult> {
    if (this.detectCache) return this.detectCache;
    const bin = this.opts.binary ?? 'claude';
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

  discoverModels(): Promise<ModelDiscoveryResult> {
    return this.discoveryCache.get();
  }

  validateMessage(message: string): void {
    if (!this.englishInputPolicy.enabled) return;
    assertClaudeInputPrimarilyEnglish(message, this.englishInputPolicy.minimumRatio);
  }

  async spawnSubagent(input: SpawnInput): Promise<SubagentHandle> {
    this.validateMessage(input.message);
    resolveProfile(input.permissionProfile);
    return { subagentId: input.subagentId, nativeSessionId: undefined, status: 'ready' };
  }

  async send(input: SendInput): Promise<SendResult> {
    this.validateMessage(input.message);
    const profile = resolveProfile(input.permissionProfile);
    const isResume = !!input.nativeSessionId;
    const isFirstTurn = input.isFirstTurn ?? !isResume;
    const runOptions = { model: input.model, reasoningEffort: input.reasoningEffort };
    const prompt = isFirstTurn ? injectClaudeInstruction(input.message) : injectClaudeContinuation(input.message);
    const args = isResume
      ? [...resumeArgs(profile, input.nativeSessionId as string, runOptions), prompt]
      : [...firstSendArgs(profile, runOptions), prompt];
    const env = injectAgentSquadEnv(filterEnv(this.opts.env ?? process.env), input);
    const result = await runJsonlProcess({
      binary: this.opts.binary ?? 'claude',
      args,
      env,
      cwd: input.cwd ?? '.',
      parser: claudeParser,
      idleTimeoutMs: this.idleTimeoutMs,
      blockAfterMs: this.blockAfterMs,
      hardTimeoutMs: input.hardTimeoutMs,
      onOutput: input.onOutput,
      onSessionStarted: input.onSessionStarted,
    });
    return result;
  }
}

function parseClaudeHelp(help: string): ModelDiscoveryResult {
  const modelSection = optionSection(help, '--model');
  const effortSection = optionSection(help, '--effort');
  const aliases = [
    'default',
    ...quotedValues(modelSection),
  ].filter((value, index, values) => values.indexOf(value) === index);
  const fallbackAliases = aliases.length > 1 ? aliases : ['default', 'opus', 'sonnet'];
  const efforts = [...effortSection.matchAll(/\b(low|medium|high|xhigh|max)\b/gi)]
    .map((match) => match[1]?.toLowerCase())
    .filter((value): value is string => value !== undefined)
    .filter((value, index, values) => values.indexOf(value) === index);
  const fallbackEfforts = efforts.length > 0
    ? efforts
    : ['low', 'medium', 'high', 'xhigh', 'max'];
  const models: DiscoveredModel[] = fallbackAliases.map((id) => ({
    id,
    ...(id === 'default' ? { label: 'Default', isDefault: true } : {}),
  }));
  return {
    status: 'partial',
    source: 'claude --help aliases (partial)',
    models,
    defaultModel: 'default',
    reasoningEfforts: fallbackEfforts,
    defaultReasoningEffort: 'max',
  };
}

function optionSection(help: string, option: string): string {
  const lines = help.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes(option));
  if (start < 0) return '';
  const section = [lines[start] ?? ''];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^\s{0,4}--?[a-z]/i.test(line)) break;
    section.push(line);
  }
  return section.join('\n');
}

function quotedValues(value: string): string[] {
  return [...value.matchAll(/['"]([a-z][a-z0-9.-]+)['"]/gi)]
    .map((match) => match[1]?.toLowerCase())
    .filter((entry): entry is string => entry !== undefined);
}
