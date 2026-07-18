import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db/client.js';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Db', () => {
  it('creates all five tables', () => {
    const db = openDb({ server: { host: '', port: 0, dbPath: ':memory:' }, contextPolicy: { default: 'message_only' } });
    const tables = db.prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining(['sessions', 'subagents', 'messages', 'artifacts', 'choices'])
    );
  });

  it('stores subagent model selection columns', () => {
    const db = openDb({ server: { host: '', port: 0, dbPath: ':memory:' }, contextPolicy: { default: 'message_only' } });
    const columns = db.prepare<[], { name: string }>('PRAGMA table_info(subagents)').all().map((r) => r.name);
    expect(columns).toEqual(expect.arrayContaining(['model', 'reasoning_effort']));
  });

  it('is idempotent (migrate twice)', () => {
    const db = openDb({ server: { host: '', port: 0, dbPath: ':memory:' }, contextPolicy: { default: 'message_only' } });
    expect(() => db.migrate()).not.toThrow();
  });

  it('enforces unique(session_id, alias)', () => {
    const db = openDb({ server: { host: '', port: 0, dbPath: ':memory:' }, contextPolicy: { default: 'message_only' } });
    const now = new Date().toISOString();
    db.prepare("INSERT INTO sessions (id, root_task, repo_path, main_peer_id, created_at, updated_at) VALUES (?,?,?,?,?,?)")
      .run('sess_1', 'task', null, null, now, now);
    const ins = db.prepare("INSERT INTO subagents (id, session_id, alias, cli_type, role, launch_mode, status, last_seen_at) VALUES (?,?,?,?,?,?,?,?)");
    ins.run('sub_a', 'sess_1', 'rev', 'mock', 'reviewer', 'resumable_headless', 'ready', now);
    expect(() => ins.run('sub_b', 'sess_1', 'rev', 'mock', 'reviewer', 'resumable_headless', 'ready', now)).toThrow();
  });

  it('creates the parent directory of a file db_path on first run', () => {
    const root = mkdtempSync(join(tmpdir(), 'asq-dir-'));
    const dir = join(root, 'nested', 'data'); // does not exist
    const dbPath = join(dir, 'agent-squad.db');
    try {
      expect(existsSync(dir)).toBe(false);
      const db = openDb({ server: { host: '', port: 0, dbPath: dbPath }, contextPolicy: { default: 'message_only' } });
      expect(existsSync(dir)).toBe(true);
      // confirm it is a usable db
      const tables = db.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table'").all();
      expect(tables.length).toBeGreaterThan(0);
      db.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
