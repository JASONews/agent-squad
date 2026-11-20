import type {
  CliType,
  ModelCapabilityProfile,
  ModelProfileCatalog,
} from '@agent-squad/core';

const lunaProfile: ModelCapabilityProfile = {
  summary: 'Best cost/performance default for simple work and routine implementation.',
  strengths: [
    'Fast codebase exploration and straightforward edits',
    'Routine feature implementation, bug fixes, and test writing',
    'Good throughput for clearly scoped tasks',
  ],
  weaknesses: [
    'Not the first choice for ambiguous architecture or high-risk review',
    'Complex cross-system reasoning may benefit from a stronger model',
  ],
  recommendedFor: ['simple_task', 'basic_implementation', 'bug_fix', 'test_writing'],
  avoidFor: ['architecture_decision', 'security_review', 'high_risk_migration'],
  costTier: 'low',
  latencyTier: 'fast',
  priority: 90,
  effortProfiles: {
    max: {
      summary: 'Preferred Luna setting when routine implementation needs extra care.',
      strengths: ['More reliable edge-case handling while retaining strong cost/performance'],
      costTier: 'medium',
      latencyTier: 'medium',
      priority: 92,
    },
  },
};

const solProfile: ModelCapabilityProfile = {
  summary: 'High-capability coding model for substantial implementation and review.',
  strengths: [
    'Complex implementation across multiple modules',
    'Detailed code review, debugging, and edge-case analysis',
    'Strong reasoning over repository-wide changes',
  ],
  weaknesses: [
    'More latency and resource use than a lightweight model',
    'Usually unnecessary for mechanical or very small edits',
  ],
  recommendedFor: ['complex_implementation', 'code_review', 'debugging', 'refactoring'],
  avoidFor: ['mechanical_edit', 'simple_lookup'],
  costTier: 'high',
  latencyTier: 'slow',
  priority: 80,
  effortProfiles: {
    high: {
      summary: 'Balanced setting for implementation work.',
      recommendedFor: ['complex_implementation', 'debugging', 'refactoring'],
      costTier: 'medium',
      latencyTier: 'medium',
      priority: 86,
    },
    xhigh: {
      summary: 'Preferred setting for difficult implementation tasks.',
      recommendedFor: ['complex_implementation', 'cross_module_change'],
      priority: 88,
    },
    max: {
      summary: 'Preferred setting for demanding review and highest-risk reasoning.',
      recommendedFor: ['code_review', 'security_review', 'high_risk_migration'],
      priority: 90,
    },
  },
};

const opusProfile: ModelCapabilityProfile = {
  summary: 'Deep reasoning model for architecture, long tasks, and difficult implementation.',
  strengths: [
    'Architecture and multi-step planning',
    'Large, ambiguous implementation tasks',
    'Long-context reasoning and careful review',
  ],
  weaknesses: [
    'Higher latency and resource use',
    'Poor cost/performance for small mechanical tasks',
  ],
  recommendedFor: ['architecture_decision', 'complex_implementation', 'deep_review'],
  avoidFor: ['mechanical_edit', 'simple_lookup'],
  costTier: 'high',
  latencyTier: 'slow',
  priority: 78,
  effortProfiles: {
    max: {
      summary: 'Use for the most difficult architecture, implementation, and review tasks.',
      priority: 88,
    },
  },
};

const sonnetProfile: ModelCapabilityProfile = {
  summary: 'Balanced general-purpose coding model for implementation and review.',
  strengths: [
    'Feature implementation and refactoring',
    'Code review with good speed and quality',
    'Clear technical writing and planning',
  ],
  weaknesses: [
    'May be less reliable than the strongest model on highly ambiguous work',
  ],
  recommendedFor: ['implementation', 'refactoring', 'code_review', 'documentation'],
  avoidFor: ['highest_risk_architecture'],
  costTier: 'medium',
  latencyTier: 'medium',
  priority: 82,
};

const flashProfile: ModelCapabilityProfile = {
  summary: 'Fast, economical model for simple tasks and rapid iteration.',
  strengths: [
    'Quick repository exploration',
    'Small UI or code changes',
    'Routine transformations and summaries',
  ],
  weaknesses: [
    'Less suitable for complex reasoning or high-risk review',
  ],
  recommendedFor: ['simple_task', 'basic_implementation', 'exploration', 'summary'],
  avoidFor: ['architecture_decision', 'security_review', 'complex_debugging'],
  costTier: 'low',
  latencyTier: 'fast',
  priority: 85,
};

export const OFFICIAL_MODEL_PROFILE_CATALOG_VERSION = 2;

