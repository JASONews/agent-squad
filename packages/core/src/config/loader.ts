import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { ConfigSchema, resolveConfig, type RawConfig, type ResolvedConfig } from './schema.js';
import { homedir } from 'node:os';
import { AppError } from '../errors.js';

export interface LoadOpts { cwd?: string; home?: string }

export async function loadConfig(opts: LoadOpts = {}): Promise<ResolvedConfig> {
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();
  const candidates = [join(cwd, 'agent-squad.yml'), join(home, '.agent-squad', 'config.yml')];
  const found = candidates.find((p) => existsSync(p));
  const rawDoc = found ? (yaml.load(readFileSync(found, 'utf8')) as Record<string, unknown>) : {};
  let raw: RawConfig;
  try {
    raw = ConfigSchema.parse(rawDoc);
  } catch (e) {
    throw new AppError('validation_error', `invalid config: ${(e as Error).message}`);
  }
  return resolveConfig(raw, home);
}
