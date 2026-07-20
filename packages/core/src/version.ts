import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAMES = new Set(['@jasonews/agent-squad', '@agent-squad/core']);

function readPackageVersion(moduleUrl: string): string {
  let directory = dirname(fileURLToPath(moduleUrl));

  for (;;) {
    try {
      const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
        name?: unknown;
        version?: unknown;
      };
      if (typeof metadata.name === 'string'
        && PACKAGE_NAMES.has(metadata.name)
        && typeof metadata.version === 'string') {
        return metadata.version;
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error('Unable to locate Agent Squad package metadata');
}

export const AGENT_SQUAD_VERSION = readPackageVersion(import.meta.url);
