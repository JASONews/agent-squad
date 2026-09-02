import { randomUUID } from 'node:crypto';
import type {
  CliAdapter, DetectResult, AdapterCapabilities,
  SpawnInput, SubagentHandle, SendInput, SendResult, ArtifactInput,
} from './types.js';

export class MockAdapter implements CliAdapter {
  readonly cliType = 'mock' as const;
  readonly roles = ['reviewer', 'implementer', 'tester'];
  readonly strengths = 'Test adapter for development — returns canned replies.';
  readonly weaknesses = 'Not a real CLI — for testing only.';

  async detect(): Promise<DetectResult> {
    return { available: true, version: 'mock-0.1' };
  }
  capabilities(): AdapterCapabilities {
    return { mcp: true, plugin: true, headless: true, resume: true, persistentServer: true, autoApprove: true, structuredOutput: true };
  }

  async spawnSubagent(input: SpawnInput): Promise<SubagentHandle> {
    return {
      subagentId: input.subagentId,
      nativeSessionId: `mock_${randomUUID()}`,
      status: 'ready',
    };
  }

  async send(input: SendInput): Promise<SendResult> {
    if (!input.wait) return { status: 'running' };
    const msg = input.message.toLowerCase();
    if (msg.includes('[block]')) {
      return {
        status: 'native_cli_blocked',
        rawTail: '[mock] native CLI is waiting for permission approval\n> _',
      };
    }
    if (msg.includes('review')) {
      return {
        status: 'completed',
        reply: 'Mock review: 1 blocker, 2 nits. Mainly check error handling in the new module.',
        artifacts: [reviewJsonArtifact()],
      };
    }
    if (msg.includes('ui') || msg.includes('design')) {
      return {
        status: 'completed',
        reply: 'Mock UI patch produced for the settings page.',
        artifacts: [{ kind: 'patch', path: 'ui.patch', content: 'diff --git a/ui/settings.tsx b/ui/settings.tsx\n+export function SettingsPage() {...}' }],
      };
    }
    return { status: 'completed', reply: `Completed: ${input.message}` };
  }
}

function reviewJsonArtifact(): ArtifactInput {
  return {
    kind: 'review_json',
    content: JSON.stringify({
      summary: 'mock review',
      findings: [
        { severity: 'blocker', file: 'src/index.ts', message: 'missing error handler' },
        { severity: 'nit', file: 'src/index.ts', message: 'rename foo' },
      ],
    }),
  };
}
