#!/usr/bin/env node
import { Command } from 'commander';
import { AGENT_SQUAD_VERSION } from '@agent-squad/core';
import { daemonStart, daemonStop, daemonStatus } from './daemon.js';
import { doctor } from './doctor.js';
import { discoverAll, formatDiscoverTable } from './discover.js';
import { installCli, type InstallableCli } from './installers.js';

const program = new Command();
program
  .name('agent-squad')
  .description('Local external subagent runtime')
  .version(AGENT_SQUAD_VERSION);

program
  .command('daemon')
  .argument('<action>', 'start | stop | status')
  .option('--foreground', 'run in foreground')
  .action(async (action: string, opts: { foreground?: boolean }) => {
    if (action === 'start') {
      await daemonStart(opts);
    } else if (action === 'stop') {
      await daemonStop();
    } else if (action === 'status') {
      await daemonStatus();
    } else {
      console.error(`unknown daemon action: ${action}`);
      process.exit(1);
    }
  });

program.command('doctor').action(async () => {
  await doctor();
});

program.command('discover').description('Detect installed coding CLIs and their agent-squad MCP config status').action(async () => {
  const results = await discoverAll();
  console.error(formatDiscoverTable(results));
});

program.command('install').description('Install agent-squad MCP config into a coding CLI').argument('<cli>', 'codex | opencode | antigravity | claude | kimi').action(async (cli: string) => {
  const validClis: InstallableCli[] = ['codex', 'opencode', 'antigravity', 'claude', 'kimi'];
  if (!validClis.includes(cli as InstallableCli)) {
    console.error(`unknown cli: ${cli}. Valid: ${validClis.join(', ')}`);
    process.exit(1);
  }
  const result = await installCli(cli as InstallableCli);
  console.error(`${result.action}: ${result.message}`);
  console.error(`config: ${result.configPath}`);
});

program
  .command('tui')
  .description('Launch the agent-squad TUI')
  .action(async () => {
    const { runTui } = await import('@agent-squad/tui');
    await runTui({ baseUrl: process.env.AGENT_SQUAD_URL ?? 'http://127.0.0.1:28771' });
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
