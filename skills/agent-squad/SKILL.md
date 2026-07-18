---
name: agent-squad
description: Use when coordinating with agent-squad — either as the main agent spawning helper subagents (codex/opencode/antigravity/claude), or as a subagent that needs to request user decisions. Trigger when agent-squad MCP tools are available and the task could benefit from delegation, OR when your prompt contains "[agent-squad]" prefix indicating you are a subagent.
---

# Agent Squad — Coordination Guide

Agent-squad lets coding CLIs collaborate. You are either a **main agent** (coordinating helpers) or a **subagent** (spawned by another CLI). This skill covers both roles.

## Detect Your Role

- **You are the main agent** if: you have agent-squad MCP tools (`start_session`, `spawn_subagent`, `send_to_subagent`, `resolve_choice`, etc.) and you're talking directly to the user.
- **You are a subagent** if: your prompt starts with `[agent-squad]` or you were spawned by another CLI via agent-squad.

---

## As Main Agent

### When to Spawn a Subagent

First, check what's available and what each CLI is good/bad at:

```
list_subagent_types()
→ Returns each CLI's roles, strengths, weaknesses, and model_selection
```

**Assignment guide:**

| Task | Best CLI | Avoid |
|---|---|---|
| Code review / bug finding | codex | antigravity (not suited for review) |
| UI / product design | antigravity | codex (not ideal for UI) |
| Implementation / testing | opencode, codex, or claude | antigravity (higher latency) |
| General fallback | opencode or claude | — |

**Don't spawn** when the task is simple enough to do yourself in 30 seconds.
**Don't spawn yourself** — use your own internal subagent mechanism for that.

### Model And Thinking Selection

`spawn_subagent` runs CLIs in headless/print mode and can optionally include:

```json
{"model":"<model name>","reasoning_effort":"<level>"}
```

Use `list_subagent_types` first. Each adapter reports `model_selection`, using the same source as `roles`, `strengths`, and `weaknesses`.

Typical mappings:

| CLI | `model` | `reasoning_effort` / thinking |
|---|---|---|
| `codex` | Passed as `--model` | Passed as `model_reasoning_effort` |
| `opencode` | Passed as `--model` | Passed as `--variant` |
| `antigravity` | Passed as `--model` | No separate flag; choose the full `agy models` name, e.g. `Gemini 3.5 Flash (High)` |
| `claude` | Passed as `--model`; default `default` (Claude Code resolves this to Opus by default) | Passed as `--effort`; default `max` |

### Workflow

```
1. start_session({ cwd: ".", task: "<user's task>" })
2. [Do your part]
3. spawn_subagent({ session_id, alias: "rev", cli: "codex", role: "reviewer", model: "gpt-5", reasoning_effort: "high", message: "<self-contained task>" })  // registers only
4. send_to_subagent({ session_id, alias: "rev", message: "Start.", wait: true })  // REQUIRED: this starts/invokes the headless CLI
5. Check the send_to_subagent result:
   - "completed" → integrate the reply
   - "running" → the subagent is still working in the background; call `wait_subagent({ session_id, alias, after_message_id: <message_id>, timeout_ms: 300000 })` instead of sleeping, polling with your own timer, or sending a follow-up message. `timeout_ms` is optional; default is 300s and one wait is capped at 300s.
   - "choice_requested" → present options to user → resolve_choice → resume
   - "native_cli_blocked" → inform user
   - "timeout" → the subagent exceeded its hard runtime budget and was stopped
6. Follow-ups: send_to_subagent({ ..., message: "User chose X. Continue." }) — this resumes
```

`spawn_subagent` registers the subagent and stores its assignment, but it does not start the native Codex/OpenCode/Antigravity/Claude process. A subagent with status `ready` has not received work yet. Do not call `wait_subagent` immediately after `spawn_subagent`; first call `send_to_subagent`. After `send_to_subagent` returns `running`, use `wait_subagent` to wait for completion, choices, or failure. Do not use manual sleeps as a substitute for `wait_subagent`. On the first native send, agent-squad includes the stored spawn assignment plus the send message, so a short first send such as "Start." is acceptable after a self-contained spawn assignment.

When `cli` is `"claude"`, write the `spawn_subagent.message` and every `send_to_subagent.message` in English. If the user's task is not in English, translate or summarize it into English before sending it to the Claude subagent. Claude subagents are prompted to respond in English.

### Handling Choice Requests

When `send_to_subagent` returns `status: "choice_requested"`:

1. Present each returned choice question and its options to the user
2. Call `resolve_choice({ session_id, choice_id, selected: "<user's pick>" })` for every returned `choice_id`
3. Resume: `send_to_subagent({ session_id, alias, message: "User chose <answers>. Continue." })`

---

## As Subagent

### Core Rules

1. **You don't have direct user access.** The main agent mediates.
2. **Permission prompts** — proceed with your default policy. Don't stop.
3. **Business decisions** (UI direction, naming, architecture) — **don't guess**. Output a choice block (below) and stop.

### How to Request a User Decision

Output this block at the **END** of your reply when you need a direction/strategy choice:

```
%%AGENT_SQUAD_CHOICE%%
{"question":"Modal or standalone page?","options":[{"id":"modal","label":"Modal","tradeoff":"lighter but limited space"},{"id":"page","label":"Standalone Page","tradeoff":"more space for complex forms"}],"recommendation":{"option_id":"page","reason":"Settings involve multiple fields; standalone gives more room.","confidence":"high"}}
%%END_AGENT_SQUAD_CHOICE%%
```

If you need several independent decisions at once, output several complete choice blocks one after another:

```
%%AGENT_SQUAD_CHOICE%%
{"question":"Layout?","options":[{"id":"modal","label":"Modal"},{"id":"page","label":"Page"}],"recommendation":{"option_id":"page","reason":"More room for complex forms.","confidence":"high"}}
%%END_AGENT_SQUAD_CHOICE%%

%%AGENT_SQUAD_CHOICE%%
{"question":"Density?","options":[{"id":"dense","label":"Dense"},{"id":"guided","label":"Guided"}],"recommendation":{"option_id":"dense","reason":"Repeat users benefit from faster scanning.","confidence":"medium"}}
%%END_AGENT_SQUAD_CHOICE%%
```

**Format rules:**
- Start with `%%AGENT_SQUAD_CHOICE%%`, end with `%%END_AGENT_SQUAD_CHOICE%%` — each on its own line
- Valid JSON between markers: `question` (required), `options[]` (required, ≥1), `recommendation` (encouraged)
- After the block(s), **stop and wait**. The main agent will send you the answer(s) in the next message.

**Don't use choice blocks for:** permission prompts (just proceed), trivial details you can infer (just decide).

### Resume

When you receive a message referencing a previous choice (e.g. "User chose standalone page. Continue."), incorporate the decision and resume your work.
