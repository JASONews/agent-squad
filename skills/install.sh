#!/usr/bin/env bash
# Install agent-squad skill into coding CLI skill systems.
#
# Usage:
#   bash skills/install.sh [target]
#
# Targets:
#   claude-code  — copies to ~/.claude/skills/
#   codex        — copies to ~/.codex/skills/
#   opencode     — copies to ~/.config/opencode/skills/
#   antigravity  — copies to ~/.gemini/config/skills/
#   kimi         — copies to ~/.kimi-code/skills/
#   all          — installs to all five
#
# One skill (agent-squad) covering both roles:
#   - Main agent: when/how to spawn subagents, handle choice_requested
#   - Subagent: how to output %%AGENT_SQUAD_CHOICE%% blocks, resume behavior

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_NAME="agent-squad"
TARGET="${1:-all}"

install_to_dir() {
  local dest="$1"
  mkdir -p "$dest/$SKILL_NAME"
  cp -R "$SCRIPT_DIR/$SKILL_NAME/." "$dest/$SKILL_NAME/"
  echo "  ✓ $SKILL_NAME → $dest"
}

install_claude_code() {
  echo "Installing to Claude Code..."
  install_to_dir "$HOME/.claude/skills"
}

install_codex() {
  echo "Installing to Codex..."
  install_to_dir "$HOME/.codex/skills"
}

install_opencode() {
  echo "Installing to opencode..."
  install_to_dir "$HOME/.config/opencode/skills"
}

install_antigravity() {
  echo "Installing to Antigravity..."
  install_to_dir "$HOME/.gemini/config/skills"
}

install_kimi() {
  echo "Installing to Kimi Code..."
  install_to_dir "${KIMI_CODE_HOME:-$HOME/.kimi-code}/skills"
}

case "$TARGET" in
  claude-code)  install_claude_code ;;
  codex)        install_codex ;;
  opencode)     install_opencode ;;
  antigravity)  install_antigravity ;;
  kimi)         install_kimi ;;
  all)
    install_claude_code
    install_codex
    install_opencode
    install_antigravity
    install_kimi
    ;;
  *)
    echo "Usage: bash skills/install.sh [claude-code|codex|opencode|antigravity|kimi|all]"
    exit 1
    ;;
esac

echo ""
echo "=== Done. Skill 'agent-squad' installed. ==="
echo "Covers both roles: main agent (spawn + resolve) and subagent (choice block + resume)."
echo ""
echo "Next: agent-squadd (start daemon) → agent-squad install codex (MCP config) → agent-squad doctor"
