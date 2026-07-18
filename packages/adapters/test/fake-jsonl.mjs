#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const mode = process.env.FAKE_JSONL_MODE ?? 'success';
const fixture = process.env.FAKE_JSONL_FIXTURE;
const lastMsg = process.env.FAKE_JSONL_LAST_MSG ?? '';
let outPath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output-last-message' && i + 1 < args.length) outPath = args[i + 1];
}
if (mode === 'fail') {
  process.stderr.write('fake-jsonl: simulated fatal error\n');
  process.exit(2);
}
if (mode === 'blocked') {
  process.stdout.write('{"type":"step_start","sessionID":"ses-x"}\n');
  process.stdout.write('fake-jsonl: awaiting approval (pending permission)\n');
  if (outPath) writeFileSync(outPath, '');
  await new Promise((r) => setTimeout(r, 60000));
  process.exit(0);
}
if (mode === 'silent') {
  process.stdout.write('{"type":"step_start","sessionID":"ses-silent"}\n');
  if (outPath) writeFileSync(outPath, '');
  await new Promise((r) => setTimeout(r, 60000));
  process.exit(0);
}
if (mode === 'json-permission-silent') {
  process.stdout.write('{"type":"step_start","sessionID":"ses-permission-text"}\n');
  process.stdout.write('{"type":"reasoning","text":"For permission prompts, proceed with default policy."}\n');
  if (outPath) writeFileSync(outPath, '');
  await new Promise((r) => setTimeout(r, 60000));
  process.exit(0);
}
if (mode === 'split') {
  process.stdout.write('{"type":"step_start","session');
  await new Promise((r) => setTimeout(r, 10));
  process.stdout.write('ID":"ses-split"}\n{"type":"text","part":{"te');
  await new Promise((r) => setTimeout(r, 10));
  process.stdout.write('xt":"split pong"}}\n');
  if (outPath) writeFileSync(outPath, lastMsg);
  process.exit(0);
}
// success
if (fixture) process.stdout.write(readFileSync(fixture, 'utf8'));
if (outPath) writeFileSync(outPath, lastMsg);
process.exit(0);
