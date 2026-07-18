#!/usr/bin/env bash
# Manual M4 acceptance: real agy round-trip. NOT run by vitest.
# Requires: agy installed + authenticated.
set -euo pipefail
PORT=${AGENT_SQUAD_PORT:-28771}
BASE="http://127.0.0.1:${PORT}"
CWD="${AGENT_SQUAD_ACCEPTANCE_CWD:-/tmp}"
DB="${HOME}/.agent-squad/agent-squad.db"

echo "Starting daemon..."
AGENT_SQUAD_ENABLE_MOCK=1 npx tsx packages/daemon/src/index.ts > /tmp/asq-m4.log 2>&1 &
DPID=$!
trap 'kill $DPID 2>/dev/null || true' EXIT
sleep 2

echo "=== list_subagent_types (expect antigravity: available) ==="
curl -s "${BASE}/v1/subagent-types" | python3 -c "import sys,json;d=json.load(sys.stdin);print([s['type']+':'+s['status'] for s in d['available_subagents']])"

echo "=== start_session ==="
SID=$(curl -s -X POST "${BASE}/v1/sessions" -H 'content-type: application/json' \
  -d "{\"cwd\":\"${CWD}\",\"task\":\"m4 acceptance\",\"owner_cli\":\"claude_code\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['session_id'])")
echo "session: ${SID}"

echo "=== spawn antigravity ui_implementer (antigravity_sandbox) ==="
curl -s -X POST "${BASE}/v1/sessions/${SID}/subagents" -H 'content-type: application/json' \
  -d '{"alias":"ui","cli":"antigravity","role":"ui_implementer","message":"initial","permission_profile":"antigravity_sandbox"}'
echo ""

echo "=== send (first): 'Reply with exactly the word pong' ==="
curl -s -X POST "${BASE}/v1/sessions/${SID}/subagents/ui/messages" -H 'content-type: application/json' \
  -d '{"message":"Reply with exactly the word pong and nothing else.","wait":true}'
echo ""

echo "=== send (resume): 'What word did I just ask? Reply with just that word.' ==="
curl -s -X POST "${BASE}/v1/sessions/${SID}/subagents/ui/messages" -H 'content-type: application/json' \
  -d '{"message":"What word did I just ask? Reply with just that word.","wait":true}'
echo ""

echo "=== subagent row (native_session_id should be a UUID from last_conversations.json) ==="
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DB}" "SELECT id, cli_type, native_session_id, status FROM subagents WHERE session_id='${SID}';"
fi
echo "=== done ==="
