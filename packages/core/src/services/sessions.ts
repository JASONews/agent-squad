import type { Db } from '../db/client.js';
import { newId } from '../ids.js';
import { appendMessage } from './messages.js';
import type { EventBus } from '../events.js';

export interface StartSessionInput { cwd: string; task: string; ownerCli?: string; ownerNativeSessionId?: string }
export interface StartSessionResult { sessionId: string }

export function startSession(db: Db, input: StartSessionInput, bus?: EventBus): StartSessionResult {
  const sessionId = newId('sess');
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO sessions (id, root_task, repo_path, main_peer_id, created_at, updated_at) VALUES (?,?,?,?,?,?)'
  ).run(sessionId, input.task, input.cwd, input.ownerCli ?? 'claude_code', now, now);
  appendMessage(db, { sessionId, kind: 'user_task', content: input.task });
  bus?.emit({ type: 'session_created', payload: { session_id: sessionId, task: input.task } });
  return { sessionId };
}
