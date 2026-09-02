import type { CliType, SubagentStatus } from '../types.js';
import type { ContextTelemetry } from '../context-telemetry.js';

export interface ArtifactInput {
  kind: string;
  content: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

export interface SpawnInput {
  sessionId: string;
  subagentId: string;
  alias: string;
  role: string;
  cwd: string;
  message: string;
  permissionProfile?: string;
  model?: string;
  reasoningEffort?: string;
}

export interface SubagentHandle {
  subagentId: string;
  nativeSessionId?: string;
  status: SubagentStatus;
}

export interface SendInput {
  subagentId: string;
  nativeSessionId?: string;
  /** True until the first native turn reaches a terminal result. */
  isFirstTurn?: boolean;
  cwd?: string;
  permissionProfile?: string;
  model?: string;
  reasoningEffort?: string;
  sessionId?: string;
  alias?: string;
  message: string;
  wait: boolean;
  hardTimeoutMs?: number;
  onOutput?: (output: SendOutput) => void;
  /** Called as soon as the native CLI reports its resumable session id. */
  onSessionStarted?: (nativeSessionId: string) => void;
}

export interface SendOutput {
  stream: 'stdout' | 'stderr';
  text: string;
  rawTail: string;
}

export interface SendResult {
  status: 'completed' | 'running' | 'failed' | 'native_cli_blocked' | 'timeout';
  nativeSessionId?: string;
  contextTelemetry?: ContextTelemetry;
  reply?: string;
  artifacts?: ArtifactInput[];
  rawTail?: string;
  choiceRequested?: boolean;
}

export interface DetectResult {
  available: boolean;
  version?: string;
  path?: string;
}

export interface AdapterCapabilities {
  mcp: boolean;
  plugin: boolean;
  headless: boolean;
  resume: boolean;
  persistentServer: boolean;
  autoApprove: boolean;
  structuredOutput: boolean;
}

export interface ModelSelectionInfo {
  model?: {
    parameter: 'model';
    source: string;
    examples?: string[];
  };
  reasoningEffort?: {
    parameter: 'reasoning_effort' | 'model';
    source: string;
    values?: string[];
  };
}

export type ModelDiscoveryStatus =
  | 'available'
  | 'partial'
  | 'unsupported'
  | 'unavailable'
  | 'failed';

export type ModelDiscoveryErrorCode =
  | 'model_discovery_timeout'
  | 'model_discovery_spawn_failed'
  | 'model_discovery_command_failed'
  | 'model_discovery_protocol_error'
  | 'model_discovery_failed';

export type ModelCostTier = 'low' | 'medium' | 'high' | 'unknown';
export type ModelLatencyTier = 'fast' | 'medium' | 'slow' | 'unknown';

export interface ModelCapabilityDetails {
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
  recommendedFor?: string[];
  avoidFor?: string[];
  costTier?: ModelCostTier;
  latencyTier?: ModelLatencyTier;
  /** Relative routing preference from 0 to 100. It is advisory, not an automatic scheduler weight. */
  priority?: number;
}

export interface ModelCapabilityProfile extends ModelCapabilityDetails {
  effortProfiles?: Record<string, ModelCapabilityDetails>;
}

/** Keys are exact model ids or `*` glob patterns. */
export type ModelProfileCatalog = Record<string, ModelCapabilityProfile>;

export type ModelProfileSource = 'official_default' | 'user_override' | 'merged';

export interface ResolvedModelCapabilityProfile extends ModelCapabilityProfile {
  source: ModelProfileSource;
}

export interface DiscoveredModel {
  id: string;
  label?: string;
  isDefault?: boolean;
  reasoningEfforts?: string[];
  defaultReasoningEffort?: string;
}

export interface ModelDiscoveryResult {
  status: ModelDiscoveryStatus;
  source: string;
  models: DiscoveredModel[];
  defaultModel?: string;
  reasoningEfforts?: string[];
  defaultReasoningEffort?: string;
  error?: ModelDiscoveryErrorCode;
}

export interface ModelDiscoveryInput {
  cwd?: string;
}

export interface CliAdapter {
  readonly cliType: CliType | 'mock';
  detect(): Promise<DetectResult>;
  capabilities(): AdapterCapabilities;
  /** Human-readable description of what this CLI is good at (shown to the main agent via list_subagent_types). */
  strengths?: string;
  /** Human-readable description of what this CLI is NOT good at — helps the main agent avoid misassigning tasks. */
  weaknesses?: string;
  /** Roles this CLI can serve as (e.g. reviewer, implementer, ui_implementer). */
  roles?: string[];
  /** Model and thinking/reasoning selectors supported by this adapter. */
  modelSelection?: ModelSelectionInfo;
  /** Versioned model capability defaults maintained by Agent Squad. */
  modelProfiles?: ModelProfileCatalog;
  /** User model capability overrides loaded from agent-squad.yml. */
  modelProfileOverrides?: ModelProfileCatalog;
  /** Discover model choices advertised by the installed CLI. Omitted by adapters that cannot enumerate models. */
  discoverModels?(input?: ModelDiscoveryInput): Promise<ModelDiscoveryResult>;
  /** Reject a message before it is persisted or delivered when the adapter has input constraints. */
  validateMessage?(message: string): void;
  spawnSubagent(input: SpawnInput): Promise<SubagentHandle>;
  /** Create a real resumable native session without starting a model turn. */
  allocateNativeSession?(input: SpawnInput): Promise<string>;
  send(input: SendInput): Promise<SendResult>;
}
