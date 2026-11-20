#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE ?? 'success';

if (process.env.FAKE_CLAUDE_ARGS_FILE) {
  writeFileSync(process.env.FAKE_CLAUDE_ARGS_FILE, JSON.stringify(args) + '\n', { flag: 'a' });
}
if (process.env.FAKE_CLAUDE_CWD_FILE) {
  writeFileSync(process.env.FAKE_CLAUDE_CWD_FILE, process.cwd());
}

if (args[0] === '--version') {
  process.stdout.write('2.1.3 (Claude Code)\n');
  process.exit(0);
}

if (args[0] === '--help') {
  process.stdout.write(`Usage: claude [options]
  --model <model>    Use a model alias such as 'opus' or 'sonnet', or a full name such as 'claude-opus-4-6'
  --effort <level>   Reasoning effort (low, medium, high, xhigh, max)
  --verbose          Enable verbose output
`);
  process.exit(0);
}

if (args.includes('--safe-mode') && mode === 'catalog') {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input);
  if (request.type !== 'control_request' || request.request.subtype !== 'initialize') process.exit(2);
  console.log(JSON.stringify({ type: 'system', subtype: 'init' }));
  console.log(JSON.stringify({ type: 'control_response', response: {
    request_id: request.request_id, subtype: 'success', response: { models: [
      { value: 'default', displayName: 'Default', supportedEffortLevels: ['high', 'max'] },
      { value: 'fable', displayName: 'Fable', supportedEffortLevels: ['xhigh'] },
      { value: 'custom', supportsEffort: false, supportedEffortLevels: ['high'] },
    ] },
  } }));
  process.exit(0);
}

if (mode === 'fail') {
  process.stderr.write('fake-claude: simulated fatal error\n');
  process.exit(2);
}

if (mode === 'blocked') {
  process.stdout.write('{"type":"system","subtype":"init","session_id":"fake-claude-session"}\n');
  process.stdout.write('fake-claude: permission required (pending approval)\n');
  await new Promise((resolve) => setTimeout(resolve, 60000));
  process.exit(0);
}

if (mode === 'silent') {
  process.stdout.write('{"type":"system","subtype":"init","session_id":"fake-claude-silent"}\n');
  await new Promise((resolve) => setTimeout(resolve, 60000));
  process.exit(0);
}

process.stdout.write('{"type":"system","subtype":"init","session_id":"fake-claude-session"}\n');
process.stdout.write('{"type":"assistant","session_id":"fake-claude-session","message":{"role":"assistant","content":[{"type":"text","text":"fake claude reply"}]}}\n');
process.stdout.write('{"type":"result","subtype":"success","session_id":"fake-claude-session","result":"fake claude reply"}\n');
process.exit(0);
