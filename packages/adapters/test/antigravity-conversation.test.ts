import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getConversationId } from '../src/antigravity/conversation.js';

let home: string;
let workdir: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'asq-agy-home-'));
  workdir = mkdtempSync(join(tmpdir(), 'asq-agy-work-'));
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); rmSync(workdir, { recursive: true, force: true }); });

function writeMap(map: Record<string, string>): void {
  const cacheDir = join(home, '.gemini', 'antigravity-cli', 'cache');
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, 'last_conversations.json'), JSON.stringify(map));
}

describe('getConversationId', () => {
  it('returns the UUID for the matching (realpath) cwd', () => {
    const realWorkdir = realpathSync(workdir);
    writeMap({ [realWorkdir]: 'agy-uuid-123' });
    expect(getConversationId(home, workdir)).toBe('agy-uuid-123');
  });
  it('returns null when the cwd is not in the map', () => {
    writeMap({ '/some/other/dir': 'uuid-x' });
    expect(getConversationId(home, workdir)).toBeNull();
  });
  it('returns null when the map file is missing', () => {
    expect(getConversationId(home, workdir)).toBeNull();
  });
  it('returns null when the map file is unparseable', () => {
    const cacheDir = join(home, '.gemini', 'antigravity-cli', 'cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'last_conversations.json'), 'not json{');
    expect(getConversationId(home, workdir)).toBeNull();
  });
  it('handles a realpath mismatch (symlink cwd resolves to the stored key)', () => {
    // workdir itself is a real dir; store its realpath key, look up by workdir (which realpath resolves)
    const realWorkdir = realpathSync(workdir);
    writeMap({ [realWorkdir]: 'uuid-real' });
    expect(getConversationId(home, workdir)).toBe('uuid-real');
  });
});
