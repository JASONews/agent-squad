#!/usr/bin/env bash
# Manual Codex acceptance: real Codex round-trip. NOT run by Vitest.
# Requires: codex installed + authenticated (codex login).
#
# Verifies the Codex adapter acceptance flow:
#   1. codex appears in list_subagent_types (registered by daemon)
#   2. spawn_subagent({cli:'codex'}) + send returns a real codex reply
#   3. resume (second send) uses codex exec resume <thread_id>
#   4. the subagent row's native_session_id is populated (the captured thread_id)
set -euo pipefail

PORT=${AGENT_SQUAD_PORT:-28771}
BASE="http://127.0.0.1:${PORT}"
CWD="${AGENT_SQUAD_ACCEPTANCE_CWD:-/tmp}"
DB="${HOME}/.agent-squad/agent-squad.db"

echo "Starting daemon (codex auto-registers; mock also gated on for safety)..."
AGENT_SQUAD_ENABLE_MOCK=1 npx tsx packages/daemon/src/index.ts > /tmp/asq-m2a.log 2>&1 &
DPID=$!
trap 'kill $DPID 2>/dev/null || true' EXIT
sleep 2

echo "=== list_subagent_types (expect codex: available) ==="
curl -s "${BASE}/v1/subagent-types"

echo ""
echo "=== start_session ==="
SID=$(curl -s -X POST "${BASE}/v1/sessions" -H 'content-type: application/json' \
  -d "{\"cwd\":\"${CWD}\",\"task\":\"m2a acceptance\",\"owner_cli\":\"claude_code\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['session_id'])")
echo "session: ${SID}"

echo "=== spawn codex reviewer (codex_readonly_auto) ==="
curl -s -X POST "${BASE}/v1/sessions/${SID}/subagents" -H 'content-type: application/json' \
  -d '{"alias":"rev","cli":"codex","role":"reviewer","message":"initial","permission_profile":"codex_readonly_auto"}'
echo ""

echo "=== send (first): 'Reply with exactly the word pong' ==="
curl -s -X POST "${BASE}/v1/sessions/${SID}/subagents/rev/messages" -H 'content-type: application/json' \
  -d '{"message":"Reply with exactly the word pong and nothing else.","wait":true}'
echo ""

echo "=== send (resume): 'What word did I just ask you to reply with? Answer with just that word.' ==="
curl -s -X POST "${BASE}/v1/sessions/${SID}/subagents/rev/messages" -H 'content-type: application/json' \
  -d '{"message":"What word did I just ask you to reply with? Answer with just that word.","wait":true}'
echo ""

echo "=== subagent row (native_session_id should be a thread_id UUID) ==="
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DB}" "SELECT id, cli_type, native_session_id, status FROM subagents WHERE session_id='${SID}';"
else
  echo "(sqlite3 not available — verify native_session_id via another tool)"
fi

echo "=== done ==="
