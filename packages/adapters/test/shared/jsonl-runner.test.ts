import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runJsonlProcess } from '../../src/shared/jsonl-runner.js';
import type { LineParser } from '../../src/shared/line-parser.js';

const here = dirname(fileURLToPath(import.meta.url));
// resolve to packages/adapters/test/ (parent of shared/)
const testRoot = join(here, '..');

// A simple parser for the fake-jsonl stub's default-ish lines + the unknown-event shape.
// The fake stub prints real fixture lines OR a sessionID line + marker. This parser extracts:
//   {"type":"...","sessionID":"ses-x",...} → session_id (unless it has part.text)
//   {"type":"text","part":{"text":"..."}} → reply_text
const fakeParser: LineParser = {
  parse(line) {
    const trimmed = line.trim();
    if (trimmed.length === 0) return null;
    let obj: unknown;
    try { obj = JSON.parse(trimmed); } catch { return { type: 'unknown', raw: trimmed }; }
    if (typeof obj !== 'object' || obj === null) return { type: 'unknown', raw: obj };
    const o = obj as { type?: string; sessionID?: string; part?: { text?: string } };
    if (o.type === 'text' && o.part && typeof o.part.text === 'string') return { type: 'reply_text', text: o.part.text };
    if (typeof o.sessionID === 'string') return { type: 'session_id', sessionId: o.sessionID };
    return { type: 'unknown', raw: o };
  },
};

let tmp: string;
function setupFakeBin(): string {
  const bin = join(tmp, 'bin');
  mkdirSync(bin, { recursive: true });
  const link = join(bin, 'fake-jsonl');
  if (!existsSync(link)) symlinkSync(join(testRoot, 'fake-jsonl.mjs'), link);
  return bin;
}
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'asq-runner-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('runJsonlProcess', () => {
  it('success: returns completed with nativeSessionId + reply', async () => {
    const bin = setupFakeBin();
    const fixture = join(testRoot, 'fixtures', 'opencode-success.jsonl');
    const outputs: { stream: string; text: string; rawTail: string }[] = [];
    const r = await runJsonlProcess({
      binary: 'fake-jsonl',
      args: ['--output-last-message', join(tmp, 'last.txt')],
      env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? ''), FAKE_JSONL_FIXTURE: fixture, FAKE_JSONL_LAST_MSG: '' },
      parser: fakeParser,
      idleTimeoutMs: 500, blockAfterMs: 1500,
      onOutput: (output) => { outputs.push(output); },
    });
    expect(r.status).toBe('completed');
    expect(r.nativeSessionId).toBe('ses_0d2337b5fffeiyrJobPy9dYLhs');
    expect(r.reply).toBe('pong');
    expect(outputs.some((output) => output.stream === 'stdout' && output.rawTail.includes('pong'))).toBe(true);
  });

  it('parses JSONL events split across stdout chunks', async () => {
    const bin = setupFakeBin();
    const r = await runJsonlProcess({
      binary: 'fake-jsonl',
      args: ['--output-last-message', join(tmp, 'last.txt')],
      env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? ''), FAKE_JSONL_MODE: 'split' },
      parser: fakeParser,
      idleTimeoutMs: 500,
      blockAfterMs: 1500,
    });
    expect(r.status).toBe('completed');
    expect(r.nativeSessionId).toBe('ses-split');
    expect(r.reply).toBe('split pong');
  });

  it('fail: non-zero exit → failed with rawTail', async () => {
    const bin = setupFakeBin();
    const r = await runJsonlProcess({
      binary: 'fake-jsonl', args: [],
      env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? ''), FAKE_JSONL_MODE: 'fail' },
      parser: fakeParser, idleTimeoutMs: 500, blockAfterMs: 1500,
    });
    expect(r.status).toBe('failed');
    expect(r.rawTail).toBeTruthy();
  });

  it('blocked: idle + marker → native_cli_blocked', async () => {
    const bin = setupFakeBin();
    const r = await runJsonlProcess({
      binary: 'fake-jsonl', args: [],
      env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? ''), FAKE_JSONL_MODE: 'blocked' },
      parser: fakeParser, idleTimeoutMs: 500, blockAfterMs: 1500,
    });
    expect(r.status).toBe('native_cli_blocked');
    expect(r.rawTail).toMatch(/approval|pending|permission/i);
  }, 20000);

  it('does not treat JSON event text containing permission words as native_cli_blocked', async () => {
    const bin = setupFakeBin();
    const r = await runJsonlProcess({
      binary: 'fake-jsonl',
      args: [],
      env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? ''), FAKE_JSONL_MODE: 'json-permission-silent' },
      parser: fakeParser,
      idleTimeoutMs: 25,
      hardTimeoutMs: 300,
    } as Parameters<typeof runJsonlProcess>[0] & { hardTimeoutMs: number });
    expect(r.status).toBe('timeout');
    expect(r.nativeSessionId).toBe('ses-permission-text');
  }, 20000);

  it('silent long-running output waits for hard timeout instead of native_cli_blocked', async () => {
    const bin = setupFakeBin();
    const r = await runJsonlProcess({
      binary: 'fake-jsonl',
      args: [],
      env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? ''), FAKE_JSONL_MODE: 'silent' },
      parser: fakeParser,
      idleTimeoutMs: 25,
      blockAfterMs: 50,
      hardTimeoutMs: 300,
    } as Parameters<typeof runJsonlProcess>[0] & { hardTimeoutMs: number });
    expect(r.status).toBe('timeout');
    expect(r.nativeSessionId).toBe('ses-silent');
  }, 20000);

  it('outputLastMessagePath fallback when replyText empty', async () => {
    const bin = setupFakeBin();
    const lastPath = join(tmp, 'last.txt');
    // fixture with NO text event (only step_start) → replyText empty → fallback to last-msg file
    const fixtureNoText = join(tmp, 'no-text.jsonl');
    writeFileSync(fixtureNoText, '{"type":"step_start","sessionID":"ses-y"}\n');
    const r = await runJsonlProcess({
      binary: 'fake-jsonl',
      args: ['--output-last-message', lastPath],
      outputLastMessagePath: lastPath,
      env: { ...process.env, PATH: bin + ':' + (process.env.PATH ?? ''), FAKE_JSONL_FIXTURE: fixtureNoText, FAKE_JSONL_LAST_MSG: 'fallback-reply' },
      parser: fakeParser, idleTimeoutMs: 500, blockAfterMs: 1500,
    });
    expect(r.status).toBe('completed');
    expect(r.reply).toBe('fallback-reply');
    expect(r.nativeSessionId).toBe('ses-y');
  });
});
