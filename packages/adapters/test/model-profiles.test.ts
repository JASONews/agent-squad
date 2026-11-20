import { describe, expect, it } from 'vitest';
import { resolveModelCapabilityProfile, type CliAdapter } from '@agent-squad/core';
import { CodexAdapter } from '../src/codex/adapter.js';
import { OpencodeAdapter } from '../src/opencode/adapter.js';
import { AntigravityAdapter } from '../src/antigravity/adapter.js';
import { ClaudeAdapter } from '../src/claude/adapter.js';
import { KimiAdapter } from '../src/kimi/adapter.js';
import { OFFICIAL_MODEL_PROFILE_CATALOG_VERSION } from '../src/model-profiles.js';

describe('official model capability profiles', () => {
  it('maintains a versioned catalog without profiling unknown models speculatively', () => {
    expect(OFFICIAL_MODEL_PROFILE_CATALOG_VERSION).toBeGreaterThan(0);
    expect(resolveModelCapabilityProfile(
      'unlisted-model',
      new CodexAdapter().modelProfiles,
    )).toBeUndefined();
  });

  it('describes recommended models across dynamic CLI catalogs', () => {
    const cases: Array<[CliAdapter, string]> = [
      [new CodexAdapter(), 'gpt-5.6-luna'],
      [new CodexAdapter(), 'gpt-6.2-sol'],
      [new CodexAdapter(), 'gpt-6.2-astra'],
      [new CodexAdapter(), 'gpt-6.1-terra'],
      [new OpencodeAdapter(), 'openai/gpt-5.6-luna'],
      [new AntigravityAdapter(), 'gemini-3.6-flash-high'],
      [new AntigravityAdapter(), 'gemini-4-neon-xhigh'],
      [new AntigravityAdapter(), 'claude-sonnet-5-5-high'],
      [new ClaudeAdapter(), 'default'],
      [new ClaudeAdapter(), 'fable'],
      [new KimiAdapter(), 'kimi-k2.5'],
    ];

    for (const [adapter, modelId] of cases) {
      const profile = resolveModelCapabilityProfile(modelId, adapter.modelProfiles);
      expect(profile?.summary).toBeTruthy();
      expect(profile?.recommendedFor?.length).toBeGreaterThan(0);
      expect(profile?.priority).toBeGreaterThan(0);
    }
  });

  it('keeps user overrides separate so they apply after official defaults', () => {
    const adapter = new CodexAdapter({
      modelProfileOverrides: {
        'gpt-5.6-luna': {
          strengths: ['project-specific migrations'],
          priority: 99,
        },
      },
    });

    expect(resolveModelCapabilityProfile(
      'gpt-5.6-luna',
      adapter.modelProfiles,
      adapter.modelProfileOverrides,
    )).toMatchObject({
      source: 'merged',
      strengths: ['project-specific migrations'],
      priority: 99,
      costTier: 'low',
    });
  });
});
