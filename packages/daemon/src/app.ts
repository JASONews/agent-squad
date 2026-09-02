import { openDb, loadConfig, AdapterRegistry, MockAdapter, createChoices, ChoicesWaiter, EventBus, type ResolvedConfig } from '@agent-squad/core';
import { CodexAdapter, OpencodeAdapter, AntigravityAdapter, ClaudeAdapter, KimiAdapter } from '@agent-squad/adapters';
import { buildApp } from './http/server.js';

export interface Daemon {
  app: ReturnType<typeof buildApp>;
  db: ReturnType<typeof openDb>;
  url: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function buildDaemon(opts?: { config?: ResolvedConfig; registry?: AdapterRegistry }): Promise<Daemon> {
  const config = opts?.config ?? await loadConfig();
  const db = openDb(config);
  const registry = opts?.registry ?? await defaultRegistry(config);
  const bus = new EventBus();
  const choices = createChoices(db, new ChoicesWaiter(), bus);
  const app = buildApp(db, registry, choices, bus);
  const url = `http://${config.server.host}:${config.server.port}`;
  return {
    app, db, url,
    start: async () => { await app.listen({ host: config.server.host, port: config.server.port }); },
    stop: async () => { await app.close(); db.close(); },
  };
}

async function defaultRegistry(config: ResolvedConfig): Promise<AdapterRegistry> {
  const r = new AdapterRegistry();
  if (process.env.NODE_ENV === 'test' || process.env.AGENT_SQUAD_ENABLE_MOCK === '1') {
    r.register('mock', new MockAdapter());
  }
  const codex = new CodexAdapter({
    modelProfileOverrides: config.subagents?.codex.modelProfiles,
  });
  if ((await codex.detect()).available) {
    r.register('codex', codex);
  }
  const opencode = new OpencodeAdapter({
    modelProfileOverrides: config.subagents?.opencode.modelProfiles,
  });
  if ((await opencode.detect()).available) {
    r.register('opencode', opencode);
  }
  const antigravity = new AntigravityAdapter({
    modelProfileOverrides: config.subagents?.antigravity.modelProfiles,
  });
  if ((await antigravity.detect()).available) {
    r.register('antigravity', antigravity);
  }
  const claude = new ClaudeAdapter({
    englishInputPolicy: config.subagents?.claude.englishInput,
    modelProfileOverrides: config.subagents?.claude.modelProfiles,
  });
  if ((await claude.detect()).available) {
    r.register('claude', claude);
  }
  const kimi = new KimiAdapter({
    modelProfileOverrides: config.subagents?.kimi.modelProfiles,
  });
  if ((await kimi.detect()).available) {
    r.register('kimi', kimi);
  }
  return r;
}
