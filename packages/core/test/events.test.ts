import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/events.js';
import type { AgentSquadEvent } from '../src/events.js';

describe('EventBus', () => {
  it('on() receives emit()ed events', () => {
    const bus = new EventBus();
    const cb = vi.fn();
    bus.on(cb);
    const e: AgentSquadEvent = { type: 'message_appended', payload: { session_id: 's1' } };
    bus.emit(e);
    expect(cb).toHaveBeenCalledWith(e);
  });
  it('on() returns an unsubscribe that stops further calls', () => {
    const bus = new EventBus();
    const cb = vi.fn();
    const unsub = bus.on(cb);
    unsub();
    bus.emit({ type: 'hello', payload: {} });
    expect(cb).not.toHaveBeenCalled();
  });
  it('multiple listeners all receive events', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on(a);
    bus.on(b);
    bus.emit({ type: 'session_created', payload: {} });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
  it('emit with no listeners does not throw', () => {
    const bus = new EventBus();
    expect(() => bus.emit({ type: 'hello', payload: {} })).not.toThrow();
  });
});
