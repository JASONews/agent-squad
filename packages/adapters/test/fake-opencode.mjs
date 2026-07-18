#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const mode = process.env.FAKE_OPENCODE_MODE ?? 'success';
const fixture = process.env.FAKE_OPENCODE_FIXTURE ?? '';

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
