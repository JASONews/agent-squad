export type EventType =
  | 'session_created'
  | 'message_appended'
  | 'subagent_status'
  | 'subagent_output'
  | 'subagent_context'
  | 'subagent_blocked'
  | 'choice_created'
  | 'choice_resolved'
  | 'artifact_posted';

export interface AgentSquadEvent {
  type: EventType | 'hello';
  payload: Record<string, unknown>;
}

type Listener = (event: AgentSquadEvent) => void;

/** In-process event bus. Single-process, in-memory, synchronous dispatch.
 *  Created once in buildDaemon; threaded into services that emit state-change events. */
export class EventBus {
  private readonly listeners = new Set<Listener>();

  /** Subscribe to all events. Returns an unsubscribe function. */
  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  emit(event: AgentSquadEvent): void {
    for (const l of this.listeners) {
      try { l(event); } catch { /* listener errors must not break emit */ }
    }
  }
}
