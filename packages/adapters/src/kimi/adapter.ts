import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type {
  AdapterCapabilities,
  CliAdapter,
  DetectResult,
  ModelSelectionInfo,
  SendInput,
  SendResult,
  SpawnInput,
  SubagentHandle,
} from '@agent-squad/core';
import {
  PROTOCOL_VERSION,
  client,
  methods,
  ndJsonStream,
  type ClientContext,
  type RequestPermissionRequest,
  type SessionConfigOption,
  type SessionUpdate,
} from '@agentclientprotocol/sdk';
import { filterEnv } from '../shared/env.js';
import { injectAgentSquadEnv, injectInstruction } from '../shared/subagent-context.js';
import { resolveProfile, selectPermissionResponse } from './profiles.js';

const RAW_TAIL_LINES = 20;
const CANCEL_GRACE_MS = 250;
const PROCESS_EXIT_GRACE_MS = 250;
const DETECT_TIMEOUT_MS = 2_000;
const TIMEOUT = Symbol('kimi-timeout');

export interface KimiAdapterOpts {
  env?: NodeJS.ProcessEnv;
  binary?: string;
  detectTimeoutMs?: number;
}

interface ProtocolResult {
  nativeSessionId: string;
  reply?: string;
}

export class KimiAdapter implements CliAdapter {
  readonly cliType = 'kimi' as const;
  private readonly opts: KimiAdapterOpts;
  private detectCache: DetectResult | null = null;
  readonly roles = ['reviewer', 'bug_finder', 'fixer', 'implementer', 'tester'];
  readonly strengths = 'Kimi Code provides repository-aware coding, review, implementation, and testing through its native ACP server.';
  readonly weaknesses = 'Requires a logged-in Kimi Code installation with ACP support. Model and thinking choices depend on options advertised by the installed version.';
  readonly modelSelection: ModelSelectionInfo = {
    model: {
      parameter: 'model',
      source: 'Kimi ACP session config option with category model.',
    },
    reasoningEffort: {
      parameter: 'reasoning_effort',
      source: 'Kimi ACP session config option with category thought_level (or thinking/reasoning option id).',
    },
  };

  constructor(opts: KimiAdapterOpts = {}) {
    this.opts = opts;
  }

