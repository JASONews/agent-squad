import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { ContextTelemetry } from '@agent-squad/core';
import type { LineParser, LineAccumulator } from './line-parser.js';
import { LineAccumulator as Acc, LineBuffer } from './line-parser.js';

const DEFAULT_IDLE_MS = 15_000;
const DEFAULT_BLOCK_MARKER_RE = /approval|pending|permission|approve/i;
const RAW_TAIL_LINES = 20;

export interface RunJsonlOptions {
  binary: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  parser: LineParser;
  outputLastMessagePath?: string;
  idleTimeoutMs?: number;
  blockAfterMs?: number;
  hardTimeoutMs?: number;
  blockMarkerRe?: RegExp;
  onOutput?: (output: RunOutput) => void;
}

export interface RunOutput {
  stream: 'stdout' | 'stderr';
  text: string;
  rawTail: string;
}

export interface RunJsonlResult {
  status: 'completed' | 'failed' | 'native_cli_blocked' | 'timeout';
  nativeSessionId?: string;
  contextTelemetry?: ContextTelemetry;
  reply?: string;
  rawTail?: string;
}

/** Read the --output-last-message file. Returns '' if missing/empty. */
export function readLastMessageFile(path: string): string {
  try {
    return readFileSync(path, 'utf8') ?? '';
  } catch {
    return '';
  }
}

export function runJsonlProcess(opts: RunJsonlOptions): Promise<RunJsonlResult> {
  const idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_MS;
  const blockMarkerRe = opts.blockMarkerRe ?? DEFAULT_BLOCK_MARKER_RE;
  const acc: LineAccumulator = new Acc();
  const stdoutLines = new LineBuffer();
  const tail: string[] = [];
  const promptTail: string[] = [];

  return new Promise((resolve) => {
    const child = spawn(opts.binary, opts.args, { env: opts.env, cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let resolved = false;
    let lastDataAt = Date.now();

    const finish = (result: RunJsonlResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(idleTimer);
      if (hardTimer) clearTimeout(hardTimer);
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
      const nativeSessionId = result.nativeSessionId ?? acc.sessionId ?? undefined;
      const contextTelemetry = result.contextTelemetry ?? acc.contextTelemetry;
      resolve({
        ...result,
        ...(nativeSessionId ? { nativeSessionId } : {}),
        ...(contextTelemetry ? { contextTelemetry } : {}),
      });
    };
    const onBlocked = () => finish({ status: 'native_cli_blocked', rawTail: tail.slice(-RAW_TAIL_LINES).join('\n') });
    const parseStdoutLine = (line: string) => {
      if (line.trim().length === 0) return;
      tail.push(line);
      if (!isJsonLine(line)) promptTail.push(line);
      opts.onOutput?.({ stream: 'stdout', text: line, rawTail: tail.slice(-RAW_TAIL_LINES).join('\n') });
      const ev = opts.parser.parse(line);
      if (ev) acc.add(ev);
    };

    let idleTimer: NodeJS.Timeout = setTimeout(function check() {
      const idleFor = Date.now() - lastDataAt;
      const tailStr = promptTail.slice(-RAW_TAIL_LINES).join('\n');
      const hasMarker = blockMarkerRe.test(tailStr);
      if (hasMarker && idleFor > idleTimeoutMs) {
        onBlocked();
        return;
      }
      idleTimer = setTimeout(check, 500);
    }, 500);
    const hardTimer: NodeJS.Timeout | undefined = opts.hardTimeoutMs
      ? setTimeout(() => finish({ status: 'timeout', nativeSessionId: acc.sessionId ?? undefined, rawTail: tail.slice(-RAW_TAIL_LINES).join('\n') }), opts.hardTimeoutMs)
      : undefined;

    child.stdout.on('data', (d: Buffer) => {
      lastDataAt = Date.now();
      stdoutLines.push(d.toString(), parseStdoutLine);
    });
    child.stderr.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n')) {
        if (line.trim().length > 0) {
          const stderrLine = `[stderr] ${line}`;
          tail.push(stderrLine);
          promptTail.push(stderrLine);
          opts.onOutput?.({ stream: 'stderr', text: line, rawTail: tail.slice(-RAW_TAIL_LINES).join('\n') });
        }
      }
    });
    child.on('error', () => finish({ status: 'failed', rawTail: tail.slice(-RAW_TAIL_LINES).join('\n') }));
    child.on('close', (code) => {
      if (resolved) return;
      stdoutLines.flush(parseStdoutLine);
      const rawTail = tail.slice(-RAW_TAIL_LINES).join('\n');
      if (code !== 0) { finish({ status: 'failed', rawTail }); return; }
      const reply = acc.replyText || (opts.outputLastMessagePath ? readLastMessageFile(opts.outputLastMessagePath) : '');
      finish({ status: 'completed', nativeSessionId: acc.sessionId ?? undefined, reply: reply || undefined, rawTail });
    });
  });
}

function isJsonLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}
