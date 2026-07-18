import Database from 'better-sqlite3';
import type { Database as SqliteDatabase, Statement } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATION_V1, MIGRATION_V2, TARGET_VERSION } from './migrations.js';
import type { ResolvedConfig } from '../config/schema.js';

export class Db {
  constructor(private readonly sqlite: SqliteDatabase) {}
  migrate(): void {
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
    const current = this.sqlite.pragma('user_version', { simple: true }) as number;
    if (current < 1) {
      this.sqlite.exec(MIGRATION_V1);
    }
    if (current < 2) {
      this.sqlite.exec(MIGRATION_V2);
    }
    this.sqlite.pragma(`user_version = ${TARGET_VERSION}`);
  }
  prepare<Params extends unknown[] | {} = unknown[], Row = unknown>(sql: string): Statement<Params, Row> {
    return this.sqlite.prepare(sql) as Statement<Params, Row>;
  }
  exec(sql: string): void { this.sqlite.exec(sql); }
  close(): void { this.sqlite.close(); }
  get raw(): SqliteDatabase { return this.sqlite; }
}

export function openDb(config: ResolvedConfig): Db {
  const path = config.server.dbPath;
  if (path !== ':memory:') {
    // Ensure the parent directory exists (default db_path is ~/.agent-squad/agent-squad.db,
    // whose directory does not exist on first run).
    mkdirSync(dirname(path), { recursive: true });
  }
  const sqlite = new Database(path);
  if (path !== ':memory:') {
    try { sqlite.pragma('journal_mode = WAL'); } catch { /* memory ignores */ }
  }
  const db = new Db(sqlite);
  db.migrate();
  return db;
}
