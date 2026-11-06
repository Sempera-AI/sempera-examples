#!/usr/bin/env python3
"""Place one outbound call with POST /v1/calls.

    SEMPERA_API_KEY=... python3 send-call.py --agent northwind-barbers \
        --to +14165550100 --consent "They asked us to call about Friday."

--consent is required: the API never decides who may be called for you, and
neither does this example. Pass --idempotency-key to make a retry safe.
"""

import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from client import client_from_env, new_key  # noqa: E402


def send_call(client, agent: str, to: str, consent: str, message: str | None = None, idempotency_key: str | None = None) -> dict:
    if not (agent and to and consent):
        raise ValueError("agent, to and consent are all required")
    body = {"agent_id": agent, "to": to, "consent_basis": consent}
    if message:
        body["message"] = message
    return client.request("POST", "/v1/calls", body=body, idempotency_key=idempotency_key or new_key())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--agent", required=True)
    parser.add_argument("--to", required=True)
    parser.add_argument("--consent", required=True)
    parser.add_argument("--message")
    parser.add_argument("--idempotency-key")
    args = parser.parse_args(argv)
    call = send_call(client_from_env(), args.agent, args.to, args.consent, args.message, args.idempotency_key)
    print(json.dumps({"id": call.get("id"), "status": call.get("status"), "direction": call.get("direction")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
