---
name: agent-squad
description: Use when coordinating with agent-squad — either as the main agent spawning helper subagents (codex/opencode/antigravity/claude/kimi), or as a subagent that needs to request user decisions. Trigger when agent-squad MCP tools are available and the task could benefit from delegation, OR when your prompt contains "[agent-squad]" prefix indicating you are a subagent.
---

# Agent Squad — Coordination Guide

Agent-squad lets coding CLIs collaborate. You are either a **main agent** (coordinating helpers) or a **subagent** (spawned by another CLI). This skill covers both roles.

## Detect Your Role

- **You are the main agent** if: you have agent-squad MCP tools (`start_session`, `spawn_subagent`, `send_to_subagent`, `get_subagent_status`, `resolve_choice`, etc.) and you're talking directly to the user.
- **You are a subagent** if: your prompt starts with `[agent-squad]` or you were spawned by another CLI via agent-squad.

---

## As Main Agent

### When to Spawn a Subagent

First, check what's available and what each CLI is good/bad at:

```
list_subagent_types({ cwd: "<repository path>" })
→ Returns each CLI's roles, strengths, weaknesses, model_selection, and model_discovery
```

**Assignment guide:**

| Task | Best CLI | Avoid |
|---|---|---|
| Code review / bug finding | codex | antigravity (not suited for review) |
| UI / product design | antigravity | codex (not ideal for UI) |
| Implementation / testing | opencode, codex, claude, or kimi | antigravity (higher latency) |
| General fallback | opencode, claude, or kimi | — |

**Don't spawn** when the task is simple enough to do yourself in 30 seconds.
**Don't spawn yourself** — use your own internal subagent mechanism for that.

### Model And Thinking Selection

`spawn_subagent` runs CLIs in headless/print mode and can optionally include:

```json
{"model":"<model name>","reasoning_effort":"<level>"}
```

Use `list_subagent_types` first and pass the repository `cwd`, because OpenCode and ACP-backed CLIs may expose project-scoped choices:

- `model_selection` explains how Agent Squad passes `model` and `reasoning_effort` to the CLI.
- `model_discovery.models` contains choices advertised by the installed CLI. Use the exact `id`.
- `model_discovery.status: "available"` means the list was dynamically enumerated.
- `"partial"` means the CLI only exposes documented aliases, so unlisted full model names may still work.
- `"unsupported"`, `"unavailable"`, or `"failed"` means discovery cannot provide a list. Do not assume the CLI itself is unusable when discovery alone failed; omit the selectors or use a user-provided custom value.

Discovery is advisory rather than a whitelist. The native CLI remains the authority when a selected model is invoked.

Typical mappings:

| CLI | `model` | `reasoning_effort` / thinking |
|---|---|---|
| `codex` | Passed as `--model` | Passed as `model_reasoning_effort` |
| `opencode` | Passed as `--model` | Passed as `--variant` |
| `antigravity` | Passed as `--model` | No separate flag; choose an exact `agy models` id, e.g. `gemini-3.5-flash-high` |
| `claude` | Passed as `--model`; default `default` (Claude Code resolves this to Opus by default) | Passed as `--effort`; default `max` |
| `kimi` | Applied through the Kimi Code ACP model config option; omit it to use Kimi's default | Kimi currently advertises `on`/`off`; familiar non-off levels such as `high` map to `on` |

### Workflow

Always pass `owner_cli` to `start_session` using the current main-agent CLI identifier, such as `codex`, `opencode`, `antigravity`, `claude`, `kimi`, `cursor`, or `zcode`. The MCP server also attempts to infer it from the client handshake, but an explicit value keeps session ownership unambiguous in the TUI and Gateway.

