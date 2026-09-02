import type { AgentSquadEvent } from '@agent-squad/core';

/** Connect to the daemon's SSE endpoint via fetch streaming (Node has no global EventSource).
 *  Returns a disconnect function. Calls onEvent for each parsed event; reconnects on error. */
export function connectSSE(baseUrl: string, onEvent: (e: AgentSquadEvent) => void): () => void {
  let aborted = false;
  const controller = new AbortController();

  (async () => {
    while (!aborted) {
      try {
        const res = await fetch(`${baseUrl}/v1/events`, {
          signal: controller.signal,
          headers: { accept: 'text/event-stream' },
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try { onEvent(JSON.parse(line.slice(6)) as AgentSquadEvent); } catch { /* ignore malformed */ }
            }
          }
        }
      } catch {
        if (aborted) break;
        await new Promise((r) => setTimeout(r, 2000));  // reconnect after 2s
      }
    }
  })();

  return () => { aborted = true; controller.abort(); };
}

export async function restGet<T>(baseUrl: string, path: string): Promise<T> {
  const r = await fetch(`${baseUrl}${path}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

export async function restPost<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const r = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}
