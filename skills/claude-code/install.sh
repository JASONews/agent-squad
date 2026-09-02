#!/usr/bin/env bash
# Install agent-squad skill into the current project for Claude Code.
# Usage: bash skills/claude-code/install.sh
#
# This script:
# 1. Writes a .mcp.json pointing at the agent-squad MCP shim (compiled dist)
# 2. Installs the agent-squad skill into ~/.claude/skills/
# 3. Prints next steps

set -euo pipefail

# Resolve the agent-squad root (parent of skills/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_SQUAD_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DIST_SHIM="$AGENT_SQUAD_DIR/packages/mcp/dist/index.js"

if [ ! -f "$DIST_SHIM" ]; then
  echo "ERROR: MCP shim not found at $DIST_SHIM"
  echo "Run 'npm run build' in the agent-squad directory first."
  exit 1
fi

CWD="$(pwd)"

# 1. Write .mcp.json
MCP_JSON="$CWD/.mcp.json"
if [ -f "$MCP_JSON" ]; then
  # Check if agent-squad is already configured
  if grep -q "agent-squad" "$MCP_JSON"; then
    echo ".mcp.json already has agent-squad — skipping"
  else
    # Merge agent-squad into existing .mcp.json
    python3 -c "
import json, sys
with open('$MCP_JSON') as f: d = json.load(f)
d.setdefault('mcpServers', {})['agent-squad'] = {
    'command': 'node',
    'args': ['$DIST_SHIM'],
    'env': {'AGENT_SQUAD_URL': 'http://127.0.0.1:28771'}
}
with open('$MCP_JSON', 'w') as f: json.dump(d, f, indent=2)
print('Added agent-squad to existing .mcp.json')
"
  fi
else
  cat > "$MCP_JSON" << ENDJSON
{
  "mcpServers": {
    "agent-squad": {
      "command": "node",
      "args": ["$DIST_SHIM"],
      "env": {
        "AGENT_SQUAD_URL": "http://127.0.0.1:28771"
      }
    }
  }
}
ENDJSON
  echo "Created .mcp.json with agent-squad MCP config"
fi

# 2. Install agent-squad as a Claude Code skill
SKILL_NAME="agent-squad"
SKILL_SRC="$AGENT_SQUAD_DIR/skills/$SKILL_NAME"
SKILL_DEST="$HOME/.claude/skills/$SKILL_NAME"
mkdir -p "$(dirname "$SKILL_DEST")"
rm -rf "$SKILL_DEST"
cp -r "$SKILL_SRC" "$SKILL_DEST"
echo "Installed agent-squad skill to $SKILL_DEST"

# 3. Print next steps
echo ""
echo "=== Installation complete ==="
echo ""
echo "Next steps:"
echo "1. Start the agent-squad daemon:"
echo "   node $AGENT_SQUAD_DIR/packages/daemon/dist/index.js &"
echo ""
echo "2. (Optional) Install MCP config into your coding CLIs:"
echo "   npx tsx $AGENT_SQUAD_DIR/packages/daemon/src/cli/index.ts install codex"
echo "   npx tsx $AGENT_SQUAD_DIR/packages/daemon/src/cli/index.ts install opencode"
echo ""
echo "3. Restart Claude Code — it will pick up the .mcp.json and agent-squad skill automatically."
echo ""
echo "4. Ask Claude Code to spawn a subagent:"
echo "   'Review my changes using a codex subagent'"
