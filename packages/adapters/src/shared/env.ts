const KEEP_EXACT = new Set([
  'PATH', 'HOME', 'SHELL', 'USER', 'LANG', 'TMPDIR', 'TERM',
  'OPENAI_API_KEY', 'CODEX_HOME', 'PWD',
]);
const KEEP_PREFIXES = ['LC_', 'GIT_'];
const DROP_EXACT = new Set([
  'GH_TOKEN', 'GITHUB_TOKEN', 'GITLAB_TOKEN', 'NPM_TOKEN',
  'DATABASE_URL', 'REDIS_URL', 'GOOGLE_APPLICATION_CREDENTIALS',
]);
const DROP_PREFIXES = ['AWS_', 'AZURE_', 'CLOUDSDK_'];

export function filterEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (KEEP_EXACT.has(key)) { out[key] = value; continue; }
    if (DROP_EXACT.has(key)) continue;
    if (DROP_PREFIXES.some((p) => key.startsWith(p))) continue;
    if (KEEP_PREFIXES.some((p) => key.startsWith(p))) { out[key] = value; continue; }
    // default: keep. The allowlist above is "drop known-sensitive prefixes", NOT "drop everything not listed".
    out[key] = value;
  }
  return out;
}
