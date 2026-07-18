import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { type Daemon, buildDaemon } from '@agent-squad/daemon';
import { AdapterRegistry, MockAdapter, type CliAdapter, type ResolvedConfig } from '@agent-squad/core';

// Resolve the shim entry relative to this test file so the subprocess works
// regardless of vitest's working directory.
const SHIM_ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts');

let daemon: Daemon;
let base: string;
const seq = (() => {
  let n = 0;
  return () => ++n;
})();

beforeAll(async () => {
  const config: ResolvedConfig = {
    server: { host: '127.0.0.1', port: 0, dbPath: ':memory:' },
    contextPolicy: { default: 'message_only' },
  };
  const registry = new AdapterRegistry();
  registry.register('mock', new MockAdapter());
  registry.register('choicecli', choiceReplyAdapter());
  registry.register('multichoicecli', multiChoiceReplyAdapter());
  registry.register('slowcli', delayedAdapter(40, 'waited done'));
  registry.register('slowchoicecli', delayedChoiceReplyAdapter(40));
  daemon = await buildDaemon({ config, registry });
  await daemon.start();
  const addr = daemon.app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await daemon.stop();
});

function startShim(): ChildProcess {
  return spawn('npx', ['tsx', SHIM_ENTRY], {
    env: { ...process.env, AGENT_SQUAD_URL: base },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

function choiceReplyAdapter(): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async () => ({
      status: 'completed',
      reply: `Need a product direction before continuing.

%%AGENT_SQUAD_CHOICE%%
{"question":"Modal or standalone page?","options":[{"id":"modal","label":"Modal"},{"id":"page","label":"Page"}],"recommendation":{"option_id":"page","reason":"more room"}}
%%END_AGENT_SQUAD_CHOICE%%`,
    }),
  };
}

function multiChoiceReplyAdapter(): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async () => ({
      status: 'completed',
      reply: `Need two decisions before continuing.

%%AGENT_SQUAD_CHOICE%%
{"question":"Layout?","options":[{"id":"modal","label":"Modal"},{"id":"page","label":"Page"}],"recommendation":{"option_id":"page","reason":"more room"}}
%%END_AGENT_SQUAD_CHOICE%%

%%AGENT_SQUAD_CHOICE%%
{"question":"Density?","options":[{"id":"dense","label":"Dense"},{"id":"guided","label":"Guided"}],"recommendation":{"option_id":"dense","reason":"repeat users"}}
%%END_AGENT_SQUAD_CHOICE%%`,
    }),
  };
}

function delayedAdapter(delayMs: number, reply: string): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { status: 'completed', reply };
    },
  };
}

function delayedChoiceReplyAdapter(delayMs: number): CliAdapter {
  return {
    cliType: 'mock',
    detect: async () => ({ available: true }),
    capabilities: () => ({ mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true }),
    spawnSubagent: async (i) => ({ subagentId: i.subagentId, status: 'ready' }),
    send: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return {
        status: 'completed',
        reply: `Need a product direction before continuing.

%%AGENT_SQUAD_CHOICE%%
{"question":"Modal or standalone page?","options":[{"id":"modal","label":"Modal"},{"id":"page","label":"Page"}],"recommendation":{"option_id":"page","reason":"more room"}}
%%END_AGENT_SQUAD_CHOICE%%`,
      };
    },
  };
}

interface RpcResponse {
  id?: number;
  result?: { content?: { type: string; text: string }[]; structuredContent?: unknown };
  error?: { code?: number | string; message?: string };
}

function write(child: ChildProcess, msg: unknown): void {
  child.stdin!.write(`${JSON.stringify(msg)}\n`);
}

