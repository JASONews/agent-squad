import { describe, it, expect } from 'vitest';
import { filterEnv } from '../../src/shared/env.js';

describe('filterEnv', () => {
  it('keeps PATH, HOME, SHELL, USER, LANG, TMPDIR, TERM, OPENAI_API_KEY, CODEX_HOME', () => {
    const out = filterEnv({
      PATH: '/usr/bin', HOME: '/h', SHELL: '/bin/zsh', USER: 'x',
      LANG: 'en_US.UTF-8', TMPDIR: '/tmp', TERM: 'xterm',
      OPENAI_API_KEY: 'sk-x', CODEX_HOME: '/h/.codex',
    });
    expect(out.PATH).toBe('/usr/bin');
    expect(out.HOME).toBe('/h');
    expect(out.OPENAI_API_KEY).toBe('sk-x');
    expect(out.CODEX_HOME).toBe('/h/.codex');
  });
  it('keeps LC_* and GIT_* prefixes', () => {
    const out = filterEnv({ LC_ALL: 'en_US', GIT_AUTHOR_NAME: 'x' });
    expect(out.LC_ALL).toBe('en_US');
    expect(out.GIT_AUTHOR_NAME).toBe('x');
  });
  it('drops known-sensitive: AWS_*, GOOGLE_APPLICATION_CREDENTIALS, GH_TOKEN, etc.', () => {
    const out = filterEnv({
      AWS_ACCESS_KEY_ID: 'x', AWS_SECRET_ACCESS_KEY: 'y',
      GOOGLE_APPLICATION_CREDENTIALS: '/c.json',
      GH_TOKEN: 't', GITHUB_TOKEN: 't', GITLAB_TOKEN: 't', NPM_TOKEN: 't',
      DATABASE_URL: 'pg://', REDIS_URL: 'redis://',
      PATH: '/usr/bin',
    });
    expect(out.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(out.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(out.GH_TOKEN).toBeUndefined();
    expect(out.GITHUB_TOKEN).toBeUndefined();
    expect(out.DATABASE_URL).toBeUndefined();
    expect(out.PATH).toBe('/usr/bin');
  });
  it('keeps unknown keys by default', () => {
    const out = filterEnv({ SOMETHING_WEIRD: 'keep-me', PATH: '/usr/bin' });
    expect(out.SOMETHING_WEIRD).toBe('keep-me');
  });
});
