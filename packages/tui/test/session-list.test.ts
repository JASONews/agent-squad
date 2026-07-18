import { describe, expect, it } from 'vitest';
import { formatLastActiveTime } from '../src/views/SessionList.js';

describe('formatLastActiveTime', () => {
  it('formats missing and recent timestamps for the session list', () => {
    const now = new Date('2026-07-05T10:10:00.000Z');
    expect(formatLastActiveTime(null, now)).toBe('-');
    expect(formatLastActiveTime('2026-07-05T10:09:35.000Z', now)).toBe('25s ago');
    expect(formatLastActiveTime('2026-07-05T10:05:00.000Z', now)).toBe('5m ago');
    expect(formatLastActiveTime('2026-07-05T08:00:00.000Z', now)).toBe('2h ago');
  });
});
