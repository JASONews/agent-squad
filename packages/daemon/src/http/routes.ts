import type { FastifyInstance } from 'fastify';
import type { Db, AdapterRegistry, ChoicesService, EventBus, AgentSquadEvent } from '@agent-squad/core';
import {
  AGENT_SQUAD_VERSION,
  startSession, spawnSubagent, sendToSubagent, waitForSubagent, getMessages,
  postArtifact, getArtifact, listSubagentTypes,
  StartSessionSchema, SpawnSubagentSchema, SendToSubagentBodySchema, WaitSubagentBodySchema, PostArtifactSchema,
} from '@agent-squad/core';
import { sendAppError, zodToAppError } from './errors.js';

function healthCheckDb(db: Db): boolean {
  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

export function registerRoutes(app: FastifyInstance, deps: { db: Db; registry: AdapterRegistry; choices: ChoicesService; bus: EventBus }): void {
  const { db, registry, choices, bus } = deps;

  app.get('/v1/health', async () => ({ ok: true, version: AGENT_SQUAD_VERSION, db_ok: healthCheckDb(db) }));

  app.get('/v1/sessions', async (_req, reply) => {
    try {
      const rows = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
      return reply.send({ sessions: rows });
    } catch (e) { return sendAppError(reply, e); }
  });

  app.post('/v1/sessions', async (req, reply) => {
    try {
      const parsed = StartSessionSchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(reply, zodToAppError(parsed.error));
      const b = parsed.data;
      const res = startSession(db, { cwd: b.cwd, task: b.task, ownerCli: b.owner_cli, ownerNativeSessionId: b.owner_native_session_id }, bus);
      return reply.send({ session_id: res.sessionId });
    } catch (e) { return sendAppError(reply, e); }
  });

  app.get('/v1/subagent-types', async (_req, reply) => {
    try { return reply.send(await listSubagentTypes(db, registry)); }
    catch (e) { return sendAppError(reply, e); }
  });

  app.post('/v1/sessions/:id/subagents', async (req, reply) => {
    try {
      const p = req.params as { id: string };
      const parsed = SpawnSubagentSchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(reply, zodToAppError(parsed.error));
      const b = parsed.data;
      const res = await spawnSubagent(db, registry, {
        sessionId: p.id, alias: b.alias, cli: b.cli, role: b.role,
        cwd: b.cwd, message: b.message, permissionProfile: b.permission_profile,
        model: b.model, reasoningEffort: b.reasoning_effort,
      }, bus);
      return reply.send({ subagent_id: res.subagentId, alias: res.alias, native_session_id: res.nativeSessionId, status: res.status });
    } catch (e) { return sendAppError(reply, e); }
  });

  app.get('/v1/sessions/:id/subagents', async (req, reply) => {
    try {
      const p = req.params as { id: string };
      const rows = db.prepare<{ session_id: string }, {
        id: string; alias: string; cli_type: string; role: string; status: string;
        native_session_id: string | null; cwd: string | null; model: string | null;
        reasoning_effort: string | null; last_seen_at: string; context_summary: string | null;
      }>('SELECT id, alias, cli_type, role, status, native_session_id, cwd, model, reasoning_effort, last_seen_at, context_summary FROM subagents WHERE session_id=@session_id ORDER BY last_seen_at ASC')
        .all({ session_id: p.id });
      return reply.send({
        subagents: rows.map((row) => ({
          id: row.id,
          alias: row.alias,
          cli_type: row.cli_type,
          role: row.role,
          status: row.status,
          native_session_id: row.native_session_id,
          cwd: row.cwd,
          model: row.model,
          reasoning_effort: row.reasoning_effort,
          last_seen_at: row.last_seen_at,
          raw_tail: row.context_summary,
        })),
      });
    } catch (e) { return sendAppError(reply, e); }
  });

  app.post('/v1/sessions/:id/subagents/:ref/messages', async (req, reply) => {
    try {
      const p = req.params as { id: string; ref: string };
      const parsed = SendToSubagentBodySchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(reply, zodToAppError(parsed.error));
      const b = parsed.data;
      const subagentId = p.ref.startsWith('sub_') ? p.ref : undefined;
      const alias = subagentId ? undefined : (b.alias ?? p.ref);
      const res = await sendToSubagent(db, registry, {
        sessionId: p.id, alias, subagentId, message: b.message, wait: b.wait ?? true,
        softTimeoutMs: b.soft_timeout_ms,
        hardTimeoutMs: b.hard_timeout_ms,
      }, bus);
      const choice = res.choice ? {
        choice_id: res.choice.choiceId,
        question: res.choice.question,
        options: res.choice.options,
        recommendation: res.choice.recommendation ?? null,
      } : undefined;
      const choices = res.choices?.map((choice) => ({
        choice_id: choice.choiceId,
        question: choice.question,
        options: choice.options,
        recommendation: choice.recommendation ?? null,
      }));
      return reply.send({
        message_id: res.messageId, status: res.status, reply: res.reply,
        artifacts: res.artifacts, raw_tail: res.rawTail,
        choice_requested: res.choiceRequested,
        choice,
        choices,
      });
    } catch (e) { return sendAppError(reply, e); }
  });

  app.post('/v1/sessions/:id/subagents/:ref/wait', async (req, reply) => {
    try {
      const p = req.params as { id: string; ref: string };
      const parsed = WaitSubagentBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return sendAppError(reply, zodToAppError(parsed.error));
      const b = parsed.data;
      const subagentId = p.ref.startsWith('sub_') ? p.ref : undefined;
      const alias = subagentId ? undefined : (b.alias ?? p.ref);
      const res = await waitForSubagent(db, {
        sessionId: p.id,
        alias,
        subagentId: subagentId ?? b.subagent_id,
        afterMessageId: b.after_message_id,
        timeoutMs: b.timeout_ms,
      }, bus);
      const choice = res.choice ? {
        choice_id: res.choice.choiceId,
        question: res.choice.question,
        options: res.choice.options,
        recommendation: res.choice.recommendation ?? null,
      } : undefined;
      const choices = res.choices?.map((choice) => ({
        choice_id: choice.choiceId,
        question: choice.question,
        options: choice.options,
        recommendation: choice.recommendation ?? null,
      }));
      return reply.send({
        message_id: res.messageId, status: res.status, reply: res.reply,
        artifacts: res.artifacts, raw_tail: res.rawTail,
        choice_requested: res.choiceRequested,
        choice,
        choices,
      });
    } catch (e) { return sendAppError(reply, e); }
  });

  app.get('/v1/sessions/:id/messages', async (req, reply) => {
    try {
      const p = req.params as { id: string };
      const q = req.query as { subagent_id?: string; limit?: string };
      const msgs = getMessages(db, p.id, { subagentId: q.subagent_id, limit: q.limit ? Number(q.limit) : undefined });
      return reply.send({ messages: msgs });
    } catch (e) { return sendAppError(reply, e); }
  });

  app.post('/v1/sessions/:id/artifacts', async (req, reply) => {
    try {
      const p = req.params as { id: string };
      const parsed = PostArtifactSchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(reply, zodToAppError(parsed.error));
      const b = parsed.data;
      const res = postArtifact(db, { sessionId: p.id, producerPeerId: b.producer_peer_id, kind: b.kind, content: b.content, path: b.path, metadata: b.metadata ?? null }, bus);
      return reply.send({ artifact_id: res.artifactId });
    } catch (e) { return sendAppError(reply, e); }
  });

  app.get('/v1/artifacts/:id', async (req, reply) => {
    try {
      const p = req.params as { id: string };
      const art = getArtifact(db, p.id);
      return reply.send({ artifact: art });
    } catch (e) { return sendAppError(reply, e); }
  });

  app.post('/v1/sessions/:id/choices', async (req, reply) => {
    try {
      const p = req.params as { id: string };
      const b = req.body as {
        subagent_id: string; question: string;
        options: { id: string; label: string; tradeoff?: string }[];
        recommendation?: { option_id: string; reason: string; confidence?: 'low'|'medium'|'high' };
        blocking: boolean; timeout_ms?: number;
      };
      const r = await choices.requestChoice({
        sessionId: p.id, subagentId: b.subagent_id, question: b.question,
        options: b.options, recommendation: b.recommendation, blocking: b.blocking, timeoutMs: b.timeout_ms,
      });
      return reply.send({ choice_id: r.choiceId, status: r.status, selected: r.selected, rationale: r.rationale });
    } catch (e) { return sendAppError(reply, e); }
  });

  app.post('/v1/sessions/:id/choices/:choiceId/resolve', async (req, reply) => {
    try {
      const p = req.params as { id: string; choiceId: string };
      const b = req.body as { selected: string; rationale?: string };
      const r = await choices.resolveChoice({ sessionId: p.id, choiceId: p.choiceId, selected: b.selected, rationale: b.rationale });
      return reply.send({ status: r.status });
    } catch (e) { return sendAppError(reply, e); }
  });

  app.post('/v1/sessions/:id/choices/:choiceId/wait', async (req, reply) => {
    try {
      const p = req.params as { id: string; choiceId: string };
      const b = req.body as { timeout_ms?: number };
      const r = await choices.waitChoice({ sessionId: p.id, choiceId: p.choiceId, timeoutMs: b.timeout_ms });
      return reply.send({ status: r.status, selected: r.selected, rationale: r.rationale });
    } catch (e) { return sendAppError(reply, e); }
  });

  app.get('/v1/sessions/:id/choices', async (req, reply) => {
    try {
      const p = req.params as { id: string };
      const rows = db.prepare<{ session_id: string }, unknown>('SELECT * FROM choices WHERE session_id=@session_id ORDER BY created_at ASC').all({ session_id: p.id });
      return reply.send({ choices: rows });
    } catch (e) { return sendAppError(reply, e); }
  });

  app.get('/v1/events', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    const write = (e: AgentSquadEvent) => { try { reply.raw.write(`data: ${JSON.stringify(e)}\n\n`); } catch { /* client gone */ } };
    write({ type: 'hello', payload: {} });
    const unsub = bus.on(write);
    req.raw.on('close', () => { unsub(); });
  });
}
