import * as pty from 'node-pty';
import { accessSync, chmodSync, constants, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { LineParser, LineAccumulator } from './line-parser.js';
import { LineAccumulator as Acc, LineBuffer } from './line-parser.js';
import { readLastMessageFile } from './jsonl-runner.js';
import { getConversationId } from '../antigravity/conversation.js';
import { homedir } from 'node:os';

const DEFAULT_IDLE_MS = 15_000;
const RAW_TAIL_LINES = 20;
const PROMPT_PATTERNS: RegExp[] = [
  /\b(approve|allow)\b.*\??/i,
  /\byes\b.*\/.*\bno\b/i,
  /\bpermission\b.*\??/i,
  /\bproceed\b.*\??/i,
  /\[y\/n\]/i,
  /\(yes\/no\)/i,
  /\(y\/n\)/i,
];
const APPROVAL_KEY = 'y\r';
const require = createRequire(import.meta.url);

export interface PtyRunOptions {
  binary: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  parser?: LineParser;            // for JSONL CLIs (codex/opencode); omit for plain-text (antigravity)
  outputLastMessagePath?: string; // codex --output-last-message fallback
  idleTimeoutMs?: number;
  blockAfterMs?: number;
  hardTimeoutMs?: number;
  homeDir?: string;               // for antigravity conversation-id capture
  isAntigravity?: boolean;
  onOutput?: (output: PtyOutput) => void;
}

export interface PtyOutput {
  stream: 'stdout' | 'stderr';
  text: string;
  rawTail: string;
}

export interface PtyRunResult {
  status: 'completed' | 'failed' | 'native_cli_blocked' | 'timeout';
  nativeSessionId?: string;
  reply?: string;
  rawTail?: string;
}

type LoadNativeModule = (name: string) => { dir: string };

export function runPtyProcess(opts: PtyRunOptions): Promise<PtyRunResult> {
  const idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_MS;
  const cwd = opts.cwd ?? '.';
  const stdoutBuf: string[] = [];
  const tail: string[] = [];
  const promptTail: string[] = [];
  const acc: LineAccumulator | undefined = opts.parser ? new Acc() : undefined;
  const parserLines: LineBuffer | undefined = opts.parser ? new LineBuffer() : undefined;
  const promptDetectionEnabled = !opts.parser;
  let lastDataAt = Date.now();
  let approvedCount = 0;
  const helperWarning = ensureNodePtyHelperExecutable();

  return new Promise((resolve) => {
    let term: pty.IPty;
    try {
      term = pty.spawn(opts.binary, opts.args, {
        name: 'xterm-256color',
        cols: 200,
        rows: 50,
        cwd,
        env: opts.env as { [key: string]: string },
      });
    } catch (e) {
      resolve({ status: 'failed', rawTail: formatPtySpawnError(opts.binary, e, helperWarning) });
      return;
    }

    let resolved = false;
    let idleTimer: NodeJS.Timeout;

    const finish = (result: PtyRunResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(idleTimer);
      if (hardTimer) clearTimeout(hardTimer);
      try { term.kill(); } catch { /* already dead */ }
      resolve(result);
    };

    const checkIdle = () => {
      const idleFor = Date.now() - lastDataAt;
      const tailStr = promptTail.slice(-RAW_TAIL_LINES).join('\n');
      const hasMarker = promptDetectionEnabled && PROMPT_PATTERNS.some((pattern) => pattern.test(tailStr));
      if (hasMarker && idleFor > idleTimeoutMs) {
        finish({ status: 'native_cli_blocked', rawTail: tail.slice(-RAW_TAIL_LINES).join('\n') });
        return;
      }
      idleTimer = setTimeout(checkIdle, 1000);
    };
    idleTimer = setTimeout(checkIdle, 1000);
    const hardTimer: NodeJS.Timeout | undefined = opts.hardTimeoutMs
      ? setTimeout(() => finish({ status: 'timeout', nativeSessionId: acc?.sessionId ?? undefined, rawTail: tail.slice(-RAW_TAIL_LINES).join('\n') }), opts.hardTimeoutMs)
      : undefined;

    const parseStdoutLine = (line: string) => {
      if (!opts.parser) return;
      const ev = opts.parser.parse(line);
      if (ev) acc?.add(ev);
    };

    term.onData((data: string) => {
      lastDataAt = Date.now();
      stdoutBuf.push(data);
      const lines = data.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          tail.push(trimmed);
          if (promptDetectionEnabled && !isJsonLine(trimmed)) promptTail.push(trimmed);
          opts.onOutput?.({ stream: 'stdout', text: trimmed, rawTail: tail.slice(-RAW_TAIL_LINES).join('\n') });
        }
      }
      parserLines?.push(data, parseStdoutLine);

      // Check for permission prompts and auto-approve
      if (promptDetectionEnabled) {
        const recentOutput = promptTail.slice(-5).join(' ');
        for (const pattern of PROMPT_PATTERNS) {
          if (pattern.test(recentOutput)) {
            term.write(APPROVAL_KEY);
            approvedCount++;
            break;
          }
        }
      }
    });

    term.onExit(({ exitCode }) => {
      if (resolved) return;
      clearTimeout(idleTimer);
      parserLines?.flush(parseStdoutLine);
      const rawTail = tail.slice(-RAW_TAIL_LINES).join('\n');
      const fullOutput = stdoutBuf.join('');

      if (exitCode !== 0) {
        finish({ status: 'failed', rawTail });
        return;
      }

      // Extract reply based on CLI type
      let reply: string;
      let nativeSessionId: string | undefined;

      if (opts.parser) {
        // JSONL CLI (codex/opencode) — use accumulator
        reply = acc?.replyText || '';
        nativeSessionId = acc?.sessionId ?? undefined;
        if (!reply && opts.outputLastMessagePath) {
          reply = readLastMessageFile(opts.outputLastMessagePath);
        }
      } else {
        // Plain-text CLI (antigravity) — full stdout
        reply = stripAnsi(fullOutput).trim();
        if (opts.isAntigravity) {
          const home = opts.homeDir ?? homedir();
          const captured = getConversationId(home, cwd);
          if (captured) nativeSessionId = captured;
        }
      }

      finish({ status: 'completed', reply: reply || undefined, nativeSessionId, rawTail });
    });
  });
}

