import { join } from 'node:path';
import { z } from 'zod';

const ClaudeEnglishInputSchema = z.object({
  enabled: z.boolean().default(true),
  minimum_ratio: z.number().finite().min(0).max(1).default(0.6),
}).default({});

const SubagentsSchema = z.object({
  claude: z.object({
    english_input: ClaudeEnglishInputSchema,
  }).passthrough().default({}),
}).passthrough().default({});

export const ConfigSchema = z.object({
  server: z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().min(1).max(65535).default(28771),
    db_path: z.string().default('~/.agent-squad/agent-squad.db'),
  }).default({}),
  context_policy: z.object({
    default: z.enum(['message_only', 'with_refs', 'explicit_delta', 'receiver_pull', 'exact_payload', 'server_generated_summary']).default('message_only'),
  }).default({}),
  subagents: SubagentsSchema,
  choice_policy: z.record(z.string(), z.any()).optional(),
  security: z.record(z.string(), z.any()).optional(),
}).strict();

export type RawConfig = z.infer<typeof ConfigSchema>;

export interface ResolvedConfig {
  server: { host: string; port: number; dbPath: string };
  contextPolicy: { default: string };
  subagents?: {
    claude: {
      englishInput: {
        enabled: boolean;
        minimumRatio: number;
      };
    };
  };
}

export function resolveConfig(raw: RawConfig, home: string): ResolvedConfig {
  return {
    server: {
      host: raw.server.host,
      port: raw.server.port,
      dbPath: expandHome(raw.server.db_path, home),
    },
    contextPolicy: { default: raw.context_policy.default },
    subagents: {
      claude: {
        englishInput: {
          enabled: raw.subagents.claude.english_input.enabled,
          minimumRatio: raw.subagents.claude.english_input.minimum_ratio,
        },
      },
    },
  };
}

function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return join(home, p.slice(2));
  return p;
}