// Continuously drain newline-delimited JSON-RPC messages from stdout until we see
// the one whose `id` matches. The MCP stdio transport frames with `\n`, so a
// `data` chunk may carry several messages or a partial trailing line; we buffer.
async function waitForId(child: ChildProcess, id: number, buf: { s: string }, timeoutMs = 10000): Promise<RpcResponse> {
  let pending = buf.s;
  buf.s = '';
  const linesNow = pending.split('\n');
  pending = linesNow.pop() ?? '';
  for (const line of linesNow) {
    const msg = safeParse(line);
    if (msg?.id === id) return msg;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      once(child.stdout!, 'data') as Promise<[Buffer]>,
      once(child, 'exit') as Promise<[number | null]>,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), remaining)),
    ]);
    if (Array.isArray(result) && typeof result[0] === 'number') {
      throw new Error(`shim exited (code ${result[0]}) before responding to id=${id}`);
    }
    if (result === null) continue;
    const chunk = (result as [Buffer])[0].toString();
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const msg = safeParse(line);
      if (msg?.id === id) {
        buf.s = pending;
        return msg;
      }
    }
  }
  throw new Error(`timed out waiting for response id=${id}`);
}

function safeParse(line: string): RpcResponse | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as RpcResponse;
  } catch {
    return null;
  }
}

// The MCP server only services `tools/call` after the client completes the
// `initialize` handshake. Run it once per shim process.
async function initialize(child: ChildProcess, buf: { s: string }): Promise<void> {
  const id = seq();
  write(child, {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'shim-test', version: '0.0.0' },
    },
  });
  await waitForId(child, id, buf);
  write(child, { jsonrpc: '2.0', method: 'notifications/initialized' });
}

