#!/usr/bin/env node
import { daemonStart } from './cli/daemon.js';
import { AGENT_SQUAD_VERSION } from '@agent-squad/core';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: agent-squadd [options]');
  console.log('');
  console.log('Run the agent-squad daemon in the foreground.');
  console.log('');
  console.log('Options:');
  console.log('  -h, --help     display help');
  console.log('  -V, --version  output the version number');
  process.exit(0);
}

if (process.argv.includes('--version') || process.argv.includes('-V')) {
  console.log(AGENT_SQUAD_VERSION);
  process.exit(0);
}

daemonStart({ foreground: true }).catch((e) => {
  console.error(e);
  process.exit(1);
});
