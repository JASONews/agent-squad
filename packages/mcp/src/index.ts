#!/usr/bin/env node
import { runStdio } from './tools.js';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: agent-squad-mcp [options]');
  console.log('');
  console.log('Run the agent-squad stdio MCP shim.');
  console.log('');
  console.log('Options:');
  console.log('  -h, --help     display help');
  console.log('  -V, --version  output the version number');
  process.exit(0);
}

if (process.argv.includes('--version') || process.argv.includes('-V')) {
  console.log('0.1.3');
  process.exit(0);
}

runStdio().catch((e) => {
  console.error(e);
  process.exit(1);
});