async function call(child: ChildProcess, buf: { s: string }, name: string, args: Record<string, unknown>): Promise<unknown> {
  const id = seq();
  write(child, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const msg = await waitForId(child, id, buf);
  if (msg.error) throw new Error(`tools/call failed: ${JSON.stringify(msg.error)}`);
  const text = msg.result?.content?.[0]?.text;
  if (text === undefined) throw new Error('no content in tools/call response');
  return JSON.parse(text);
}

async function callResult(child: ChildProcess, buf: { s: string }, name: string, args: Record<string, unknown>): Promise<NonNullable<RpcResponse['result']>> {
  const id = seq();
  write(child, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const msg = await waitForId(child, id, buf);
  if (msg.error) throw new Error(`tools/call failed: ${JSON.stringify(msg.error)}`);
  if (!msg.result) throw new Error('no result in tools/call response');
  return msg.result;
}

describe('mcp shim e2e', () => {
  it(
    'start_session via stdio round-trips to daemon',
    async () => {
      const child = startShim();
      const buf = { s: '' };
      try {
        await initialize(child, buf);
        const r = (await call(child, buf, 'start_session', { cwd: '/repo', task: 'hello mcp' })) as { session_id: string };
        expect(r.session_id).toMatch(/^sess_/);
      } finally {
        child.kill();
      }
    },
    20000,
  );

  it(
    'full round-trip: start → spawn(mock) → send(review)',
    async () => {
      const child = startShim();
      const buf = { s: '' };
      try {
        await initialize(child, buf);
        const s = (await call(child, buf, 'start_session', { cwd: '/repo', task: 't' })) as { session_id: string };
        const sp = (await call(child, buf, 'spawn_subagent', {
          session_id: s.session_id,
          alias: 'rev',
          cli: 'mock',
          role: 'reviewer',
          message: 'go',
        })) as { status: string };
        expect(sp.status).toBe('ready');
        const sent = (await call(child, buf, 'send_to_subagent', {
          session_id: s.session_id,
          alias: 'rev',
          message: 'review this',
          wait: true,
        })) as { status: string; artifacts: { kind: string }[] };
        expect(sent.status).toBe('completed');
        expect(sent.artifacts.some((a) => a.kind === 'review_json')).toBe(true);
      } finally {
        child.kill();
      }
    },
    20000,
  );

  it(
    'get_subagent_messages limit returns the latest messages',
    async () => {
      const child = startShim();
      const buf = { s: '' };
      try {
        await initialize(child, buf);
        const s = (await call(child, buf, 'start_session', { cwd: '/repo', task: 'message limit order' })) as { session_id: string };
        const sp = (await call(child, buf, 'spawn_subagent', {
          session_id: s.session_id,
          alias: 'msg',
          cli: 'mock',
          role: 'reviewer',
          message: 'spawn assignment',
        })) as { subagent_id: string };
        await call(child, buf, 'send_to_subagent', {
          session_id: s.session_id,
          alias: 'msg',
          message: 'alpha',
          wait: true,
        });
        await call(child, buf, 'send_to_subagent', {
          session_id: s.session_id,
          alias: 'msg',
          message: 'beta',
          wait: true,
        });

        const limited = (await call(child, buf, 'get_subagent_messages', {
          session_id: s.session_id,
          subagent_id: sp.subagent_id,
          limit: 1,
        })) as { messages: { content?: string | null }[] };

        expect(limited.messages).toHaveLength(1);
        expect(limited.messages[0]?.content).toBe('Completed: beta');
      } finally {
        child.kill();
      }
    },
    20000,
  );

  it(
    'wait_subagent returns the next result for a running subagent',
    async () => {
      const child = startShim();
      const buf = { s: '' };
      try {
        await initialize(child, buf);
        const s = (await call(child, buf, 'start_session', { cwd: '/repo', task: 'wait mcp' })) as { session_id: string };
        await call(child, buf, 'spawn_subagent', {
          session_id: s.session_id,
          alias: 'slow',
          cli: 'slowcli',
          role: 'reviewer',
          message: 'go',
        });
        const sent = (await call(child, buf, 'send_to_subagent', {
          session_id: s.session_id,
          alias: 'slow',
          message: 'review slowly',
          wait: true,
          soft_timeout_ms: 10,
        })) as { message_id: string; status: string };
        expect(sent.status).toBe('running');

        const result = await callResult(child, buf, 'wait_subagent', {
          session_id: s.session_id,
          alias: 'slow',
          after_message_id: sent.message_id,
          timeout_ms: 1000,
        });
        const text = result.content?.[0]?.text;
        if (text === undefined) throw new Error('no content in tools/call response');
        const waited = JSON.parse(text) as { status: string; reply?: string; message_id?: string };
        const structured = result.structuredContent as typeof waited | undefined;
        expect(waited.status).toBe('completed');
        expect(waited.reply).toBe('waited done');
        expect(waited.message_id).toMatch(/^msg_/);
        expect(structured?.status).toBe('completed');
        expect(structured?.reply).toBe('waited done');
      } finally {
        child.kill();
      }
    },
    20000,
  );

  it(
    'wait_subagent exposes structured choice parsed from a running subagent reply',
    async () => {
      const child = startShim();
      const buf = { s: '' };
      try {
        await initialize(child, buf);
        const s = (await call(child, buf, 'start_session', { cwd: '/repo', task: 'wait choice mcp' })) as { session_id: string };
        await call(child, buf, 'spawn_subagent', {
          session_id: s.session_id,
          alias: 'slowchoice',
          cli: 'slowchoicecli',
          role: 'reviewer',
          message: 'go',
        });
        const sent = (await call(child, buf, 'send_to_subagent', {
          session_id: s.session_id,
          alias: 'slowchoice',
          message: 'review slowly',
          wait: true,
          soft_timeout_ms: 10,
        })) as { message_id: string; status: string };
        expect(sent.status).toBe('running');

        const result = await callResult(child, buf, 'wait_subagent', {
          session_id: s.session_id,
          alias: 'slowchoice',
          after_message_id: sent.message_id,
          timeout_ms: 1000,
        });
        const text = result.content?.[0]?.text;
        if (text === undefined) throw new Error('no content in tools/call response');
        const waited = JSON.parse(text) as { status: string; choice_requested?: boolean; choice?: { choice_id?: string; question?: string; options?: { id: string }[] } };
        const structured = result.structuredContent as typeof waited | undefined;
        expect(waited.status).toBe('choice_requested');
        expect(waited.choice_requested).toBe(true);
        expect(waited.choice?.choice_id).toMatch(/^ch_/);
        expect(waited.choice?.question).toBe('Modal or standalone page?');
        expect(waited.choice?.options?.map((o) => o.id)).toEqual(['modal', 'page']);
        expect(structured?.choice_requested).toBe(true);
        expect(structured?.choice?.choice_id).toBe(waited.choice?.choice_id);
      } finally {
        child.kill();
      }
    },
    20000,
  );

  it(
    'choice relay over stdio MCP: request → resolve → wait',
    async () => {
      const child = startShim();
      const buf = { s: '' };
      try {
        await initialize(child, buf);
        const s = (await call(child, buf, 'start_session', { cwd: '/repo', task: 'choice mcp' })) as { session_id: string };
        const sp = (await call(child, buf, 'spawn_subagent', { session_id: s.session_id, alias: 'a', cli: 'mock', role: 'r', message: 'go' })) as { subagent_id: string };
        const req = (await call(child, buf, 'request_choice', {
          session_id: s.session_id, subagent_id: sp.subagent_id, question: 'modal or page?',
          options: [{ id: 'modal', label: 'Modal' }, { id: 'page', label: 'Page' }],
          recommendation: { option_id: 'page', reason: 'more space' }, blocking: false,
        })) as { choice_id: string; status: string };
        expect(req.status).toBe('pending_main_agent');
        const res = (await call(child, buf, 'resolve_choice', { session_id: s.session_id, choice_id: req.choice_id, selected: 'page', rationale: 'user picked' })) as { status: string };
        expect(res.status).toBe('resolved');
        const w = (await call(child, buf, 'wait_choice', { session_id: s.session_id, choice_id: req.choice_id, timeout_ms: 1000 })) as { status: string; selected: string };
        expect(w.status).toBe('resolved');
        expect(w.selected).toBe('page');
      } finally {
        child.kill();
      }
    },
    20000,
  );

  it(
    'send_to_subagent exposes structured choice parsed from a subagent reply',
    async () => {
      const child = startShim();
      const buf = { s: '' };
      try {
        await initialize(child, buf);
        const s = (await call(child, buf, 'start_session', { cwd: '/repo', task: 'reply choice mcp' })) as { session_id: string };
        await call(child, buf, 'spawn_subagent', {
          session_id: s.session_id,
          alias: 'chooser',
          cli: 'choicecli',
          role: 'r',
          message: 'go',
        });
        const result = await callResult(child, buf, 'send_to_subagent', {
          session_id: s.session_id,
          alias: 'chooser',
          message: 'continue',
          wait: true,
        });
        const text = result.content?.[0]?.text;
        if (text === undefined) throw new Error('no content in tools/call response');
        const sent = JSON.parse(text) as { status: string; choice_requested?: boolean; choice?: { choice_id?: string; question?: string; options?: { id: string }[] } };
        const structured = result.structuredContent as typeof sent | undefined;
        expect(sent.status).toBe('choice_requested');
        expect(sent.choice_requested).toBe(true);
        expect(sent.choice?.choice_id).toMatch(/^ch_/);
        expect(sent.choice?.question).toBe('Modal or standalone page?');
        expect(sent.choice?.options?.map((o) => o.id)).toEqual(['modal', 'page']);
        expect(structured?.choice_requested).toBe(true);
        expect(structured?.choice?.choice_id).toBe(sent.choice?.choice_id);
      } finally {
        child.kill();
      }
    },
    20000,
  );

  it(
    'send_to_subagent exposes every structured choice parsed from a subagent reply',
    async () => {
      const child = startShim();
      const buf = { s: '' };
      try {
        await initialize(child, buf);
        const s = (await call(child, buf, 'start_session', { cwd: '/repo', task: 'multi reply choice mcp' })) as { session_id: string };
        await call(child, buf, 'spawn_subagent', {
          session_id: s.session_id,
          alias: 'chooser',
          cli: 'multichoicecli',
          role: 'r',
          message: 'go',
        });
        const result = await callResult(child, buf, 'send_to_subagent', {
          session_id: s.session_id,
          alias: 'chooser',
          message: 'continue',
          wait: true,
        });
        const text = result.content?.[0]?.text;
        if (text === undefined) throw new Error('no content in tools/call response');
        const sent = JSON.parse(text) as { status: string; choices?: { choice_id?: string; question?: string; options?: { id: string }[] }[]; choice?: { choice_id?: string } };
        const structured = result.structuredContent as typeof sent | undefined;
        expect(sent.status).toBe('choice_requested');
        expect(sent.choices?.map((c) => c.question)).toEqual(['Layout?', 'Density?']);
        expect(sent.choice?.choice_id).toBe(sent.choices?.[0].choice_id);
        expect(structured?.choices?.map((c) => c.question)).toEqual(['Layout?', 'Density?']);
        expect(structured?.choice?.choice_id).toBe(sent.choice?.choice_id);
      } finally {
        child.kill();
      }
    },
    20000,
  );
});
