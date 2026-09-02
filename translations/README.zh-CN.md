# Agent Squad

**面向 coding CLI 的本地 external-subagent runtime。**

[English (default)](../README.md) | **简体中文**

Agent Squad 让主 agent（Claude Code / Codex / opencode / Antigravity / Kimi Code）通过本地 relay daemon 调用其他已经登录的 coding CLI 作为 external subagent，一起完成同一个任务。每个 CLI 保留自己的登录态、模型、工具、权限和原生上下文。

```text
Main Agent (Claude Code / Codex / opencode / Antigravity / Kimi Code)
    -> MCP tools / HTTP API
agent-squadd (local daemon + SQLite + SSE)
    -> spawn + resume + message relay
Codex / opencode / Antigravity / Claude Code / Kimi Code subagent
```

## 功能

- 多 CLI 子代理：spawn Codex、opencode、Antigravity、Claude Code、Kimi Code 作为 external subagent，并支持多轮 resume。
- Choice Relay：子代理需要用户做方向选择时，可以把选项交给主 agent，再带着选择继续执行。
- 实时 TUI：查看会话、子代理状态、消息时间线、pending choices、blocked 子代理和 live output tail。
- PTY Approval Bridge：对子代理 CLI 的常见 permission prompt 自动确认。
- 权限配置：每个 CLI 都有可配置的 permission profile。
- MCP 安装器：把 Agent Squad MCP shim 注册到支持的 coding CLI。

## 环境要求

- Node.js 20 或更高版本
- npm
- 至少安装并登录一个支持的 coding CLI：
  - Codex
  - opencode
  - Antigravity
  - Claude Code
  - Kimi Code

## 快速开始

### 安装已发布的 Package

Agent Squad 已作为公开 package 发布到 npm registry，无需配置 registry token：

```bash
npm install -g @jasonews/agent-squad
```

验证安装后的命令：

```bash
agent-squad --help
agent-squadd --help
agent-squad-mcp --help
```

### 从源码构建

```bash
git clone https://github.com/JASONews/agent-squad.git
cd agent-squad
npm ci
npm run build
npm link
```

安装 package 或 link 源码后，以下命令可用：

```bash
agent-squad       # CLI 入口：daemon、install、discover、doctor、tui
agent-squadd      # 前台 daemon
agent-squad-mcp   # 主 agent 使用的 stdio MCP shim
```

## 启动 Daemon

```bash
agent-squadd
```

或者后台启动：

```bash
agent-squad daemon start
agent-squad daemon status
```

检查安装状态：

```bash
agent-squad doctor
```

检测可用 coding CLI：

```bash
agent-squad discover
```

## 安装 MCP 配置

把 Agent Squad 注册为支持的 CLI 的 MCP server：

```bash
agent-squad install codex
agent-squad install opencode
agent-squad install antigravity
agent-squad install claude
agent-squad install kimi
```

每个 installer 都会备份原配置，并且重复运行不会重复写入。

Claude Code 也可以使用项目内 `.mcp.json`：

```json
{
  "mcpServers": {
    "agent-squad": {
      "command": "agent-squad-mcp"
    }
  }
}
```

安装 Agent Squad skill 指令：

```bash
bash skills/install.sh all
```

## MCP 工具

| 工具 | 用途 |
|---|---|
| `start_session` | 创建一个协作会话 |
| `list_subagent_types` | 查看可用子代理、动态发现的模型以及模型级能力画像 |
| `spawn_subagent` | 启动一个子代理（`codex`、`opencode`、`antigravity`、`claude`、`kimi`） |
| `send_to_subagent` | 向子代理发送消息 |
| `wait_subagent` | 等待正在运行的子代理结果，不发送新消息 |
| `request_choice` / `resolve_choice` | 请求和返回用户选择 |
| `post_artifact` / `get_artifact` | 发布和读取 artifact |
| `get_subagent_messages` | 查看消息时间线 |

## 示例

```text
用户：请实现一个 Ollama embedding 设置功能。

主 agent：
1. start_session({ cwd: ".", task: "Implement Ollama embedding settings" })
2. 自己实现主要逻辑。
3. spawn_subagent({ cli: "codex", alias: "rev", role: "reviewer", message: "Review my changes" })
4. send_to_subagent({ alias: "rev", message: "Review the diff", wait: true })
5. 如果返回 running，调用 wait_subagent({ alias: "rev", timeout_ms: 300000 })
6. 如果收到 choice_requested，把选项展示给用户，再调用 resolve_choice。
7. 整合 review 结果。
```

