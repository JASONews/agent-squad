import type { Db } from '../db/client.js';
import { newId } from '../ids.js';
import { mapSqliteError } from '../errors.js';
import type { Message, MessageKind } from '../types.js';
import type { EventBus } from '../events.js';

export interface AppendMessageInput {
  sessionId: string;
  fromPeerId?: string | null;
  toPeerId?: string | null;
  kind: MessageKind;
  content?: string | null;
  artifactRefs?: string[] | null;
}

export function appendMessage(db: Db, row: AppendMessageInput, bus?: EventBus): string {
  const id = newId('msg');
  const now = new Date().toISOString();
  try {
    db.prepare(
      'INSERT INTO messages (id, session_id, from_peer_id, to_peer_id, kind, content, artifact_refs, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).run(id, row.sessionId, row.fromPeerId ?? null, row.toPeerId ?? null, row.kind, row.content ?? null, row.artifactRefs ? JSON.stringify(row.artifactRefs) : null, now);
  } catch (e) {
    throw mapSqliteError(e, row.sessionId);
  }
  bus?.emit({ type: 'message_appended', payload: { message_id: id, session_id: row.sessionId, kind: row.kind, from_peer_id: row.fromPeerId ?? null, to_peer_id: row.toPeerId ?? null } });
  return id;
}

export function getMessages(db: Db, sessionId: string, opts: { subagentId?: string; limit?: number } = {}): Message[] {
  const limit = opts.limit ?? 500;
  if (opts.subagentId) {
    return db.prepare<{ session_id: string; sub_id: string; limit: number }, Message>(
      `SELECT id, session_id, from_peer_id, to_peer_id, kind, content, artifact_refs, created_at
       FROM (
         SELECT rowid, * FROM messages
         WHERE session_id=@session_id AND (from_peer_id=@sub_id OR to_peer_id=@sub_id)
         ORDER BY rowid DESC
         LIMIT @limit
       )
       ORDER BY rowid ASC`
    ).all({ session_id: sessionId, sub_id: opts.subagentId, limit });
  }
  return db.prepare<{ session_id: string; limit: number }, Message>(
    `SELECT id, session_id, from_peer_id, to_peer_id, kind, content, artifact_refs, created_at
     FROM (
       SELECT rowid, * FROM messages
       WHERE session_id=@session_id
       ORDER BY rowid DESC
       LIMIT @limit
     )
     ORDER BY rowid ASC`
  ).all({ session_id: sessionId, limit });
}
