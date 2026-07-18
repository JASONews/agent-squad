export const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  root_task TEXT NOT NULL,
  repo_path TEXT,
  main_peer_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subagents (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  alias TEXT NOT NULL,
  cli_type TEXT NOT NULL,
  role TEXT NOT NULL,
  native_session_id TEXT,
  cwd TEXT,
  launch_mode TEXT NOT NULL,
  permission_profile TEXT,
  status TEXT NOT NULL,
  pid INTEGER,
  last_seen_at TEXT NOT NULL,
  context_summary TEXT,
  UNIQUE(session_id, alias)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  from_peer_id TEXT,
  to_peer_id TEXT,
  kind TEXT NOT NULL,
  content TEXT,
  artifact_refs TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  producer_peer_id TEXT,
  kind TEXT NOT NULL,
  path TEXT,
  content TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS choices (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  requester_subagent_id TEXT NOT NULL,
  target_peer_id TEXT,
  question TEXT NOT NULL,
  options_json TEXT NOT NULL,
  recommendation_json TEXT,
  status TEXT NOT NULL,
  selected TEXT,
  rationale TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_subagents_session ON subagents(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);
`;

export const MIGRATION_V2 = `
ALTER TABLE subagents ADD COLUMN model TEXT;
ALTER TABLE subagents ADD COLUMN reasoning_effort TEXT;
`;

export const TARGET_VERSION = 2;