  async detect(): Promise<DetectResult> {
    if (this.detectCache) return this.detectCache;
    const binary = this.opts.binary ?? 'kimi';
    return new Promise((resolveDetect) => {
      const child = spawn(binary, ['--version'], {
        env: this.opts.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      let settled = false;
      const finish = (result: DetectResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.detectCache = result;
        resolveDetect(result);
      };
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish({ available: false });
      }, this.opts.detectTimeoutMs ?? DETECT_TIMEOUT_MS);
      child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { output += data.toString(); });
      child.on('error', () => finish({ available: false }));
      child.on('close', (code) => {
        finish(code === 0
          ? { available: true, version: output.trim() || undefined, path: binary }
          : { available: false });
      });
    });
  }

  capabilities(): AdapterCapabilities {
    return {
      mcp: true,
      plugin: false,
      headless: true,
      resume: true,
      persistentServer: false,
      autoApprove: true,
      structuredOutput: true,
    };
  }

  async spawnSubagent(input: SpawnInput): Promise<SubagentHandle> {
    resolveProfile(input.permissionProfile);
    return { subagentId: input.subagentId, nativeSessionId: undefined, status: 'ready' };
  }

  async send(input: SendInput): Promise<SendResult> {
    const profile = resolveProfile(input.permissionProfile);
    const cwd = resolve(input.cwd ?? '.');
    const env = injectAgentSquadEnv(filterEnv(this.opts.env ?? process.env), input);
    const child = spawn(this.opts.binary ?? 'kimi', ['acp'], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const tail: string[] = [];
    let nativeSessionId = input.nativeSessionId;
    let activeContext: ClientContext | undefined;
    let timedOut = false;
    let choiceRequested = false;
    let timeoutTimer: NodeJS.Timeout | undefined;

    const emit = (stream: 'stdout' | 'stderr', text: string): void => {
      const display = stream === 'stderr' ? `[stderr] ${text}` : text;
      for (const line of display.split(/\r?\n/)) {
        if (line.length > 0) tail.push(line);
      }
      if (tail.length > RAW_TAIL_LINES * 2) tail.splice(0, tail.length - RAW_TAIL_LINES);
      input.onOutput?.({ stream, text, rawTail: rawTail(tail) });
    };

    child.stderr.on('data', (data: Buffer) => {
      for (const line of data.toString().split(/\r?\n/)) {
        if (line.trim()) emit('stderr', line);
      }
    });

    const app = client({ name: 'agent-squad' })
      .onRequest(methods.client.session.requestPermission, (context) => {
        const { params } = context;
        const choice = businessChoiceFromPermission(params);
        if (choice) {
          choiceRequested = true;
          const block = renderChoiceBlock(choice);
          replyChunks.push(`\n${block}\n`);
          emit('stdout', `[choice] ${choice.question}`);
          setImmediate(() => {
            void context.agent.notify(methods.agent.session.cancel, {
              sessionId: params.sessionId,
            }).catch(() => undefined);
          });
          return { outcome: { outcome: 'cancelled' } };
        }
        const response = selectPermissionResponse(profile, params);
        const decision = response.outcome.outcome === 'selected'
          ? response.outcome.optionId
          : 'cancelled';
        emit('stdout', `[permission] ${params.toolCall.title ?? params.toolCall.kind ?? 'tool'} -> ${decision}`);
        return response;
      })
      .onNotification(methods.client.session.update, ({ params }) => {
        if (nativeSessionId && params.sessionId !== nativeSessionId) return;
        const rendered = renderUpdate(params.update);
        if (!rendered) return;
        if (rendered.reply) replyChunks.push(rendered.reply);
        emit('stdout', rendered.output);
      });

    const replyChunks: string[] = [];
    const protocolPromise = app.connectWith(
      ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
      async (context): Promise<ProtocolResult> => {
        activeContext = context;
        await context.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { session: { configOptions: {} } },
          clientInfo: { name: 'agent-squad', version: '0.1.0' },
        });

        let configOptions: SessionConfigOption[] | null | undefined;
        if (input.nativeSessionId) {
          const resumed = await context.request(methods.agent.session.resume, {
            sessionId: input.nativeSessionId,
            cwd,
            mcpServers: [],
          });
          nativeSessionId = input.nativeSessionId;
          configOptions = resumed.configOptions;
        } else {
          const created = await context.request(methods.agent.session.new, { cwd, mcpServers: [] });
          nativeSessionId = created.sessionId;
          configOptions = created.configOptions;
        }

        configOptions = await applyConfigSelection(
          context,
          nativeSessionId,
          configOptions,
          'model',
          input.model,
        );
        await applyConfigSelection(
          context,
          nativeSessionId,
          configOptions,
          'thinking',
          input.reasoningEffort,
        );

        const prompt = input.nativeSessionId ? input.message : injectInstruction(input.message);
        const promptResult = await context.request(methods.agent.session.prompt, {
          sessionId: nativeSessionId,
          prompt: [{ type: 'text', text: prompt }],
        });
        if (!choiceRequested
          && (promptResult.stopReason === 'cancelled' || promptResult.stopReason === 'refusal')) {
          throw new Error(`Kimi ACP prompt stopped with ${promptResult.stopReason}`);
        }
        return {
          nativeSessionId,
          reply: replyChunks.join('') || undefined,
        };
      },
    );

    const guardedProtocol = protocolPromise.then(
      (result) => ({ kind: 'result' as const, result }),
      (error: unknown) => ({ kind: 'error' as const, error }),
    );
    const spawnFailure = new Promise<{ kind: 'error'; error: unknown }>((resolveFailure) => {
      child.once('error', (error) => resolveFailure({ kind: 'error', error }));
    });
    const timeout = new Promise<typeof TIMEOUT>((resolveTimeout) => {
      if (!input.hardTimeoutMs) return;
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        emit('stderr', `Kimi ACP hard timeout after ${input.hardTimeoutMs}ms; cancelling session.`);
        void (async () => {
          if (activeContext && nativeSessionId) {
            await activeContext.notify(methods.agent.session.cancel, { sessionId: nativeSessionId }).catch(() => undefined);
          }
          await Promise.race([guardedProtocol, delay(CANCEL_GRACE_MS)]);
          resolveTimeout(TIMEOUT);
        })();
      }, input.hardTimeoutMs);
    });

    try {
      const outcome = await Promise.race([guardedProtocol, spawnFailure, timeout]);
      if (timedOut || outcome === TIMEOUT) {
        return { status: 'timeout', nativeSessionId, rawTail: rawTail(tail) };
      }
      if (outcome.kind === 'error') {
        emit('stderr', errorMessage(outcome.error));
        return { status: 'failed', nativeSessionId, rawTail: rawTail(tail) };
      }
      return {
        status: 'completed',
        nativeSessionId: outcome.result.nativeSessionId,
        reply: outcome.result.reply,
        rawTail: rawTail(tail),
      };
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      await terminateChild(child);
      await Promise.race([guardedProtocol, delay(PROCESS_EXIT_GRACE_MS)]);
    }
  }
}

async function applyConfigSelection(
  context: ClientContext,
  sessionId: string,
  options: SessionConfigOption[] | null | undefined,
  kind: 'model' | 'thinking',
  requestedValue?: string,
): Promise<SessionConfigOption[] | null | undefined> {
  if (!requestedValue || requestedValue === 'default') return options;
  const option = findConfigOption(options ?? [], kind);
  if (!option) throw new Error(`Kimi ACP did not advertise a ${kind} session config option`);
  if (option.type !== 'select') throw new Error(`Kimi ACP ${kind} session config option is not selectable`);
  const value = resolveConfigValue(option, requestedValue, kind);
  const response = await context.request(methods.agent.session.setConfigOption, {
    sessionId,
    configId: option.id,
    value,
  });
  return response.configOptions;
}

