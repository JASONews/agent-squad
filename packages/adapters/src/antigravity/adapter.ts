import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { resolveProfile, profileFlags } from './profiles.js';
import { getConversationId } from './conversation.js';
import { filterEnv } from '../shared/env.js';
import {
  ModelDiscoveryCache,
  parseModelLines,
  runDiscoveryCommand,
} from '../shared/model-discovery.js';
import { runPtyProcess } from '../shared/pty-runner.js';
import { injectInstruction, injectAgentSquadEnv } from '../shared/subagent-context.js';
import type {
  AdapterCapabilities,
  CliAdapter,
  DetectResult,
  ModelDiscoveryResult,
  ModelSelectionInfo,
  SendInput,
  SendResult,
  SpawnInput,
  SubagentHandle,
} from '@agent-squad/core';

// agy's `--print` mode does NOT stream — it emits the full reply in one burst after the model
// finishes thinking. Real agy first-response latency is ~30-40s (verified on agy 1.0.14), so plain
// idle must not be treated as blocked. Only marker-based permission waits use IDLE_TIMEOUT_MS;
// long silent work is bounded by the service-provided hard timeout.
const IDLE_TIMEOUT_MS = 15_000;
const BLOCK_AFTER_MS = 90_000;
const BLOCK_MARKER_RE = /approval|pending|permission|approve/i;
const RAW_TAIL_LINES = 20;

export interface AntigravityAdapterOpts {
  env?: NodeJS.ProcessEnv;
  binary?: string;
  homeDir?: string;
  usePty?: boolean;  // default true; false for tests
  modelDiscoveryTimeoutMs?: number;
}

export class AntigravityAdapter implements CliAdapter {
  readonly cliType = 'antigravity' as const;
  private readonly opts: AntigravityAdapterOpts;
  private readonly discoveryCache: ModelDiscoveryCache;
  private detectCache: DetectResult | null = null;
  private idleTimeoutMs = IDLE_TIMEOUT_MS;
  private blockAfterMs = BLOCK_AFTER_MS;
  readonly roles = ['ui_implementer', 'ui_reviewer', 'product_designer', 'architect'];
  readonly strengths = 'UI/product design, visual layout, and front-end implementation. Strong at understanding design intent and producing polished interfaces.';
  readonly weaknesses = 'Not suited for code review, bug finding, or backend logic. Higher latency (~40s per response). Plain-text output only (no structured JSON).';
  readonly modelSelection: ModelSelectionInfo = {
    model: {
      parameter: 'model',
      source: 'agy --print --model <model>; run agy models for available full model names.',
      examples: ['gemini-3.5-flash-high', 'claude-opus-4-6-thinking'],
    },
    reasoningEffort: {
      parameter: 'model',
      source: 'Antigravity has no separate reasoning_effort flag; thinking level is encoded in the full model name from agy models.',
    },
  };

  constructor(opts: AntigravityAdapterOpts = {}) {
    this.opts = opts;
    this.discoveryCache = new ModelDiscoveryCache('agy models', async () => ({
      status: 'available',
      source: 'agy models',
      models: parseModelLines(await runDiscoveryCommand({
        binary: this.opts.binary ?? 'agy',
        args: ['models'],
        env: this.opts.env ?? process.env,
        timeoutMs: this.opts.modelDiscoveryTimeoutMs,
      })),
    }));
  }

  setBlockTimingsForTest(idle: number, block: number): void {
    this.idleTimeoutMs = idle;
    this.blockAfterMs = block;
  }

  async detect(): Promise<DetectResult> {
    if (this.detectCache) return this.detectCache;
    const bin = this.opts.binary ?? 'agy';
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
    return { mcp: false, plugin: false, headless: true, resume: true, persistentServer: false, autoApprove: true, structuredOutput: false };
  }

  discoverModels(): Promise<ModelDiscoveryResult> {
    return this.discoveryCache.get();
  }

  async spawnSubagent(input: SpawnInput): Promise<SubagentHandle> {
    resolveProfile(input.permissionProfile);  // validate (throws permission_profile_unknown)
    return { subagentId: input.subagentId, nativeSessionId: undefined, status: 'ready' };
  }

