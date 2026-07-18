import { spawn } from 'node:child_process';
import type { AdapterCapabilities, CliAdapter, DetectResult, ModelSelectionInfo, SendInput, SendResult, SpawnInput, SubagentHandle } from '@agent-squad/core';
import { claudeParser } from './jsonl.js';
import { firstSendArgs, resolveProfile, resumeArgs } from './profiles.js';
import { filterEnv } from '../shared/env.js';
import { runJsonlProcess } from '../shared/jsonl-runner.js';
import { injectAgentSquadEnv, injectClaudeContinuation, injectClaudeInstruction } from '../shared/subagent-context.js';

export interface ClaudeAdapterOpts {
  env?: NodeJS.ProcessEnv;
  binary?: string;
}

export class ClaudeAdapter implements CliAdapter {
  readonly cliType = 'claude' as const;
  private readonly opts: ClaudeAdapterOpts;
  private detectCache: DetectResult | null = null;
  private idleTimeoutMs = 15_000;
  private blockAfterMs = 30_000;
  readonly roles = ['reviewer', 'bug_finder', 'fixer', 'implementer', 'tester'];
  readonly strengths = 'Strong general coding agent with good repository navigation, implementation, testing, and review. Best results when prompts are in English.';
  readonly weaknesses = 'Use English-only prompts for best performance. UI/product design is usually better assigned to antigravity.';
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

  async spawnSubagent(input: SpawnInput): Promise<SubagentHandle> {
    resolveProfile(input.permissionProfile);
    return { subagentId: input.subagentId, nativeSessionId: undefined, status: 'ready' };
  }

  async send(input: SendInput): Promise<SendResult> {
    const profile = resolveProfile(input.permissionProfile);
    const isResume = !!input.nativeSessionId;
    const runOptions = { model: input.model, reasoningEffort: input.reasoningEffort };
    const prompt = isResume ? injectClaudeContinuation(input.message) : injectClaudeInstruction(input.message);
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
    });
    return result;
  }
}
