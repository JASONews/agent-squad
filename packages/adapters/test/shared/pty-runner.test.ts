import { describe, expect, it, vi } from 'vitest';
import type { LineParser } from '../../src/shared/line-parser.js';

const ptyMock = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('node-pty', () => ({
  spawn: ptyMock.spawn,
}));

const { runPtyProcess } = await import('../../src/shared/pty-runner.js');

describe('runPtyProcess', () => {
  it('returns a failed result when native PTY spawn throws', async () => {
    ptyMock.spawn.mockImplementation(() => {
      throw new Error('posix_spawnp failed.');
    });
    const result = await runPtyProcess({
      binary: 'codex',
      args: ['--version'],
      env: process.env,
      cwd: process.cwd(),
    });

    expect(result.status).toBe('failed');
    expect(result.rawTail).toContain('failed to spawn PTY command "codex": posix_spawnp failed.');
  });

  it('silent long-running PTY output waits for hard timeout instead of native_cli_blocked', async () => {
    let onData: ((data: string) => void) | undefined;
    const outputs: { stream: string; text: string; rawTail: string }[] = [];
    ptyMock.spawn.mockImplementation(() => {
      queueMicrotask(() => {
        onData?.('{"type":"thread.started","thread_id":"pty-thread"}\n');
        onData?.('{"type":"turn.completed","usage":{"input_tokens":1234,"output_tokens":42}}\n');
      });
      return {
        onData: (cb: (data: string) => void) => { onData = cb; },
        onExit: () => {},
        kill: vi.fn(),
        write: vi.fn(),
      };
    });
    const parser: LineParser = {
      parse(line) {
        const obj = JSON.parse(line) as {
          type?: string;
          thread_id?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        if (obj.type === 'thread.started' && obj.thread_id) return { type: 'session_id', sessionId: obj.thread_id };
        if (obj.type === 'turn.completed' && obj.usage) {
          return {
            type: 'context_usage',
            usage: { inputTokens: obj.usage.input_tokens, outputTokens: obj.usage.output_tokens },
          };
        }
        return { type: 'unknown', raw: obj };
      },
    };

    const result = await runPtyProcess({
      binary: 'codex',
      args: ['exec'],
      env: process.env,
      cwd: process.cwd(),
      parser,
      idleTimeoutMs: 25,
      blockAfterMs: 50,
      hardTimeoutMs: 100,
      onOutput: (output) => { outputs.push(output); },
    });

    expect(result.status).toBe('timeout');
    expect(result.nativeSessionId).toBe('pty-thread');
    expect(result.contextTelemetry).toEqual({
      usage: { inputTokens: 1234, outputTokens: 42 },
    });
    expect(outputs).toContainEqual({
      stream: 'stdout',
      text: '{"type":"thread.started","thread_id":"pty-thread"}',
      rawTail: '{"type":"thread.started","thread_id":"pty-thread"}',
    });
  });

  it('does not treat JSON event text containing permission words as a PTY prompt', async () => {
    let onData: ((data: string) => void) | undefined;
    const write = vi.fn();
    ptyMock.spawn.mockImplementation(() => {
      queueMicrotask(() => {
        onData?.('{"type":"thread.started","thread_id":"pty-permission-text"}\n');
        onData?.('{"type":"item.completed","item":{"type":"reasoning","text":"For permission prompts, proceed with default policy."}}\n');
      });
      return {
        onData: (cb: (data: string) => void) => { onData = cb; },
        onExit: () => {},
        kill: vi.fn(),
        write,
      };
    });
    const parser: LineParser = {
      parse(line) {
        const obj = JSON.parse(line) as { type?: string; thread_id?: string };
        if (obj.type === 'thread.started' && obj.thread_id) return { type: 'session_id', sessionId: obj.thread_id };
        return { type: 'unknown', raw: obj };
      },
    };

    const result = await runPtyProcess({
      binary: 'codex',
      args: ['exec'],
      env: process.env,
      cwd: process.cwd(),
      parser,
      idleTimeoutMs: 25,
      hardTimeoutMs: 100,
    });

    expect(result.status).toBe('timeout');
    expect(result.nativeSessionId).toBe('pty-permission-text');
    expect(write).not.toHaveBeenCalled();
  });

  it('does not auto-approve split JSON fragments from parser-based PTY output', async () => {
    let onData: ((data: string) => void) | undefined;
    const write = vi.fn();
    ptyMock.spawn.mockImplementation(() => {
      queueMicrotask(() => {
        onData?.('{"type":"thread.started","thread_id":"pty-split-json"}\n');
        onData?.('{"type":"item.completed","item":{"type":"reasoning","text":"For permission prompts, proceed');
        onData?.(' with default policy."}}\n');
      });
      return {
        onData: (cb: (data: string) => void) => { onData = cb; },
        onExit: () => {},
        kill: vi.fn(),
        write,
      };
    });
    const parser: LineParser = {
      parse(line) {
        const obj = JSON.parse(line) as { type?: string; thread_id?: string };
        if (obj.type === 'thread.started' && obj.thread_id) return { type: 'session_id', sessionId: obj.thread_id };
        return { type: 'unknown', raw: obj };
      },
    };

    const result = await runPtyProcess({
      binary: 'codex',
      args: ['exec'],
      env: process.env,
      cwd: process.cwd(),
      parser,
      idleTimeoutMs: 25,
      hardTimeoutMs: 100,
    });

    expect(result.status).toBe('timeout');
    expect(result.nativeSessionId).toBe('pty-split-json');
    expect(write).not.toHaveBeenCalled();
  });
});
