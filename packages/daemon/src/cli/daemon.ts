import { buildDaemon } from '../app.js';
import { readPid, writePid, removePid, isPidAlive, pidPath } from '../lifecycle/pidfile.js';
import { logLine } from '../lifecycle/logger.js';

const HEALTH_URL = 'http://127.0.0.1:28771/v1/health';

export async function daemonStart(opts: { foreground?: boolean; baseDir?: string }): Promise<void> {
  const { baseDir } = opts;
  const existing = readPid(baseDir);
  if (existing && isPidAlive(existing)) {
    // probe health: if reachable and ok, this is a live daemon — no-op.
    try {
      const r = await fetch(HEALTH_URL);
      if (r.ok) {
        console.error(`agent-squadd already running (pid ${existing}) at http://127.0.0.1:28771`);
        return;
      }
    } catch {
      /* stale pidfile / not reachable — fall through and start fresh */
    }
  }

  if (opts.foreground) {
    const daemon = await buildDaemon();
    setupSignals(daemon.stop, baseDir);
    await daemon.start();
    writePid(process.pid, baseDir);
    logLine(`agent-squadd started (pid ${process.pid})`, baseDir);
    console.error(`agent-squadd listening at ${daemon.url} (pid ${process.pid}, foreground)`);
    // run until signal — keep the promise pending.
    await new Promise<void>(() => {});
  } else {
    // background: re-spawn detached, re-invoking the same entry path with --foreground.
    const { spawn } = await import('node:child_process');
    const child = spawn(process.argv[1]!, ['daemon', 'start', '--foreground'], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (e) => {
      console.error(`failed to start background daemon: ${e.message}`);
      process.exit(1);
    });
    child.unref();
    if (child.pid) {
      console.error(`agent-squadd started (pid ${child.pid})`);
    }
  }
}

export async function daemonStop(baseDir?: string): Promise<void> {
  const pid = readPid(baseDir);
  if (!pid) {
    console.error('no pidfile');
    return;
  }
  if (isPidAlive(pid)) {
    process.kill(pid, 'SIGTERM');
    logLine(`sent SIGTERM to ${pid}`, baseDir);
    console.error(`sent SIGTERM to ${pid}`);
  } else {
    removePid(baseDir);
    console.error('removed stale pidfile');
  }
}

export async function daemonStatus(baseDir?: string): Promise<void> {
  const pid = readPid(baseDir);
  console.error(`pidfile: ${pidPath(baseDir)}`);
  console.error(`pid: ${pid ?? '-'}`);
  console.error(`alive: ${pid ? isPidAlive(pid) : false}`);
  try {
    const r = await fetch(HEALTH_URL);
    console.error(`health: ${r.status} ${r.ok ? 'ok' : ''}`);
  } catch (e) {
    console.error(`health: unreachable (${(e as Error).message})`);
  }
}

function setupSignals(stop: () => Promise<void>, baseDir?: string): void {
  const handle = async (sig: string): Promise<void> => {
    logLine(`received ${sig}, shutting down`, baseDir);
    try {
      await stop();
    } finally {
      removePid(baseDir);
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => {
    void handle('SIGTERM');
  });
  process.on('SIGINT', () => {
    void handle('SIGINT');
  });
}
