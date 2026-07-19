#!/usr/bin/env node
import { chmod, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(new URL('..', import.meta.url).pathname);
const outDir = resolve(root, 'dist', 'bin');

const external = [
  '@agentclientprotocol/sdk',
  '@modelcontextprotocol/server',
  '@modelcontextprotocol/server/*',
  'better-sqlite3',
  'commander',
  'fastify',
  'ink',
  'js-yaml',
  'node-pty',
  'react',
  'zod',
  'zod/*',
];

const entries = [
  ['packages/daemon/src/cli/index.ts', 'agent-squad.js'],
  ['packages/daemon/src/index.ts', 'agent-squadd.js'],
  ['packages/mcp/src/index.ts', 'agent-squad-mcp.js'],
];

await rm(resolve(root, 'dist'), { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const [entry, outfile] of entries) {
  const target = resolve(outDir, outfile);
  await mkdir(dirname(target), { recursive: true });
  await build({
    entryPoints: [resolve(root, entry)],
    outfile: target,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: true,
    external,
    logLevel: 'silent',
  });
  await chmod(target, 0o755);
}
