import type { LineEvent, LineParser } from '../shared/line-parser.js';

export class AgyTurnParser implements LineParser {
  completed = false;
  private id: string | undefined;

  constructor(private readonly expectedId?: string) {}

  parse(line: string): LineEvent | null {
    let frame;
    try { frame = JSON.parse(line); } catch { return null; }
    if (frame?.event !== 'init' && frame?.event !== 'result') return null;
    const id = frame.event === 'init' ? frame.conversation_id : frame.result?.conversation_id;
    if (typeof id !== 'string' || !id || (this.expectedId && this.expectedId !== id)
      || (this.id && this.id !== id)) return null;
    this.id = id;
    if (frame.event === 'init') return { type: 'session_id', sessionId: id };
    if (frame.result.status !== 'SUCCESS' || typeof frame.result.response !== 'string') return null;
    this.completed = true;
    return { type: 'reply_text', sessionId: id, text: frame.result.response };
  }
}