```
1. start_session({ cwd: ".", task: "<user's task>", owner_cli: "<current main CLI id>" })
2. [Do your part]
3. spawn_subagent({ session_id, alias: "rev", cli: "codex", role: "reviewer", model: "<id from model_discovery>", reasoning_effort: "high", message: "<self-contained task>" })  // registers only
4. send_to_subagent({ session_id, alias: "rev", message: "Start.", wait: true })  // REQUIRED: this starts/invokes the headless CLI
5. Check the send_to_subagent result:
   - "completed" → integrate the reply
   - "running" → the subagent is still working in the background; call `wait_subagent({ session_id, alias, after_message_id: <message_id>, after_output_event_count: <progress.output_events>, timeout_ms: 300000 })` instead of sleeping, polling with your own timer, or sending a follow-up message. `timeout_ms` is optional; default is 300s and one wait is capped at 300s.
   - "choice_requested" → present options to user → resolve_choice → resume
   - "native_cli_blocked" → inform user
   - "timeout" → the subagent exceeded its hard runtime budget and was stopped
6. Follow-ups: send_to_subagent({ ..., message: "User chose X. Continue." }) — this resumes
```

`spawn_subagent` registers the subagent and stores its assignment, but it does not start the native Codex/OpenCode/Antigravity/Claude/Kimi process. A subagent with status `ready` has not received work yet. Do not call `wait_subagent` immediately after `spawn_subagent`; first call `send_to_subagent`. After `send_to_subagent` returns `running`, use `wait_subagent` to wait for completion, choices, or failure. Do not use manual sleeps as a substitute for `wait_subagent`. On the first native send, agent-squad includes the stored spawn assignment plus the send message, so a short first send such as "Start." is acceptable after a self-contained spawn assignment.

When `cli` is `"claude"`, write the `spawn_subagent.message` and every `send_to_subagent.message` primarily in English. If the user's task is not in English, translate or summarize it into English before sending it to the Claude subagent. By default, Agent Squad enforces this before storing or delivering the message: at least 60% of prose word units must use Latin script, while fenced code, inline code, URLs, and filesystem paths are ignored. The policy can be disabled or its `0..1` ratio changed with `subagents.claude.english_input.enabled` and `subagents.claude.english_input.minimum_ratio` in `agent-squad.yml` or `~/.agent-squad/config.yml`. A rejected call returns `claude_input_requires_english`; rewrite the message in English instead of retrying the same text. Claude output is not rejected by this input policy.

### Slow Tasks And Progress

Every send, wait, status inspection, and Core subagent response includes `progress`. Use it to distinguish slow work from a run that needs intervention:

| `progress.assessment` | Meaning | Main-agent action |
|---|---|---|
| `starting` / `progressing` | The native run is active; recent output is evidence of forward movement | Call `wait_subagent` again, passing the latest `progress.output_events` as the next baseline |
| `quiet` | The run is active but has not emitted output recently | Inspect `progress.raw_tail`, then use one bounded `wait_subagent`; do not send another message to the active subagent |
| `possibly_stalled` | The run is still active, but continuous silence crossed the conservative stall threshold | Treat this as suspicion, not proof. If the output count remains unchanged, wait for the hard timeout or assign an independent smaller chunk to a new alias |
| `orphaned` | The database says running, but this daemon has no active native run, usually after a restart | Retry as a new, smaller assignment |
| `blocked` | The native CLI is waiting on a captured permission or decision | Resolve the block before resuming |
| `timed_out` / `failed` | The native run ended without completing | Retry with a narrower scope and explicit deliverable |

`get_subagent_status` is an immediate, non-blocking diagnostic. Use it after an unexpected wait result or to compare `output_events`; do not busy-poll it. `wait_subagent` may return `status: "running"` before its requested timeout when `progress.assessment` becomes `possibly_stalled` or `orphaned`.

For work likely to exceed a few minutes, create an early checkpoint instead of assigning one unbounded task:

1. Ask the subagent to inspect a bounded scope and return early findings plus 3-5 concrete work chunks. Do not ask it to implement everything in this first turn.
2. After that turn completes, send one chunk per follow-up, with exact files and a concrete deliverable.
3. Use separate aliases for independent chunks that can run in parallel.
4. Never send a follow-up to the same alias while its current run is active; agent-squad will reject and queue no new work.

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
