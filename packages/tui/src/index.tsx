#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { pathToFileURL } from 'node:url';
import { App } from './App.js';

export function runTui(opts?: { baseUrl?: string }): Promise<void> {
  const baseUrl = opts?.baseUrl ?? process.env.AGENT_SQUAD_URL ?? 'http://127.0.0.1:28771';
  const restoreScreen = enterFullScreen();
  const app = render(<App baseUrl={baseUrl} />);
  return app.waitUntilExit().finally(restoreScreen);
}

function enterFullScreen(): () => void {
  if (!process.stdout.isTTY) return () => {};
  let restored = false;
  writeAnsi('\x1b[?1049h\x1b[?25l');
  const restore = () => {
    if (restored) return;
    restored = true;
    writeAnsi('\x1b[?25h\x1b[?1049l');
  };
  process.once('exit', restore);
  return restore;
}

function writeAnsi(sequence: string): void {
  try { process.stdout.write(sequence); } catch { /* terminal is already gone */ }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runTui();
}
