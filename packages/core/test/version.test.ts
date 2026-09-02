import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_SQUAD_VERSION } from '../src/version.js';

describe('Agent Squad version', () => {
  it('matches the public package manifest', () => {
    const publicPackage = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };

    expect(AGENT_SQUAD_VERSION).toBe(publicPackage.version);
  });
});
