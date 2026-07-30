#!/usr/bin/env node
// Stub impersonating `codex exec` for adapter tests. Controlled via env vars.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const mode = process.env.FAKE_CODEX_MODE ?? 'success';
const fixture = process.env.FAKE_CODEX_FIXTURE;
const lastMsg = process.env.FAKE_CODEX_LAST_MSG ?? 'fake-last-message';

if (process.env.FAKE_CODEX_ARGS_FILE) {
  writeFileSync(process.env.FAKE_CODEX_ARGS_FILE, JSON.stringify(args) + '\n', { flag: 'a' });
}

if (args[0] === '--version') {
  process.stdout.write('codex-cli 1.2.3\n');
  process.exit(0);
}

if (args[0] === 'app-server') {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.method === 'initialize' && message.id === 1) {
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })}\n`);
      }
      if (message.method === 'model/list' && message.id === 2) {
        process.stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            data: [
              {
                id: 'gpt-5.6-sol',
                displayName: 'GPT-5.6-Sol',
                isDefault: true,
                defaultReasoningEffort: 'high',
                supportedReasoningEfforts: [
                  { reasoningEffort: 'low' },
                  { reasoningEffort: 'high' },
                  { reasoningEffort: 'max' },
                ],
              },
            ],
            nextCursor: 'page-2',
          },
        })}\n`);
      }
      if (message.method === 'model/list' && message.id === 3 && message.params?.cursor === 'page-2') {
        process.stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          result: {
            data: [
              {
                id: 'gpt-5.6-terra',
                displayName: 'GPT-5.6-Terra',
                defaultReasoningEffort: 'medium',
                supportedReasoningEfforts: ['medium', 'high'],
              },
              {
                id: 'gpt-hidden',
                displayName: 'Hidden',
                hidden: true,
                supportedReasoningEfforts: [],
              },
            ],
            nextCursor: null,
          },
        })}\n`);
      }
    }
  });
  await new Promise(() => {});
}

// find --output-last-message <file>
let outPath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output-last-message' && i + 1 < args.length) outPath = args[i + 1];
}

function emitFixture() {
  if (fixture) {
    process.stdout.write(readFileSync(fixture, 'utf8'));
  } else {
    // default success fixture inline
    process.stdout.write('{"type":"thread.started","thread_id":"fake-thread-id"}\n');
    process.stdout.write('{"type":"turn.started"}\n');
    process.stdout.write('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"fake reply"}}\n');
    process.stdout.write('{"type":"turn.completed","usage":{}}\n');
  }
}

if (mode === 'fail') {
  process.stderr.write('fake-codex: simulated fatal error\n');
  process.exit(2);
}

if (mode === 'blocked') {
  // print a permission-like marker, then idle (adapter should detect blocked and kill us)
  process.stdout.write('{"type":"turn.started"}\n');
  process.stdout.write('fake-codex: awaiting approval for shell command (pending permission)\n');
  if (outPath) writeFileSync(outPath, '');
  // sleep 60s; adapter's BLOCK_AFTER_MS (30s) fires first
  await new Promise((r) => setTimeout(r, 60000));
  process.exit(0);
}

if (mode === 'silent') {
  process.stdout.write('{"type":"thread.started","thread_id":"fake-silent-thread"}\n');
  if (outPath) writeFileSync(outPath, '');
  await new Promise((r) => setTimeout(r, 60000));
  process.exit(0);
}

// success (or resume — same shape)
emitFixture();
if (outPath) writeFileSync(outPath, lastMsg);
process.exit(0);