function ensureNodePtyHelperExecutable(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  const helperPath = resolveNodePtyHelperPath();
  if (!helperPath) return undefined;
  try {
    accessSync(helperPath, constants.X_OK);
    return undefined;
  } catch {
    // Continue below: npm/prebuild installs can leave node-pty's macOS helper without +x.
  }
  try {
    const mode = statSync(helperPath).mode;
    chmodSync(helperPath, mode | 0o111);
    accessSync(helperPath, constants.X_OK);
    return undefined;
  } catch (e) {
    return `node-pty spawn-helper is not executable at ${helperPath}: ${errorMessage(e)}`;
  }
}

function resolveNodePtyHelperPath(): string | undefined {
  try {
    const nodePtyRoot = dirname(require.resolve('node-pty/package.json'));
    const { loadNativeModule } = require('node-pty/lib/utils.js') as { loadNativeModule: LoadNativeModule };
    const native = loadNativeModule('pty');
    return resolve(nodePtyRoot, 'lib', native.dir, 'spawn-helper');
  } catch {
    return undefined;
  }
}

function formatPtySpawnError(binary: string, e: unknown, helperWarning?: string): string {
  const details = [`failed to spawn PTY command "${binary}": ${errorMessage(e)}`];
  if (helperWarning) details.push(helperWarning);
  if (process.platform === 'darwin' && errorMessage(e).includes('posix_spawnp failed')) {
    details.push('On macOS this usually means node-pty could not execute its spawn-helper binary.');
  }
  return details.join('\n');
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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

/** Strip ANSI escape codes from a string. */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}
