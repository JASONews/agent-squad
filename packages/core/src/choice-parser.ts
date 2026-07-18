/** Parsed choice request extracted from a subagent reply. */
export interface ParsedChoiceRequest {
  question: string;
  options: { id: string; label: string; tradeoff?: string }[];
  recommendation?: { option_id: string; reason: string; confidence?: 'low' | 'medium' | 'high' };
}

const START_MARKER = '%%AGENT_SQUAD_CHOICE%%';
const END_MARKER = '%%END_AGENT_SQUAD_CHOICE%%';

function parseChoiceJson(jsonText: string): ParsedChoiceRequest | null {
  try {
    const parsed = JSON.parse(jsonText) as ParsedChoiceRequest;
    if (!parsed.question || !Array.isArray(parsed.options) || parsed.options.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Parse every valid choice request block from a reply. Invalid/incomplete blocks are left as text. */
export function parseChoicesFromReply(reply: string): { choices: ParsedChoiceRequest[]; cleanedReply: string } {
  const choices: ParsedChoiceRequest[] = [];
  const parts: string[] = [];
  let cursor = 0;

  while (cursor < reply.length) {
    const startIdx = reply.indexOf(START_MARKER, cursor);
    if (startIdx === -1) {
      parts.push(reply.slice(cursor));
      break;
    }

    const endIdx = reply.indexOf(END_MARKER, startIdx + START_MARKER.length);
    if (endIdx === -1) {
      parts.push(reply.slice(cursor));
      break;
    }

    const blockEnd = endIdx + END_MARKER.length;
    const jsonText = reply.slice(startIdx + START_MARKER.length, endIdx).trim();
    const choice = parseChoiceJson(jsonText);
    if (choice) {
      parts.push(reply.slice(cursor, startIdx));
      choices.push(choice);
    } else {
      parts.push(reply.slice(cursor, blockEnd));
    }
    cursor = blockEnd;
  }

  return {
    choices,
    cleanedReply: choices.length > 0 ? parts.join('').replace(/\n{3,}/g, '\n\n').trim() : reply,
  };
}

/** Parse a choice request block from a reply. Returns the first parsed request (if found) and the
 *  cleaned reply (with all valid choice blocks removed). */
export function parseChoiceFromReply(reply: string): { choice: ParsedChoiceRequest | null; cleanedReply: string } {
  const { choices, cleanedReply } = parseChoicesFromReply(reply);
  return { choice: choices[0] ?? null, cleanedReply };
}
