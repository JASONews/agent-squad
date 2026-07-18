// HTTP client that forwards MCP tool calls to the agent-squad daemon.
// AGENT_SQUAD_URL may point the shim at a non-default daemon address.

const BASE = process.env.AGENT_SQUAD_URL ?? 'http://127.0.0.1:28771';

export class HttpError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function unwrap<T>(r: Response): Promise<T> {
  const j = (await r.json()) as T & ErrorBody;
  if (!r.ok) {
    throw new HttpError(j.error?.message ?? `HTTP ${r.status}`, j.error?.code);
  }
  return j;
}

export async function httpGet<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  return unwrap<T>(r);
}

export async function httpPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return unwrap<T>(r);
}
