import { describe, expect, it } from 'vitest';
import { injectInstruction } from '../../src/shared/subagent-context.js';

describe('injectInstruction', () => {
  it('adds the subagent protocol without triggering Codex skill auto-load', () => {
    const message = 'Review packages/core/src/services/subagents.ts and report findings.';

    const prompt = injectInstruction(message);

    expect(prompt).toMatch(/^Subagent coordination protocol:/);
    expect(prompt).not.toContain('[agent-squad]');
    expect(prompt).toContain('%%AGENT_SQUAD_CHOICE%%');
    expect(prompt).toContain('Subagent task:');
    expect(prompt).toContain(message);
  });
});
