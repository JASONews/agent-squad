import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read agy's `~/.gemini/antigravity-cli/cache/last_conversations.json` (a `{ "<cwd>": "<uuid>" }` map)
 * and return the conversation UUID for `cwd`. agy keys this map by the REALPATH of the cwd it ran in,
 * so we resolve realpath(cwd) before the lookup. Returns null on missing/unparseable/no-match.
 */
export function getConversationId(homeDir: string, cwd: string): string | null {
  const mapPath = join(homeDir, '.gemini', 'antigravity-cli', 'cache', 'last_conversations.json');
  let raw: string;
  try {
    raw = readFileSync(mapPath, 'utf8');
  } catch {
    return null;
  }
  let map: unknown;
  try {
    map = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof map !== 'object' || map === null) return null;
  // Resolve the realpath of cwd to match agy's keying.
  let realCwd: string;
  try {
    realCwd = realpathSync(cwd);
  } catch {
    realCwd = cwd;  // cwd may not exist yet; fall back to the literal
  }
  const uuid = (map as Record<string, unknown>)[realCwd];
  return typeof uuid === 'string' ? uuid : null;
}