function findConfigOption(options: SessionConfigOption[], kind: 'model' | 'thinking'): SessionConfigOption | undefined {
  const category = kind === 'model' ? 'model' : 'thought_level';
  const fallback = kind === 'model' ? /model/i : /think|thought|reason/i;
  return options.find((option) => option.category === category)
    ?? options.find((option) => fallback.test(`${option.id} ${option.name}`));
}

function resolveConfigValue(
  option: Extract<SessionConfigOption, { type: 'select' }>,
  requested: string,
  kind: 'model' | 'thinking',
): string {
  const candidates = option.options.flatMap((entry) => 'options' in entry ? entry.options : [entry]);
  const exact = candidates.find((candidate) => candidate.value === requested);
  if (exact) return exact.value;
  const normalized = requested.toLocaleLowerCase();
  const named = candidates.find((candidate) => candidate.name.toLocaleLowerCase() === normalized);
  if (named) return named.value;
  if (kind === 'thinking') {
    const enabled = candidates.find((candidate) => candidate.value === 'on');
    const disabled = candidates.find((candidate) => candidate.value === 'off');
    if (enabled && disabled) {
      return ['off', 'none', 'false', 'disabled'].includes(normalized) ? disabled.value : enabled.value;
    }
  }
  return requested;
}

interface BusinessChoice {
  question: string;
  options: Array<{ id: string; label: string }>;
}

function businessChoiceFromPermission(request: RequestPermissionRequest): BusinessChoice | null {
  const questionOptions = request.options.filter((option) => /^q\d+_(?:opt_\d+|skip)$/.test(option.optionId));
  const planOptions = request.options.filter((option) => /^plan_(?:opt_\d+|approve|revise|reject_and_exit)$/.test(option.optionId));
  const isQuestion = request.toolCall.title === 'AskUserQuestion' && questionOptions.length > 0;
  const isPlanReview = planOptions.length > 0;
  if (!isQuestion && !isPlanReview) return null;

  const sourceOptions = isQuestion ? questionOptions : planOptions;
  const title = request.toolCall.title ?? 'Kimi Code decision';
  const text = request.toolCall.content
    ?.flatMap((entry) => (
      entry.type === 'content' && entry.content.type === 'text' ? [entry.content.text] : []
    ))
    .filter(Boolean)
    .join('\n\n');
  const question = isQuestion
    ? text || title
    : [title, text].filter(Boolean).join('\n\n');
  return {
    question,
    options: sourceOptions.map((option) => ({ id: option.optionId, label: option.name })),
  };
}

function renderChoiceBlock(choice: BusinessChoice): string {
  return `%%AGENT_SQUAD_CHOICE%%\n${JSON.stringify(choice)}\n%%END_AGENT_SQUAD_CHOICE%%`;
}

function renderUpdate(update: SessionUpdate): { output: string; reply?: string } | undefined {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return update.content.type === 'text'
        ? { output: update.content.text, reply: update.content.text }
        : { output: `[message] ${update.content.type}` };
    case 'agent_thought_chunk':
      return update.content.type === 'text'
        ? { output: `[thought] ${update.content.text}` }
        : { output: `[thought] ${update.content.type}` };
    case 'tool_call':
      return { output: `[tool] ${update.kind ?? 'other'}: ${update.title}${update.status ? ` (${update.status})` : ''}` };
    case 'tool_call_update':
      return { output: `[tool] ${update.kind ?? 'other'}: ${update.title ?? update.toolCallId}${update.status ? ` (${update.status})` : ''}` };
    case 'plan':
    case 'plan_update':
    case 'plan_removed':
      return { output: `[${update.sessionUpdate}] ${truncateJson(update)}` };
    case 'user_message_chunk':
      return undefined;
    default:
      return { output: `[${update.sessionUpdate}] ${truncateJson(update)}` };
  }
}

function truncateJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized.length > 1_000 ? `${serialized.slice(0, 997)}...` : serialized;
}

function rawTail(lines: string[]): string {
  return lines.slice(-RAW_TAIL_LINES).join('\n');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.platform === 'win32') {
    await terminateWindowsTree(child);
    return;
  }
  if (child.pid === undefined || !signalProcessGroup(child.pid, 'SIGTERM')) return;
  const startedAt = Date.now();
  await Promise.race([waitForExit(child), delay(PROCESS_EXIT_GRACE_MS)]);
  if (processGroupExists(child.pid)) {
    await delay(Math.max(0, PROCESS_EXIT_GRACE_MS - (Date.now() - startedAt)));
    signalProcessGroup(child.pid, 'SIGKILL');
  }
  await Promise.race([waitForExit(child), delay(PROCESS_EXIT_GRACE_MS)]);
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateWindowsTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveTaskkill) => {
    const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    taskkill.once('error', () => {
      child.kill('SIGKILL');
      resolveTaskkill();
    });
    taskkill.once('close', () => resolveTaskkill());
  });
  await Promise.race([waitForExit(child), delay(PROCESS_EXIT_GRACE_MS)]);
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => child.once('close', () => resolveExit()));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