  async send(input: SendInput): Promise<SendResult> {
    const profile = resolveProfile(input.permissionProfile);
    const isResume = !!input.nativeSessionId;
    const bin = this.opts.binary ?? 'agy';
    const cwd = input.cwd ?? '.';
    const message = isResume ? input.message : injectInstruction(input.message);
    const modelArgs = input.model ? ['--model', input.model] : [];
    const args = isResume
      ? [...profileFlags(profile), ...modelArgs, '--conversation', input.nativeSessionId as string, '--print', input.message]
      : [...profileFlags(profile), ...modelArgs, '--print', message];
    const env = injectAgentSquadEnv(filterEnv(this.opts.env ?? process.env), input);
    const home = this.opts.homeDir ?? env.HOME ?? homedir();

    if (this.opts.usePty === false) {
      // Non-PTY mode (for tests/stubs) — use the old runAgy
      const result = await this.runAgy(bin, args, env, cwd, input.hardTimeoutMs, input.onOutput);
      if (result.status !== 'completed') return result;
      let nativeSessionId = input.nativeSessionId;
      if (!isResume) {
        const captured = getConversationId(home, cwd);
        if (captured) nativeSessionId = captured;
      }
      return { ...result, nativeSessionId };
    }

    // PTY mode — auto-approves permission prompts
    const result = await runPtyProcess({
      binary: bin, args, env, cwd,
      idleTimeoutMs: this.idleTimeoutMs, blockAfterMs: this.blockAfterMs,
      hardTimeoutMs: input.hardTimeoutMs,
      homeDir: home, isAntigravity: true,
      onOutput: input.onOutput,
    });
    return result;
  }

  private runAgy(bin: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, hardTimeoutMs?: number, onOutput?: SendInput['onOutput']): Promise<SendResult> {
    const self = this;
    const stdoutChunks: string[] = [];
    const tail: string[] = [];

    return new Promise((resolve) => {
      const child = spawn(bin, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let resolved = false;
      let lastDataAt = Date.now();

      const finish = (result: SendResult) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(idleTimer);
        if (hardTimer) clearTimeout(hardTimer);
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
        resolve(result);
      };
      const onBlocked = () => finish({ status: 'native_cli_blocked', rawTail: tail.slice(-RAW_TAIL_LINES).join('\n') });

      let idleTimer: NodeJS.Timeout = setTimeout(function check() {
        const idleFor = Date.now() - lastDataAt;
        const tailStr = tail.slice(-RAW_TAIL_LINES).join('\n');
        const hasMarker = BLOCK_MARKER_RE.test(tailStr);
        if (hasMarker && idleFor > self.idleTimeoutMs) {
          onBlocked();
          return;
        }
        idleTimer = setTimeout(check, 500);
      }, 500);
      const hardTimer: NodeJS.Timeout | undefined = hardTimeoutMs
        ? setTimeout(() => finish({ status: 'timeout', rawTail: tail.slice(-RAW_TAIL_LINES).join('\n') }), hardTimeoutMs)
        : undefined;

      child.stdout.on('data', (d: Buffer) => {
        lastDataAt = Date.now();
        const chunk = d.toString();
        stdoutChunks.push(chunk);
        for (const line of chunk.split('\n')) {
          if (line.trim().length > 0) {
            tail.push(line);
            onOutput?.({ stream: 'stdout', text: line, rawTail: tail.slice(-RAW_TAIL_LINES).join('\n') });
          }
        }
      });
      child.stderr.on('data', (d: Buffer) => {
        for (const line of d.toString().split('\n')) {
          if (line.trim().length > 0) {
            tail.push(`[stderr] ${line}`);
            onOutput?.({ stream: 'stderr', text: line, rawTail: tail.slice(-RAW_TAIL_LINES).join('\n') });
          }
        }
      });
      child.on('error', () => finish({ status: 'failed', rawTail: tail.slice(-RAW_TAIL_LINES).join('\n') }));
      child.on('close', (code) => {
        if (resolved) return;
        const rawTail = tail.slice(-RAW_TAIL_LINES).join('\n');
        if (code !== 0) { finish({ status: 'failed', rawTail }); return; }
        const reply = stdoutChunks.join('').trim();
        finish({ status: 'completed', reply: reply || undefined, rawTail });
      });
    });
  }
}