export const OFFICIAL_MODEL_PROFILES: Record<CliType, ModelProfileCatalog> = {
  codex: {
    'gpt-5.6-luna': lunaProfile,
    'gpt-5.6-sol': solProfile,
    'gpt-6*-luna': lunaProfile,
    'gpt-6*-sol': {
      ...solProfile, summary: 'General-purpose coding and review across files.',
      costTier: 'medium', latencyTier: 'medium',
    },
    'gpt-*-astra': {
      ...solProfile, summary: 'Sustained reasoning for demanding end-to-end work across systems.',
      recommendedFor: ['cross_module_change', 'complex_debugging', 'deep_review'],
    },
    'gpt-*-terra': {
      summary: 'Fast visual analysis, technical writing, and focused app tasks.',
      strengths: ['Interpreting screenshots and charts', 'Clear technical writing'],
      weaknesses: ['Prefer a stronger reasoning model for ambiguous cross-system changes'],
      recommendedFor: ['visual_review', 'documentation'], latencyTier: 'fast', priority: 75,
    },
  },
  opencode: {
    '*gpt-5.6-luna*': lunaProfile,
    '*gpt-5.6-sol*': solProfile,
    '*claude*opus*': opusProfile,
    '*claude*sonnet*': sonnetProfile,
    '*gemini*flash*': flashProfile,
  },
  antigravity: {
    'gemini-4-neon*': {
      ...sonnetProfile, summary: 'Balanced reasoning for complex coding and analysis.',
    },
    'gemini-4-argon*': {
      ...opusProfile, summary: 'Reasoning and planning for multi-step engineering tasks.',
    },
    'gemini-4-hydrogen*': flashProfile,
    'gemini-pro-orchestrator-*': {
      summary: 'Multi-model planning and implementation.', recommendedFor: ['multi_step_implementation'],
      weaknesses: ['Not suitable when execution must stay on one model'], priority: 75,
    },
    'gemini-*-flash-*': flashProfile,
    'gemini-*-pro-*': {
      summary: 'Higher-reasoning Gemini option for complex product and UI work.',
      strengths: ['Complex product reasoning', 'Architecture-aware front-end implementation'],
      weaknesses: ['Slower than Flash variants for routine work'],
      recommendedFor: ['complex_ui_implementation', 'product_architecture'],
      avoidFor: ['mechanical_edit'],
      costTier: 'medium',
      latencyTier: 'medium',
      priority: 82,
    },
    'claude-*opus*': opusProfile,
    'claude-*sonnet*': sonnetProfile,
    'gpt-oss-*-medium': {
      summary: 'General-purpose open model option for routine coding and analysis.',
      strengths: ['General coding', 'Summarization', 'Independent second opinions'],
      weaknesses: ['Capability may trail the strongest hosted models on difficult work'],
      recommendedFor: ['basic_implementation', 'analysis', 'second_opinion'],
      avoidFor: ['highest_risk_review'],
      costTier: 'low',
      latencyTier: 'medium',
      priority: 65,
    },
  },
  claude: {
    default: {
      summary: 'Use the model selected by the local Claude Code plan and configuration.',
      recommendedFor: ['general_implementation'],
      priority: 88,
    },
    '*opus*': opusProfile,
    '*fable*': {
      ...opusProfile, summary: 'Claude option for the hardest and longest-running tasks.',
    },
    '*sonnet*': sonnetProfile,
    '*haiku*': {
      ...flashProfile,
      summary: 'Fast Claude option for small, clearly scoped tasks.',
    },
  },
  kimi: {
    default: {
      summary: 'Kimi Code ACP model for repository exploration and implementation.',
      strengths: ['Long-context repository exploration', 'Implementation through ACP workflows'],
      weaknesses: ['Available models and thinking controls depend on the local Kimi account'],
      recommendedFor: ['exploration', 'implementation', 'large_context_task'],
      avoidFor: ['routing_without_checking_discovered_options'],
      costTier: 'unknown',
      latencyTier: 'unknown',
      priority: 65,
    },
    'kimi-k2.5': {
      summary: 'Balanced Kimi coding model for long-context implementation work.',
      strengths: ['Repository-scale context', 'General implementation', 'Analysis'],
      weaknesses: ['Use a stronger specialist model for the highest-risk review'],
      recommendedFor: ['large_context_task', 'implementation', 'analysis'],
      avoidFor: ['highest_risk_security_review'],
      costTier: 'medium',
      latencyTier: 'medium',
      priority: 78,
      effortProfiles: {
        on: {
          summary: 'Enable thinking for complex implementation and analysis.',
          latencyTier: 'slow',
          priority: 82,
        },
        off: {
          summary: 'Prefer for simple work where speed matters more than deep reasoning.',
          latencyTier: 'fast',
          priority: 72,
        },
      },
    },
  },
};
