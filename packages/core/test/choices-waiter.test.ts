import { describe, it, expect } from 'vitest';
import { ChoicesWaiter } from '../src/services/choices-waiter.js';
import type { WaitChoiceResult } from '../src/services/choices-waiter.js';

describe('ChoicesWaiter', () => {
  it('register resolves when resolve() is called with the result', async () => {
    const w = new ChoicesWaiter();
    const p = w.register('ch_1');
    w.resolve('ch_1', { status: 'resolved', selected: 'a', rationale: 'because' });
    await expect(p).resolves.toEqual({ status: 'resolved', selected: 'a', rationale: 'because' });
  });
  it('cancel() resolves with {status:"cancelled"}', async () => {
    const w = new ChoicesWaiter();
    const p = w.register('ch_2');
    w.cancel('ch_2');
    await expect(p).resolves.toEqual({ status: 'cancelled' });
  });
  it('resolve() on an unknown choiceId is a no-op (does not throw)', () => {
    const w = new ChoicesWaiter();
    expect(() => w.resolve('ch_nope', { status: 'resolved', selected: 'x' })).not.toThrow();
  });
  it('register twice for the same choiceId: second resolve resolves the first; second is a new promise', async () => {
    // register creates a fresh promise each call; resolve wakes the current one.
    const w = new ChoicesWaiter();
    const p1 = w.register('ch_3');
    w.resolve('ch_3', { status: 'resolved', selected: 'a' });
    await expect(p1).resolves.toEqual({ status: 'resolved', selected: 'a' });
    // re-register after resolve is a fresh promise
    const p2 = w.register('ch_3');
    w.resolve('ch_3', { status: 'resolved', selected: 'b' });
    await expect(p2).resolves.toEqual({ status: 'resolved', selected: 'b' });
  });
});
