# Agent Squad

**Local external-subagent runtime for coding CLIs.**

**English (default)** | [简体中文](https://github.com/JASONews/agent-squad/blob/main/translations/README.zh-CN.md)

Agent Squad lets a main coding agent such as Claude Code, Codex, opencode, Antigravity, or Kimi Code delegate work to other logged-in coding CLIs through a local relay daemon. Each CLI keeps its own authentication, model, tools, permissions, and native conversation context.

```text
Main Agent (Claude Code / Codex / opencode / Antigravity / Kimi Code)
    -> MCP tools / HTTP API
agent-squadd (local daemon + SQLite + SSE)
    -> spawn + resume + message relay
Codex / opencode / Antigravity / Claude Code / Kimi Code subagent
```

## Features

- Multi-CLI subagents: spawn Codex, opencode, Antigravity, Claude Code, or Kimi Code as external subagents with multi-turn resume support.
- Choice relay: subagents can ask the main agent/user to choose between implementation directions, then resume with the answer.
- Live TUI: inspect sessions, subagent status, timelines, pending choices, blocked agents, and live output tails.
- PTY approval bridge: automatically handles common permission prompts for CLIs that run in a pseudo-terminal.
- Permission profiles: configure sandbox and approval behavior per CLI.
- MCP installer: register the Agent Squad MCP shim in supported coding CLIs.

## Requirements

- Node.js 20 or newer
- npm
- At least one supported coding CLI installed and authenticated:
  - Codex
  - opencode
  - Antigravity
  - Claude Code
  - Kimi Code

## Quick Start

### Install the Published Package

Agent Squad is a public package on the npm registry. No registry token is
required:

```bash
npm install -g @jasonews/agent-squad
```

Then verify the installed commands:

```bash
agent-squad --help
agent-squadd --help
agent-squad-mcp --help
```

### Build from Source

```bash
git clone https://github.com/JASONews/agent-squad.git
cd agent-squad
npm ci
npm run build
npm link
```

After package installation or source linking, these commands are available:

```bash
agent-squad       # CLI entrypoint: daemon, install, discover, doctor, tui
agent-squadd      # foreground daemon
agent-squad-mcp   # stdio MCP shim used by main agents
```

## Start the Daemon

```bash
agent-squadd
```

Or run it in the background:

```bash
agent-squad daemon start
agent-squad daemon status
```

Check the installation:

```bash
agent-squad doctor
```

Discover available coding CLIs:

```bash
agent-squad discover
```

## Install MCP Configuration

Register Agent Squad as an MCP server for supported CLIs:

```bash
agent-squad install codex
agent-squad install opencode
agent-squad install antigravity
agent-squad install claude
agent-squad install kimi
```

Each installer backs up the original config and is idempotent.

For Claude Code, you can also configure a project-local `.mcp.json`:

```json
{
  "mcpServers": {
    "agent-squad": {
      "command": "agent-squad-mcp"
    }
  }
}
```

Install the shared Agent Squad skill instructions:

```bash
bash skills/install.sh all
```

## MCP Tools

| Tool | Purpose |
|---|---|
| `start_session` | Create a collaboration session |
| `list_subagent_types` | List available subagent types, discovered models, and model-specific capability profiles |
| `spawn_subagent` | Start a subagent (`codex`, `opencode`, `antigravity`, `claude`, or `kimi`) |
| `send_to_subagent` | Send a message to a subagent |
| `wait_subagent` | Wait for a running subagent result without sending a new message |
| `request_choice` / `resolve_choice` | Ask for and resolve user decisions |
| `post_artifact` / `get_artifact` | Publish and retrieve artifacts |
| `get_subagent_messages` | Inspect the message timeline |

## Example

```text
User: Implement an Ollama embedding settings feature.

Main agent:
1. start_session({ cwd: ".", task: "Implement Ollama embedding settings" })
2. Implement the main change.
3. spawn_subagent({ cli: "codex", alias: "rev", role: "reviewer", message: "Review my changes" })
4. send_to_subagent({ alias: "rev", message: "Review the diff", wait: true })
5. If the result is running, call wait_subagent({ alias: "rev", timeout_ms: 300000 })
6. If the subagent requests a choice, show the options to the user and call resolve_choice.
7. Incorporate the review feedback.
```

`spawn_subagent` never starts a model turn. OpenCode and Kimi Code preallocate a resumable native session through ACP, so their spawn result can already contain `nativeSessionId`. Codex, Claude Code, and Antigravity persist the native ID as soon as the first real run reports it, before a long-running turn exits. In every case, `send_to_subagent` is still required to start model work.

## TUI

```bash
agent-squad tui
```

Views:

- Session List: all sessions, subagent counts, pending choices, and blocked state.
- Session Detail: timeline, subagents, live output tail, artifacts, and choices.
- Choice Console: pending choices.
- Blocked Console: blocked subagents and raw output tail.

Keys: `Up`/`Down` to navigate, `Enter` to open, `c` for choices, `b` for blocked subagents, `q` to go back or quit.

## Architecture

```text
Main Agent (MCP tools)
  Claude Code / Codex / opencode / Antigravity / Kimi Code
        |
        | stdio MCP / HTTP API
        v
agent-squadd
  SQLite store
  EventBus
  SSE
  HTTP API
  AdapterRegistry: codex / opencode / antigravity / claude / kimi
  PTY approval bridge
        |
        +-- codex exec
        +-- opencode run
        +-- agy --print
        +-- claude -p
        +-- kimi acp
```

## npm Distribution and Repository Workspaces

The public npm distribution is a single package: `@jasonews/agent-squad`. It
provides the `agent-squad`, `agent-squadd`, and `agent-squad-mcp` commands. The
`@agent-squad/*` packages below are internal monorepo workspaces and are not
published separately.

| Internal workspace | Command in `@jasonews/agent-squad` | Purpose |
|---|---|---|
| `@agent-squad/core` | none | SQLite storage, services, EventBus, and adapter interfaces |
| `@agent-squad/adapters` | none | CLI adapters and process runners |
| `@agent-squad/daemon` | `agent-squad`, `agent-squadd` | HTTP API, SSE, CLI, and daemon lifecycle |
| `@agent-squad/mcp` | `agent-squad-mcp` | stdio MCP shim for main agents |
| `@agent-squad/tui` | `agent-squad tui` | Ink/React terminal UI |

## Permission Profiles

| CLI | Profile | Flags |
|---|---|---|
| Codex | `codex_workspace_auto` (default) | `--sandbox workspace-write -c approval_policy="never"` |
| Codex | `codex_readonly_auto` | `--sandbox read-only -c approval_policy="never"` |
| opencode | `opencode_auto` (default) | `--dangerously-skip-permissions` |
| Antigravity | `antigravity_sandbox` (default) | `--sandbox` |
| Antigravity | `antigravity_auto` | `--dangerously-skip-permissions` |
| Claude Code | `claude_auto` (default) | `--permission-mode bypassPermissions --model default --effort max` |
| Claude Code | `claude_prompt` | `--permission-mode default` |
| Claude Code | `claude_plan` | `--permission-mode plan` |
| Kimi Code | `kimi_auto` (default) | Standard ACP tool permissions allow once; questions and plan reviews are relayed to the main agent |
| Kimi Code | `kimi_readonly` | Every prompted native operation is rejected because Kimi does not expose a reliable read/write kind |

## Configuration

Agent Squad reads `agent-squad.yml` from the project root or `~/.agent-squad/config.yml`:

```yaml
server:
  host: 127.0.0.1
  port: 28771
  db_path: ~/.agent-squad/agent-squad.db
context_policy:
  default: message_only
subagents:
  claude:
    english_input:
      enabled: true
      minimum_ratio: 0.6
  codex:
    model_profiles:
      "gpt-5.6-luna":
        strengths: [routine implementation, bug fixes]
        weaknesses: [high-risk architecture]
        recommended_for: [implementation, testing]
        avoid_for: [security review]
        cost_tier: low
        latency_tier: fast
        priority: 95
        effort_profiles:
          max:
            summary: Preferred when routine work needs extra care
            priority: 98
```

Agent Squad ships versioned official profiles for models exposed by Codex, OpenCode, Antigravity, Claude Code, and Kimi Code. `list_subagent_types` merges those profiles into each discovered model so the main agent can compare strengths, weaknesses, task fit, relative cost/latency, and reasoning-effort guidance. User `model_profiles` are partial overrides and accept exact model IDs or `*` glob patterns. These fields are routing hints, not pricing guarantees.

## Development

```bash
npm install
npm test
npm run build
npm run test:watch
```

## Security Notes

- The daemon is intended to run locally on `127.0.0.1`.
- Subagents run real local coding CLIs with the configured permission profile.
- Review permission profiles before delegating work in sensitive repositories.
- Never commit GitHub PATs, npm tokens, or local `.npmrc` files containing auth tokens.
