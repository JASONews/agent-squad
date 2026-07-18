export type WaitChoiceStatus = 'pending' | 'resolved' | 'cancelled' | 'expired';

export interface WaitChoiceResult {
  status: WaitChoiceStatus;
  selected?: string;
  rationale?: string;
}

type Resolver = (result: WaitChoiceResult) => void;

/**
 * In-process map of pending choice waits. A blocking `request_choice` / `wait_choice`
 * registers a Promise; `resolve_choice` (or cancel) wakes it. Single-process (the daemon
 * is one process). On daemon restart, in-flight waits are lost — but the choices row stays
 * `pending_main_agent` in the DB and a re-call of `wait_choice` recovers or times out.
 */
export class ChoicesWaiter {
  private readonly waiters = new Map<string, Resolver>();

  register(choiceId: string): Promise<WaitChoiceResult> {
    return new Promise<WaitChoiceResult>((resolve) => {
      this.waiters.set(choiceId, resolve);
    });
  }

  resolve(choiceId: string, result: WaitChoiceResult): void {
    const r = this.waiters.get(choiceId);
    if (r) {
      this.waiters.delete(choiceId);
      r(result);
    }
    // unknown choiceId: no-op (idempotent / late resolve)
  }

  cancel(choiceId: string): void {
    this.resolve(choiceId, { status: 'cancelled' });
  }
}
