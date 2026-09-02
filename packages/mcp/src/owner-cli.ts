export interface OwnerCliSources {
  explicit?: string;
  environment?: string;
  clientName?: string;
}

function normalizeOwnerCli(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const lower = trimmed.toLowerCase();
  if (lower.includes('codex')) return 'codex';
  if (/open[\s._-]*code/.test(lower)) return 'opencode';
  if (lower.includes('antigravity') || /(^|[^a-z])agy([^a-z]|$)/.test(lower)) return 'antigravity';
  if (lower.includes('claude')) return 'claude';
  if (lower.includes('kimi')) return 'kimi';
  if (lower.includes('cursor')) return 'cursor';
  if (lower.includes('zcode')) return 'zcode';

  const slug = lower
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 64);
  return slug || undefined;
}

export function inferOwnerCli(sources: OwnerCliSources): string {
  return normalizeOwnerCli(sources.explicit)
    ?? normalizeOwnerCli(sources.environment)
    ?? normalizeOwnerCli(sources.clientName)
    ?? 'main';
}
