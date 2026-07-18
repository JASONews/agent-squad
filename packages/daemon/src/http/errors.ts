import { AppError, asAppError } from '@agent-squad/core';
import type { ZodError } from 'zod';
import type { FastifyReply } from 'fastify';

export function sendAppError(reply: FastifyReply, e: unknown): FastifyReply {
  const err = asAppError(e);
  const { status, body } = err.toHttp();
  return reply.code(status).send(body);
}

export function zodToAppError(e: ZodError): AppError {
  return new AppError('validation_error', `invalid request body: ${e.errors.map((x) => x.path.join('.') + ': ' + x.message).join('; ')}`);
}
