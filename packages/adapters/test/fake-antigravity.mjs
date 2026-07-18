#!/usr/bin/env node
// Stub impersonating `agy --print` for adapter tests. Controlled via env vars:
//   FAKE_AGY_MODE: success (default) | blocked | fail
//   FAKE_AGY_HOME: home dir to write last_conversations.json under (omit to skip the write)
//   FAKE_AGY_CWD:  the cwd key to write into the map (default process.cwd())
//   FAKE_AGY_UUID: the UUID to write (default 'fake-agy-uuid')
//   FAKE_AGY_ARGS_PATH: path to write argv JSON for assertions
import { mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const mode = process.env.FAKE_AGY_MODE ?? 'success';
const home = process.env.FAKE_AGY_HOME;
const cwdKey = process.env.FAKE_AGY_CWD ?? process.cwd();
const uuid = process.env.FAKE_AGY_UUID ?? 'fake-agy-uuid';
const argsPath = process.env.FAKE_AGY_ARGS_PATH;

if (argsPath) {
  writeFileSync(argsPath, JSON.stringify(args));
}

// Detect whether --conversation <id> was passed (resume).
const resumeIdx = args.indexOf('--conversation');
const isResume = resumeIdx !== -1 && resumeIdx + 1 < args.length;

function writeConversationMap() {
  if (!home) return;  // no home → don't write (some tests don't need it)
  const cacheDir = join(home, '.gemini', 'antigravity-cli', 'cache');
  mkdirSync(cacheDir, { recursive: true });
  let realKey = cwdKey;
  try { realKey = realpathSync(cwdKey); } catch { /* use literal */ }
  // Merge with any existing map so we don't clobber other entries.
  const mapPath = join(cacheDir, 'last_conversations.json');
  let map = {};
  try { map = JSON.parse(readFileSync(mapPath, 'utf8')); } catch { /* empty */ }
  map[realKey] = uuid;
  writeFileSync(mapPath, JSON.stringify(map));
}

if (mode === 'fail') {
  process.stderr.write('fake-antigravity: simulated fatal error\n');
  process.exit(2);
}
if (mode === 'blocked') {
  process.stdout.write('fake-antigravity: permission required (pending approval)\n');
  await new Promise((r) => setTimeout(r, 60000));
  process.exit(0);
}
// success
process.stdout.write(isResume ? 'Resumed conversation. Reply: pong\n\n### Summary of work\n- replied pong\n' : 'Reply: pong\n\n### Summary of work\n- replied pong\n');
writeConversationMap();
process.exit(0);
