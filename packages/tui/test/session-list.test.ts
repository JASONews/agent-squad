import { describe, expect, it } from 'vitest';
import { formatLastActiveTime, sortSessionIdsByActivity } from '../src/views/SessionList.js';

describe('formatLastActiveTime', () => {
  it('formats missing and recent timestamps for the session list', () => {
    const now = new Date('2026-07-05T10:10:00.000Z');
    expect(formatLastActiveTime(null, now)).toBe('-');
    expect(formatLastActiveTime('2026-07-05T10:09:35.000Z', now)).toBe('25s ago');
    expect(formatLastActiveTime('2026-07-05T10:05:00.000Z', now)).toBe('5m ago');
    expect(formatLastActiveTime('2026-07-05T08:00:00.000Z', now)).toBe('2h ago');
  });

  it('orders the most recently active sessions first', () => {
    expect(sortSessionIdsByActivity({
      older: { id: 'older', task: 'old', lastActiveAt: '2026-07-05T09:00:00.000Z' },
      missing: { id: 'missing', task: 'unknown', lastActiveAt: null },
      latest: { id: 'latest', task: 'new', lastActiveAt: '2026-07-05T10:00:00.000Z' },
    })).toEqual(['latest', 'older', 'missing']);
  });
});
