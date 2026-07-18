import Fastify, { type FastifyInstance } from 'fastify';
import type { Db, AdapterRegistry, ChoicesService, EventBus } from '@agent-squad/core';
import { registerRoutes } from './routes.js';

export function buildApp(db: Db, registry: AdapterRegistry, choices: ChoicesService, bus: EventBus): FastifyInstance {
  const app = Fastify({ logger: false });
  registerRoutes(app, { db, registry, choices, bus });
  return app;
}
