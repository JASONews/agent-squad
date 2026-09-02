export type CliType = 'codex' | 'opencode' | 'antigravity' | 'claude' | 'kimi';

export type SubagentStatus =
  | 'starting' | 'ready' | 'running'
  | 'completed' | 'failed' | 'native_cli_blocked' | 'timeout';

export type MessageKind = 'user_task' | 'main_to_sub' | 'sub_to_main' | 'sub_status' | 'system' | 'choice_request' | 'choice_resolved';

export type ArtifactKind =
  | 'patch' | 'diff' | 'review_json' | 'test_report'
  | 'ui_proposal' | 'screenshot' | 'summary' | 'file_ref' | 'other';

export type ContextPolicyMode =
  | 'message_only' | 'with_refs' | 'explicit_delta'
  | 'receiver_pull' | 'exact_payload' | 'server_generated_summary';

export interface ContextPolicy {
  mode: ContextPolicyMode;
  refs?: string[];
  delta?: string[];
  hint?: string;
  maxTokens?: number;
}

export interface Artifact {
  id: string;
  session_id: string;
  producer_peer_id: string | null;
  kind: string;
  path: string | null;
  content: string | null;
  metadata_json: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  session_id: string;
  from_peer_id: string | null;
  to_peer_id: string | null;
  kind: string;
  content: string | null;
  artifact_refs: string | null; // JSON array of artifact ids
  created_at: string;
}

export interface Session {
  id: string;
  root_task: string;
  repo_path: string | null;
  main_peer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Subagent {
  id: string;
  session_id: string;
  alias: string;
  cli_type: string;
  role: string;
  native_session_id: string | null;
  cwd: string | null;
  launch_mode: string;
  permission_profile: string | null;
  model: string | null;
  reasoning_effort: string | null;
  status: string;
  pid: number | null;
  last_seen_at: string;
  context_summary: string | null;
  context_usage_json: string | null;
  context_compaction_count: number;
  context_last_compaction_json: string | null;
  context_telemetry_updated_at: string | null;
  run_started_at?: string | null;
  run_last_output_at?: string | null;
  run_output_event_count?: number;
}
