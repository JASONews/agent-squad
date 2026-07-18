export type LineEventType = 'session_id' | 'reply_text' | 'error' | 'unknown';

export interface LineEvent {
  type: LineEventType;
  sessionId?: string;
  text?: string;
  message?: string;
  raw?: unknown;
}

export interface LineParser {
  /** Parse one stdout line into a normalized event. Pure. Returns null for blank lines. */
  parse(line: string): LineEvent | null;
}

/** CLI-neutral accumulator: first session_id wins; reply_text accumulates; first error wins. */
export class LineAccumulator {
  private _sessionId: string | null = null;
  private _replyText = '';
  private _error: string | null = null;

  add(event: LineEvent): void {
    if (event.sessionId && this._sessionId === null) {
      this._sessionId = event.sessionId;
    }
    if (event.type === 'session_id' && event.sessionId) {
      if (this._sessionId === null) this._sessionId = event.sessionId;
    } else if (event.type === 'reply_text' && typeof event.text === 'string') {
      this._replyText += event.text;
    } else if (event.type === 'error' && typeof event.message === 'string') {
      if (this._error === null) this._error = event.message;
    }
  }
  get sessionId(): string | null { return this._sessionId; }
  get replyText(): string { return this._replyText; }
  get error(): string | null { return this._error; }
}

export class LineBuffer {
  private buffered = '';

  push(chunk: string, onLine: (line: string) => void): void {
    const lines = (this.buffered + chunk).split(/\r?\n/);
    this.buffered = lines.pop() ?? '';
    for (const line of lines) onLine(line);
  }

  flush(onLine: (line: string) => void): void {
    if (this.buffered.length === 0) return;
    const line = this.buffered;
    this.buffered = '';
    onLine(line);
  }
}
