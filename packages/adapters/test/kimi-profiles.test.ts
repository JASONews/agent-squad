import { describe, expect, it } from 'vitest';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import { resolveProfile, selectPermissionResponse } from '../src/kimi/profiles.js';

function request(): RequestPermissionRequest {
  return {
    sessionId: 'session-1',
    toolCall: { toolCallId: 'tool-1', title: 'Test tool' },
    options: [
      { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
      { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
    ],
  };
}

describe('Kimi permission profiles', () => {
  it('defaults to kimi_auto and selects allow_once', () => {
    const response = selectPermissionResponse(resolveProfile(), request());
    expect(resolveProfile().name).toBe('kimi_auto');
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'allow-once' });
  });

  it('readonly rejects every prompted operation when Kimi omits a reliable tool kind', () => {
    expect(selectPermissionResponse(resolveProfile('kimi_readonly'), request()).outcome)
      .toEqual({ outcome: 'selected', optionId: 'reject-once' });
  });

  it('returns cancelled when the required decision is not offered', () => {
    const permission = request();
    permission.options = permission.options.filter((option) => option.kind.startsWith('allow'));
    expect(selectPermissionResponse(resolveProfile('kimi_readonly'), permission).outcome)
      .toEqual({ outcome: 'cancelled' });
  });

  it('rejects an unknown profile', () => {
    expect(() => resolveProfile('bogus')).toThrowError(/unknown kimi permission profile/);
  });
});
