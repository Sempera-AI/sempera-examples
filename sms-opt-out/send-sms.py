#!/usr/bin/env python3
"""Reply to an existing text conversation, but only after the API's policy says
the recipient has not opted out and the thread can still be sent to.

    SEMPERA_API_KEY=... python3 send-sms.py reply --conversation <id> \
        --message "Your appointment is confirmed." --consent "They texted us to book."
    SEMPERA_API_KEY=... python3 send-sms.py opt-out --conversation <id>

Sempera also refuses a send to an opted-out recipient (PHONE_RECIPIENT_OPTED_OUT);
this example reads the policy first so it can say why and not send at all.
"""

import argparse
import json
import pathlib
import sys
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from client import SemperaError, client_from_env, new_key  # noqa: E402


def _thread(conversation_id: str) -> str:
    return f"/v1/sms/conversations/{urllib.parse.quote(conversation_id, safe='')}"


def read_policy(client, conversation_id: str) -> dict:
    return client.request("GET", f"{_thread(conversation_id)}/policy").get("data", {})


def reply_if_allowed(client, conversation_id: str, message: str, consent: str, idempotency_key: str | None = None) -> dict:
    """Return {"sent": False, "reason": ...} when nothing was sent, else {"sent": True, "result": ...}."""
    if not (conversation_id and message and consent):
        raise ValueError("conversation, message and consent are all required")
    policy = read_policy(client, conversation_id)
    if policy.get("consent") == "opted_out":
        return {"sent": False, "reason": "opted_out"}
    if policy.get("consent") != "not_opted_out":
        return {"sent": False, "reason": "consent_unreadable"}
    if not policy.get("can_send"):
        return {"sent": False, "reason": policy.get("reason") or "cannot_send"}
    try:
        result = client.request(
            "POST",
            f"{_thread(conversation_id)}/messages",
            body={"message": message, "consent_basis": consent},
            idempotency_key=idempotency_key or new_key(),
        )
    except SemperaError as err:
        if err.code == "PHONE_RECIPIENT_OPTED_OUT":
            return {"sent": False, "reason": "opted_out"}
        raise
    return {"sent": True, "result": result}


def record_opt_out(client, conversation_id: str, idempotency_key: str | None = None) -> dict:
    """Record an opt-out the recipient gave outside the thread. It sends no text."""
    return client.request("POST", f"{_thread(conversation_id)}/opt-out", body={}, idempotency_key=idempotency_key or new_key()).get("data", {})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    reply = sub.add_parser("reply")
    reply.add_argument("--conversation", required=True)
    reply.add_argument("--message", required=True)
    reply.add_argument("--consent", required=True)
    reply.add_argument("--idempotency-key")
    opt = sub.add_parser("opt-out")
    opt.add_argument("--conversation", required=True)
    opt.add_argument("--idempotency-key")
    args = parser.parse_args(argv)
    client = client_from_env()
    if args.command == "reply":
        outcome = reply_if_allowed(client, args.conversation, args.message, args.consent, args.idempotency_key)
        print(json.dumps({"sent": True} if outcome["sent"] else outcome, indent=2))
    else:
        print(json.dumps(record_opt_out(client, args.conversation, args.idempotency_key), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
