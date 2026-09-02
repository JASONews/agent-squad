import type { SendInput } from '@agent-squad/core';

const INSTRUCTION_PREFIX = `Subagent coordination protocol:
You are running as a headless subagent. Complete the task below using the repository context available in your environment.
You may need user input on non-permission business decisions, such as UI direction, naming, or architecture choices.
When you need such a decision, output a choice request block at the END of your reply in this exact format. Do not try to call MCP tools; they may be unavailable in headless mode.

%%AGENT_SQUAD_CHOICE%%
{"question":"your question here","options":[{"id":"option_id","label":"Option Label","tradeoff":"pros/cons"}],"recommendation":{"option_id":"recommended_id","reason":"why","confidence":"high"}}
%%END_AGENT_SQUAD_CHOICE%%

After outputting this block, stop and wait. The main agent will resolve the choice and send you the answer in the next message.
For permission/tool-approval questions, proceed with your default policy. Do NOT output a choice block for those.

Subagent task:
`;

export function injectInstruction(message: string): string {
  return INSTRUCTION_PREFIX + message;
}

const CLAUDE_INSTRUCTION_PREFIX = `Agent Squad subagent coordination protocol:
You are Claude Code running as a headless subagent. Complete the task below using the repository context available in your environment.
Use English for all communication with Claude Code. If task material contains non-English text, interpret it silently, but write all status updates, questions, choice blocks, and final answers in English.
You may need user input on non-permission business decisions, such as UI direction, naming, or architecture choices.
When you need such a decision, output a choice request block at the END of your reply in this exact format. Do not try to call MCP tools; they may be unavailable in headless mode.

%%AGENT_SQUAD_CHOICE%%
{"question":"your question here","options":[{"id":"option_id","label":"Option Label","tradeoff":"pros/cons"}],"recommendation":{"option_id":"recommended_id","reason":"why","confidence":"high"}}
%%END_AGENT_SQUAD_CHOICE%%

After outputting this block, stop and wait. The main agent will resolve the choice and send you the answer in the next message.
For permission/tool-approval questions, proceed with your default policy. Do NOT output a choice block for those.

Subagent task:
`;

const CLAUDE_CONTINUATION_PREFIX = `Agent Squad continuation message:
Use English for all communication with Claude Code. If this message includes non-English text, interpret it silently, but write all status updates, questions, choice blocks, and final answers in English.

Message:
`;

export function injectClaudeInstruction(message: string): string {
  return CLAUDE_INSTRUCTION_PREFIX + message;
}

export function injectClaudeContinuation(message: string): string {
  return CLAUDE_CONTINUATION_PREFIX + message;
}

export function injectAgentSquadEnv(env: NodeJS.ProcessEnv, input: SendInput): NodeJS.ProcessEnv {
  return {
    ...env,
    AGENT_SQUAD_SESSION_ID: input.sessionId ?? env.AGENT_SQUAD_SESSION_ID ?? '',
    AGENT_SQUAD_SUBAGENT_ID: input.subagentId ?? env.AGENT_SQUAD_SUBAGENT_ID ?? '',
    AGENT_SQUAD_ALIAS: input.alias ?? env.AGENT_SQUAD_ALIAS ?? '',
  };
}
