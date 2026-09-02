import { join } from 'node:path';
import { z } from 'zod';
import type {
  ModelCapabilityDetails,
  ModelCapabilityProfile,
  ModelProfileCatalog,
} from '../adapters/types.js';

const ClaudeEnglishInputSchema = z.object({
  enabled: z.boolean().default(true),
  minimum_ratio: z.number().finite().min(0).max(1).default(0.6),
}).default({});

const ModelCapabilityDetailsSchema = z.object({
  summary: z.string().min(1).optional(),
  strengths: z.array(z.string().min(1)).optional(),
  weaknesses: z.array(z.string().min(1)).optional(),
  recommended_for: z.array(z.string().min(1)).optional(),
  avoid_for: z.array(z.string().min(1)).optional(),
  cost_tier: z.enum(['low', 'medium', 'high', 'unknown']).optional(),
  latency_tier: z.enum(['fast', 'medium', 'slow', 'unknown']).optional(),
  priority: z.number().int().min(0).max(100).optional(),
}).strict();

const ModelCapabilityProfileSchema = ModelCapabilityDetailsSchema.extend({
  effort_profiles: z.record(z.string().min(1), ModelCapabilityDetailsSchema).optional(),
}).strict();

const ModelProfilesSchema = z.record(
  z.string().min(1),
  ModelCapabilityProfileSchema,
).default({});

const SubagentModelConfigSchema = z.object({
  model_profiles: ModelProfilesSchema,
}).passthrough().default({});

const SubagentsSchema = z.object({
  codex: SubagentModelConfigSchema,
  opencode: SubagentModelConfigSchema,
  antigravity: SubagentModelConfigSchema,
  claude: z.object({
    english_input: ClaudeEnglishInputSchema,
    model_profiles: ModelProfilesSchema,
  }).passthrough().default({}),
  kimi: SubagentModelConfigSchema,
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

export interface ResolvedSubagentModelConfig {
  modelProfiles: ModelProfileCatalog;
}

export interface ResolvedConfig {
  server: { host: string; port: number; dbPath: string };
  contextPolicy: { default: string };
  subagents?: {
    codex: ResolvedSubagentModelConfig;
    opencode: ResolvedSubagentModelConfig;
    antigravity: ResolvedSubagentModelConfig;
    claude: ResolvedSubagentModelConfig & {
      englishInput: {
        enabled: boolean;
        minimumRatio: number;
      };
    };
    kimi: ResolvedSubagentModelConfig;
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
      codex: {
        modelProfiles: resolveModelProfileCatalog(raw.subagents.codex.model_profiles),
      },
      opencode: {
        modelProfiles: resolveModelProfileCatalog(raw.subagents.opencode.model_profiles),
      },
      antigravity: {
        modelProfiles: resolveModelProfileCatalog(raw.subagents.antigravity.model_profiles),
      },
      claude: {
        englishInput: {
          enabled: raw.subagents.claude.english_input.enabled,
          minimumRatio: raw.subagents.claude.english_input.minimum_ratio,
        },
        modelProfiles: resolveModelProfileCatalog(raw.subagents.claude.model_profiles),
      },
      kimi: {
        modelProfiles: resolveModelProfileCatalog(raw.subagents.kimi.model_profiles),
      },
    },
  };
}

type RawModelCapabilityDetails = z.infer<typeof ModelCapabilityDetailsSchema>;
type RawModelCapabilityProfile = z.infer<typeof ModelCapabilityProfileSchema>;

function resolveModelCapabilityDetails(raw: RawModelCapabilityDetails): ModelCapabilityDetails {
  return {
    ...(raw.summary === undefined ? {} : { summary: raw.summary }),
    ...(raw.strengths === undefined ? {} : { strengths: [...raw.strengths] }),
    ...(raw.weaknesses === undefined ? {} : { weaknesses: [...raw.weaknesses] }),
    ...(raw.recommended_for === undefined ? {} : { recommendedFor: [...raw.recommended_for] }),
    ...(raw.avoid_for === undefined ? {} : { avoidFor: [...raw.avoid_for] }),
    ...(raw.cost_tier === undefined ? {} : { costTier: raw.cost_tier }),
    ...(raw.latency_tier === undefined ? {} : { latencyTier: raw.latency_tier }),
    ...(raw.priority === undefined ? {} : { priority: raw.priority }),
  };
}

function resolveModelCapabilityProfile(raw: RawModelCapabilityProfile): ModelCapabilityProfile {
  const effortProfiles = raw.effort_profiles === undefined
    ? undefined
    : Object.fromEntries(Object.entries(raw.effort_profiles).map(([effort, details]) => [
        effort,
        resolveModelCapabilityDetails(details),
      ]));
  return {
    ...resolveModelCapabilityDetails(raw),
    ...(effortProfiles === undefined ? {} : { effortProfiles }),
  };
}

function resolveModelProfileCatalog(
  raw: Record<string, RawModelCapabilityProfile>,
): ModelProfileCatalog {
  return Object.fromEntries(Object.entries(raw).map(([pattern, profile]) => [
    pattern,
    resolveModelCapabilityProfile(profile),
  ]));
}

function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return join(home, p.slice(2));
  return p;
}
