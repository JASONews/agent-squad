import type { Db } from '../db/client.js';
import { newId } from '../ids.js';
import { AppError, mapSqliteError } from '../errors.js';
import type { Artifact } from '../types.js';
import type { EventBus } from '../events.js';

export interface PostArtifactInput {
  sessionId: string;
  producerPeerId?: string | null;
  kind: string;
  content: string;
  path?: string;
  metadata?: Record<string, unknown> | null;
}
export interface PostArtifactResult { artifactId: string }

export function postArtifact(db: Db, input: PostArtifactInput, bus?: EventBus): PostArtifactResult {
  const id = newId('art');
  const now = new Date().toISOString();
  try {
    db.prepare(
      'INSERT INTO artifacts (id, session_id, producer_peer_id, kind, path, content, metadata_json, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).run(id, input.sessionId, input.producerPeerId ?? null, input.kind, input.path ?? null, input.content, input.metadata ? JSON.stringify(input.metadata) : null, now);
  } catch (e) {
    throw mapSqliteError(e, input.sessionId);
  }
  bus?.emit({ type: 'artifact_posted', payload: { artifact_id: id, session_id: input.sessionId, kind: input.kind } });
  return { artifactId: id };
}

export function getArtifact(db: Db, artifactId: string): Artifact {
  const row = db.prepare<[string], Artifact>('SELECT * FROM artifacts WHERE id=?').get(artifactId);
  if (!row) throw new AppError('artifact_not_found', `artifact not found: ${artifactId}`);
  return row;
}
