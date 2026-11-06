#!/usr/bin/env bash
# Place one outbound call with curl: POST /v1/calls.
#
#   export SEMPERA_API_KEY=...
#   AGENT=northwind-barbers TO=+14165550100 CONSENT="They asked us to call about Friday." \
#     ./send-call.sh
#
# CONSENT is required. IDEMPOTENCY_KEY defaults to a new UUID; reuse one to make a
# retry safe. The JSON body is built by python3 so quotes in CONSENT stay valid.
# The key reaches curl through a file descriptor (printf is a shell builtin), so it
# never appears on a command line.

set -euo pipefail

: "${SEMPERA_API_KEY:?set SEMPERA_API_KEY first}"
: "${AGENT:?set AGENT to the agent id}"
: "${TO:?set TO to the destination number}"
: "${CONSENT:?set CONSENT to why this person may be called}"

BASE="${SEMPERA_API_BASE:-https://api.sempera.org}"
KEY="${IDEMPOTENCY_KEY:-$(python3 -c 'import uuid; print(uuid.uuid4())')}"
BODY="$(python3 -c 'import json, sys; print(json.dumps({"agent_id": sys.argv[1], "to": sys.argv[2], "consent_basis": sys.argv[3]}))' "$AGENT" "$TO" "$CONSENT")"

curl -sS -X POST "$BASE/v1/calls" \
  -H @<(printf 'Authorization: Bearer %s\n' "$SEMPERA_API_KEY") \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  --data "$BODY"
echo
