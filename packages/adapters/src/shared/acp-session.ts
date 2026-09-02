import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { AGENT_SQUAD_VERSION } from '@agent-squad/core';
import { PROTOCOL_VERSION, client, methods, ndJsonStream } from '@agentclientprotocol/sdk';

const PROCESS_EXIT_GRACE_MS = 250;

export interface AllocateAcpNativeSessionOptions {
  label: string;
  binary: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

/** Creates an ACP session and closes the transport without sending a prompt. */
export async function allocateAcpNativeSession(
  options: AllocateAcpNativeSessionOptions,
): Promise<string> {
  const child = spawn(options.binary, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.resume();

  const app = client({ name: 'agent-squad-session-allocation' });
  const protocolPromise = app.connectWith(
    ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ),
    async (context): Promise<string> => {
      await context.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { session: { configOptions: {} } },
        clientInfo: { name: 'agent-squad', version: AGENT_SQUAD_VERSION },
      });
      const created = await context.request(methods.agent.session.new, {
        cwd: options.cwd,
        mcpServers: [],
      });
      if (!created.sessionId) throw new Error('empty session id');
      return created.sessionId;
    },
  );
  const guardedProtocol = protocolPromise.then(
    (nativeSessionId) => ({ kind: 'result' as const, nativeSessionId }),
    () => ({ kind: 'protocol_error' as const }),
  );
  const spawnFailure = new Promise<{ kind: 'spawn_error' }>((resolveFailure) => {
    child.once('error', () => resolveFailure({ kind: 'spawn_error' }));
  });
  let timeoutTimer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ kind: 'timeout' }>((resolveTimeout) => {
    timeoutTimer = setTimeout(() => resolveTimeout({ kind: 'timeout' }), options.timeoutMs);
  });

  try {
    const outcome = await Promise.race([guardedProtocol, spawnFailure, timeout]);
    if (outcome.kind === 'result') return outcome.nativeSessionId;
    if (outcome.kind === 'timeout') throw new Error(`${options.label} native session allocation timed out`);
    if (outcome.kind === 'spawn_error') {
      throw new Error(`${options.label} native session allocation could not start the CLI`);
    }
    throw new Error(`${options.label} native session allocation failed`);
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    await terminateChild(child);
    await Promise.race([guardedProtocol, delay(PROCESS_EXIT_GRACE_MS)]);
  }
}

async function terminateChild(child: ReturnType<typeof spawn>): Promise<void> {
  child.stdin?.end();
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([waitForExit(child), delay(PROCESS_EXIT_GRACE_MS)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await Promise.race([waitForExit(child), delay(PROCESS_EXIT_GRACE_MS)]);
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => child.once('close', () => resolveExit()));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
