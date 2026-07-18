import { McpServer } from '@modelcontextprotocol/server';
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { httpGet, httpPost } from './client.js';

const text = (s: string) => ({ type: 'text' as const, text: s });

// zod/v4 implements the standard-schema + jsonSchema interfaces at runtime, but its
// TS types don't structurally match the SDK's `StandardSchemaWithJSON` constraint
// (the `~standard.jsonSchema` property isn't visible to the compiler). The schemas
// validate and convert to JSON schema correctly at runtime, so we bridge the gap here.
function schema(s: z.ZodType): StandardSchemaWithJSON {
  return s as unknown as StandardSchemaWithJSON;
}

// Wrap a thrown error as an MCP tool error result.
function toolError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [text(msg)], isError: true };
}

function ok(result: unknown) {
  const response: { content: ReturnType<typeof text>[]; structuredContent?: unknown } = {
    content: [text(JSON.stringify(result))],
  };
  if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
    response.structuredContent = result;
  }
  return response;
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'agent-squad', version: '0.1.3' });

  const startSessionSchema = z.object({
    cwd: z.string(),
    task: z.string(),
    owner_cli: z.string().optional(),
    owner_native_session_id: z.string().optional(),
  });
  server.registerTool(
    'start_session',
    {
      description: 'Start an agent-squad root session',
      inputSchema: schema(startSessionSchema),
    },
    async (args) => {
      try {
        const parsed = startSessionSchema.parse(args);
        const r = await httpPost<{ session_id: string }>('/v1/sessions', parsed);
        return ok(r);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    'list_subagent_types',
    {
      description: 'List available subagent CLI types',
      inputSchema: schema(z.object({})),
    },
    async () => {
      try {
        const r = await httpGet<unknown>('/v1/subagent-types');
        return ok(r);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  const spawnSchema = z.object({
    session_id: z.string(),
    alias: z.string(),
    cli: z.string(),
    role: z.string(),
    cwd: z.string().optional(),
    message: z.string(),
    permission_profile: z.string().optional(),
    model: z.string().optional(),
    reasoning_effort: z.string().optional(),
  });
  server.registerTool(
    'spawn_subagent',
    {
      description: 'Spawn a helper subagent in a session',
      inputSchema: schema(spawnSchema),
    },
    async (args) => {
      try {
        const a = spawnSchema.parse(args);
        const r = await httpPost<{ subagent_id: string; alias: string; native_session_id?: string; status: string }>(
          `/v1/sessions/${a.session_id}/subagents`,
          {
            alias: a.alias,
            cli: a.cli,
            role: a.role,
            cwd: a.cwd,
            message: a.message,
            permission_profile: a.permission_profile,
            model: a.model,
            reasoning_effort: a.reasoning_effort,
          },
        );
        return ok(r);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  const sendSchema = z.object({
    session_id: z.string(),
    alias: z.string().optional(),
    subagent_id: z.string().optional(),
    message: z.string(),
    wait: z.boolean().optional(),
    soft_timeout_ms: z.number().int().positive().optional(),
    hard_timeout_ms: z.number().int().positive().optional(),
  });
  server.registerTool(
    'send_to_subagent',
    {
      description: 'Send a message to a subagent; by default waits briefly for its reply. If status is "running", the subagent is still working in the background; call wait_subagent instead of sending another message.',
      inputSchema: schema(sendSchema),
    },
    async (args) => {
      try {
        const a = sendSchema.parse(args);
        const ref = a.subagent_id ?? a.alias;
        if (!ref) return toolError(new Error('alias or subagent_id required'));
        const r = await httpPost<{ message_id: string; status: string; reply?: string; artifacts?: unknown[]; raw_tail?: string; choice_requested?: boolean; choice?: unknown; choices?: unknown[] }>(
          `/v1/sessions/${a.session_id}/subagents/${ref}/messages`,
          {
            message: a.message,
            wait: a.wait ?? true,
            alias: a.alias,
            soft_timeout_ms: a.soft_timeout_ms,
            hard_timeout_ms: a.hard_timeout_ms,
          },
        );
        return ok(r);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  const waitSubagentSchema = z.object({
    session_id: z.string(),
    alias: z.string().optional(),
    subagent_id: z.string().optional(),
    after_message_id: z.string().optional(),
    timeout_ms: z.number().int().positive().optional(),
  });
  server.registerTool(
    'wait_subagent',
    {
      description: 'Wait for a running subagent to produce its next result without sending another message. Default timeout is 300s; timeout_ms is capped at 300s. Returns completed, choice_requested, failed, timeout, or running if the wait expires.',
      inputSchema: schema(waitSubagentSchema),
    },
    async (args) => {
      try {
        const a = waitSubagentSchema.parse(args);
        const ref = a.subagent_id ?? a.alias;
        if (!ref) return toolError(new Error('alias or subagent_id required'));
        const r = await httpPost<{ message_id?: string; status: string; reply?: string; artifacts?: unknown[]; raw_tail?: string; choice_requested?: boolean; choice?: unknown; choices?: unknown[] }>(
          `/v1/sessions/${a.session_id}/subagents/${ref}/wait`,
          {
            alias: a.alias,
            subagent_id: a.subagent_id,
            after_message_id: a.after_message_id,
            timeout_ms: a.timeout_ms,
          },
        );
        return ok(r);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  const getMessagesSchema = z.object({
    session_id: z.string(),
    alias: z.string().optional(),
    subagent_id: z.string().optional(),
    limit: z.number().optional(),
  });
  server.registerTool(
    'get_subagent_messages',
    {
      description: 'Return the message timeline for a session or subagent',
      inputSchema: schema(getMessagesSchema),
    },
    async (args) => {
      try {
        const a = getMessagesSchema.parse(args);
        const qs = new URLSearchParams();
        if (a.subagent_id) qs.set('subagent_id', a.subagent_id);
        if (a.limit) qs.set('limit', String(a.limit));
        const r = await httpGet<unknown>(`/v1/sessions/${a.session_id}/messages${qs.toString() ? `?${qs}` : ''}`);
        return ok(r);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  const postArtifactSchema = z.object({
    session_id: z.string(),
    producer_peer_id: z.string().optional(),
    kind: z.string(),
    content: z.string(),
    path: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  });
  server.registerTool(
    'post_artifact',
    {
      description: 'Post an artifact produced by a peer',
      inputSchema: schema(postArtifactSchema),
    },
    async (args) => {
      try {
        const a = postArtifactSchema.parse(args);
        const r = await httpPost<{ artifact_id: string }>(`/v1/sessions/${a.session_id}/artifacts`, a);
        return ok(r);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  const getArtifactSchema = z.object({ artifact_id: z.string() });
  server.registerTool(
    'get_artifact',
    {
      description: 'Fetch a stored artifact by id',
      inputSchema: schema(getArtifactSchema),
    },
    async (args) => {
      try {
        const a = getArtifactSchema.parse(args);
        const r = await httpGet<unknown>(`/v1/artifacts/${a.artifact_id}`);
        return ok(r);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  const requestChoiceSchema = z.object({
    session_id: z.string().min(1).optional(),
    subagent_id: z.string().min(1).optional(),
    question: z.string().min(1),
    options: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), tradeoff: z.string().optional() })).min(1),
    recommendation: z.object({ option_id: z.string().min(1), reason: z.string().min(1), confidence: z.enum(['low', 'medium', 'high']).optional() }).optional(),
    blocking: z.boolean(),
    timeout_ms: z.number().int().positive().optional(),
  });
  server.registerTool('request_choice', {
    description: 'Subagent asks the main agent/user to make a non-permission business choice. session_id and subagent_id are auto-filled from the agent-squad environment — you do not need to provide them.',
    inputSchema: schema(requestChoiceSchema),
  }, async (args) => {
    try {
      const a = requestChoiceSchema.parse(args);
      const sessionId = a.session_id ?? process.env.AGENT_SQUAD_SESSION_ID;
      const subagentId = a.subagent_id ?? process.env.AGENT_SQUAD_SUBAGENT_ID;
      if (!sessionId || !subagentId) {
        return toolError(new Error('session_id and subagent_id are required (set via AGENT_SQUAD_SESSION_ID/AGENT_SQUAD_SUBAGENT_ID env vars by the adapter, or pass explicitly)'));
      }
      const r = await httpPost<{ choice_id: string; status: string; selected?: string; rationale?: string }>(
        `/v1/sessions/${sessionId}/choices`,
        {
          subagent_id: subagentId, question: a.question, options: a.options,
          recommendation: a.recommendation, blocking: a.blocking, timeout_ms: a.timeout_ms,
        },
      );
      return ok(r);
    } catch (e) { return toolError(e); }
  });

  const resolveChoiceSchema = z.object({
    session_id: z.string().min(1).optional(),
    choice_id: z.string().min(1),
    selected: z.string().min(1),
    rationale: z.string().optional(),
  });
  server.registerTool('resolve_choice', {
    description: 'Main agent returns the user-selected option to a pending choice',
    inputSchema: schema(resolveChoiceSchema),
  }, async (args) => {
    try {
      const a = resolveChoiceSchema.parse(args);
      const sessionId = a.session_id ?? process.env.AGENT_SQUAD_SESSION_ID;
      if (!sessionId) {
        return toolError(new Error('session_id is required (auto-filled from AGENT_SQUAD_SESSION_ID env var, or pass explicitly)'));
      }
      const r = await httpPost<{ status: string }>(`/v1/sessions/${sessionId}/choices/${a.choice_id}/resolve`, { selected: a.selected, rationale: a.rationale });
      return ok(r);
    } catch (e) { return toolError(e); }
  });

  const waitChoiceSchema = z.object({
    session_id: z.string().min(1).optional(),
    choice_id: z.string().min(1),
    timeout_ms: z.number().int().positive().optional(),
  });
  server.registerTool('wait_choice', {
    description: 'Subagent blocks until a choice is resolved, cancelled, or the wait times out. session_id is auto-filled from the agent-squad environment.',
    inputSchema: schema(waitChoiceSchema),
  }, async (args) => {
    try {
      const a = waitChoiceSchema.parse(args);
      const sessionId = a.session_id ?? process.env.AGENT_SQUAD_SESSION_ID;
      if (!sessionId) {
        return toolError(new Error('session_id is required (auto-filled from AGENT_SQUAD_SESSION_ID env var by the adapter, or pass explicitly)'));
      }
      const r = await httpPost<{ status: string; selected?: string; rationale?: string }>(
        `/v1/sessions/${sessionId}/choices/${a.choice_id}/wait`, { timeout_ms: a.timeout_ms },
      );
      return ok(r);
    } catch (e) { return toolError(e); }
  });

  return server;
}

export async function runStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await buildServer().connect(transport);
}
