import { z } from 'zod';

export const StartSessionSchema = z.object({
  cwd: z.string().min(1),
  task: z.string().min(1),
  owner_cli: z.string().optional(),
  owner_native_session_id: z.string().optional(),
});

export const SpawnSubagentSchema = z.object({
  alias: z.string().min(1),
  cli: z.string().min(1),
  role: z.string().min(1),
  cwd: z.string().optional(),
  message: z.string().min(1),
  permission_profile: z.string().optional(),
  model: z.string().min(1).optional(),
  reasoning_effort: z.string().min(1).optional(),
});

export const SendToSubagentBodySchema = z.object({
  message: z.string().min(1),
  wait: z.boolean().optional(),
  soft_timeout_ms: z.number().int().positive().optional(),
  hard_timeout_ms: z.number().int().positive().optional(),
  alias: z.string().optional(),
  subagent_id: z.string().optional(),
});

export const WaitSubagentBodySchema = z.object({
  timeout_ms: z.number().int().positive().optional(),
  after_message_id: z.string().optional(),
  after_output_event_count: z.number().int().nonnegative().optional(),
  alias: z.string().optional(),
  subagent_id: z.string().optional(),
});

export const InspectSubagentQuerySchema = z.object({
  after_output_event_count: z.coerce.number().int().nonnegative().optional(),
  alias: z.string().min(1).optional(),
  subagent_id: z.string().min(1).optional(),
});

export const ListSubagentTypesQuerySchema = z.object({
  cwd: z.string().min(1).optional(),
});

export const PostArtifactSchema = z.object({
  producer_peer_id: z.string().optional(),
  kind: z.string().min(1),
  content: z.string(),
  path: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
