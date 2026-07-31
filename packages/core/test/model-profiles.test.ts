import { describe, expect, it } from 'vitest';
import {
  mergeModelCapabilityProfiles,
  resolveModelCapabilityProfile,
} from '../src/model-profiles.js';

describe('model capability profiles', () => {
  it('merges broad and exact official profiles before user overrides', () => {
    const profile = resolveModelCapabilityProfile(
      'gpt-5.6-luna',
      {
        '*': {
          summary: 'official fallback',
          strengths: ['general coding'],
          weaknesses: ['generic'],
          costTier: 'unknown',
          effortProfiles: {
            max: { latencyTier: 'slow', priority: 70 },
          },
        },
        'gpt-*': {
          recommendedFor: ['implementation'],
          costTier: 'medium',
        },
        'gpt-5.6-luna': {
          summary: 'official luna',
          strengths: ['fast implementation'],
          latencyTier: 'fast',
        },
      },
      {
        '*': {
          latencyTier: 'medium',
        },
        'gpt-5.6-luna': {
          strengths: ['team-specific routine work'],
          effortProfiles: {
            max: { priority: 95 },
          },
        },
      },
    );

    expect(profile).toEqual({
      source: 'merged',
      summary: 'official luna',
      strengths: ['team-specific routine work'],
      weaknesses: ['generic'],
      recommendedFor: ['implementation'],
      costTier: 'medium',
      latencyTier: 'medium',
      effortProfiles: {
        max: { latencyTier: 'slow', priority: 95 },
      },
    });
  });

  it('reports a user-only profile and supports clearing inherited arrays', () => {
    expect(resolveModelCapabilityProfile(
      'custom/model',
      {},
      {
        '*': {
          strengths: [],
          recommendedFor: ['internal_task'],
        },
      },
    )).toEqual({
      source: 'user_override',
      strengths: [],
      recommendedFor: ['internal_task'],
    });
  });

  it('returns undefined when no profile pattern matches', () => {
    expect(resolveModelCapabilityProfile(
      'other-model',
      { 'gpt-*': { strengths: ['coding'] } },
    )).toBeUndefined();
  });

  it('deep-merges effort profiles without mutating either input', () => {
    const base = {
      strengths: ['base'],
      effortProfiles: { high: { latencyTier: 'slow' as const, priority: 70 } },
    };
    const overlay = {
      weaknesses: ['override'],
      effortProfiles: { high: { priority: 90 } },
    };

    expect(mergeModelCapabilityProfiles(base, overlay)).toEqual({
      strengths: ['base'],
      weaknesses: ['override'],
      effortProfiles: { high: { latencyTier: 'slow', priority: 90 } },
    });
    expect(base.effortProfiles.high.priority).toBe(70);
  });
});