`spawn_subagent` 不会启动模型 turn。OpenCode 和 Kimi Code 会通过 ACP 预分配可恢复的原生会话，因此 spawn 结果中可能已经包含 `nativeSessionId`。Codex、Claude Code 和 Antigravity 则会在首次真实运行报告 ID 时立即持久化，无需等到长任务退出。无论哪种情况，都必须调用 `send_to_subagent` 才会开始模型工作。

## TUI

```bash
agent-squad tui
```

视图：

- Session List：所有会话概览、子代理数量、pending choices、blocked 状态。
- Session Detail：消息时间线、子代理、live output tail、artifacts、choices。
- Choice Console：pending choices 列表。
- Blocked Console：blocked 子代理和 raw output tail。

快捷键：`Up`/`Down` 导航，`Enter` 进入，`c` 查看 choices，`b` 查看 blocked 子代理，`q` 返回或退出。

## 架构

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

## npm 发布包与仓库 Workspaces

npm 对外只发布一个 package：`@jasonews/agent-squad`，提供 `agent-squad`、
`agent-squadd` 和 `agent-squad-mcp` 三个命令。下列 `@agent-squad/*` package
是 monorepo 内部 workspaces，不会单独发布。

| 内部 workspace | `@jasonews/agent-squad` 提供的命令 | 用途 |
|---|---|---|
| `@agent-squad/core` | 无 | SQLite 存储、服务层、EventBus、adapter 接口 |
| `@agent-squad/adapters` | 无 | CLI adapters 和 process runners |
| `@agent-squad/daemon` | `agent-squad`、`agent-squadd` | HTTP API、SSE、CLI、daemon lifecycle |
| `@agent-squad/mcp` | `agent-squad-mcp` | 主 agent 使用的 stdio MCP shim |
| `@agent-squad/tui` | `agent-squad tui` | Ink/React 终端 UI |

## 权限配置

| CLI | Profile | Flags |
|---|---|---|
| Codex | `codex_workspace_auto`（默认） | `--sandbox workspace-write -c approval_policy="never"` |
| Codex | `codex_readonly_auto` | `--sandbox read-only -c approval_policy="never"` |
| opencode | `opencode_auto`（默认） | `--dangerously-skip-permissions` |
| Antigravity | `antigravity_sandbox`（默认） | `--sandbox` |
| Antigravity | `antigravity_auto` | `--dangerously-skip-permissions` |
| Claude Code | `claude_auto`（默认） | `--permission-mode bypassPermissions --model default --effort max` |
| Claude Code | `claude_prompt` | `--permission-mode default` |
| Claude Code | `claude_plan` | `--permission-mode plan` |
| Kimi Code | `kimi_auto`（默认） | 标准 ACP 工具权限自动选择 allow once；选择题和 plan review 会转发给主 agent |
| Kimi Code | `kimi_readonly` | 拒绝所有需要确认的原生操作，因为 Kimi 不提供可靠的读写类型标识 |

## 配置

Agent Squad 会读取项目根目录或 `~/.agent-squad/config.yml` 中的 `agent-squad.yml`：

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
        strengths: [常规实现, bug 修复]
        weaknesses: [高风险架构决策]
        recommended_for: [implementation, testing]
        avoid_for: [security review]
        cost_tier: low
        latency_tier: fast
        priority: 95
        effort_profiles:
          max:
            summary: 常规工作需要更谨慎时优先使用
            priority: 98
```

Agent Squad 为 Codex、OpenCode、Antigravity、Claude Code 和 Kimi Code 维护随版本发布的官方模型画像。`list_subagent_types` 会把画像合并到动态发现的模型中，让主 agent 比较 strengths、weaknesses、适用任务、相对成本/延迟以及 reasoning effort 建议。用户可以通过 `model_profiles` 做局部覆盖；键支持精确模型 ID 或 `*` glob。画像仅用于路由参考，不代表价格承诺。

## 开发

```bash
npm install
npm test
npm run build
npm run test:watch
```

## 安全说明

- daemon 设计为仅在本机 `127.0.0.1` 运行。
- 子代理会运行真实的本地 coding CLI，并使用配置的 permission profile。
- 在敏感仓库里委派任务前，请先确认对应 permission profile。
- 不要提交 GitHub PAT、npm token 或包含认证 token 的本地 `.npmrc`。
