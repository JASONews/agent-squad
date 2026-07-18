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
