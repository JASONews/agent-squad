import { discoverAll, formatDiscoverTable } from './discover.js';

const HEALTH_URL = process.env.AGENT_SQUAD_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:28771';
const HEALTH_ENDPOINT = `${HEALTH_URL}/v1/health`;

export async function doctor(): Promise<void> {
  // Daemon health
  try {
    const r = await fetch(HEALTH_ENDPOINT);
    if (r.ok) {
      const j = (await r.json()) as { ok: boolean; db_ok: boolean };
      console.error(`daemon: healthy (db_ok=${j.db_ok})`);
    } else {
      console.error(`daemon: unhealthy (status ${r.status})`);
    }
  } catch (e) {
    console.error(`daemon: unreachable (${(e as Error).message}). Run: agent-squad daemon start`);
  }

  // CLI discovery
  console.error('');
  const results = await discoverAll();
  console.error(formatDiscoverTable(results));
}
