#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const mode = process.env.FAKE_OPENCODE_MODE ?? 'success';
const fixture = process.env.FAKE_OPENCODE_FIXTURE ?? '';

if (args[0] === '--version') {
  process.stdout.write('opencode 1.2.3\n');
  process.exit(0);
}

if (args[0] === 'models') {
  if (process.env.FAKE_OPENCODE_CWD_FILE) {
    writeFileSync(process.env.FAKE_OPENCODE_CWD_FILE, process.cwd());
  }
  process.stdout.write('\u001b[32mopenai/gpt-5.6\u001b[0m\n');
  process.stdout.write('anthropic/claude-opus-4-6\n');
  process.stdout.write('openai/gpt-5.6\n');
  process.exit(0);
}

function emitFixture() {
  if (fixture) {
    process.stdout.write(readFileSync(fixture, 'utf8'));
  } else {
    process.stdout.write('{"type":"step_start","sessionID":"ses-fake","part":{"type":"step-start"}}\n');
    process.stdout.write('{"type":"text","sessionID":"ses-fake","part":{"type":"text","text":"fake opencode reply"}}\n');
    process.stdout.write('{"type":"step_finish","sessionID":"ses-fake","part":{"type":"step-finish","reason":"stop"}}\n');
  }
}

if (mode === 'fail') {
  process.stderr.write('fake-opencode: simulated fatal error\n');
  process.exit(2);
}
if (mode === 'blocked') {
  process.stdout.write('{"type":"step_start","sessionID":"ses-fake","part":{"type":"step-start"}}\n');
  process.stdout.write('fake-opencode: permission required (pending approval)\n');
  await new Promise((r) => setTimeout(r, 60000));
  process.exit(0);
}
// success (or resume — same shape; -s is just ignored by the stub)
emitFixture();
process.exit(0);
