#!/usr/bin/env python3
"""Check that a calendar is connected and verified, then place a call whose agent
books through it.

    SEMPERA_API_KEY=... python3 book-a-call.py --agent northwind-barbers \
        --to +14165550100 --consent "They asked us to find a time for a trim."

The calendar itself is connected in the Sempera App (Google Calendar and Cal.com
use an OAuth screen there). The API cannot start that consent, so this example
only finds a connection that already exists and checks it. The agent must also
have that integration attached as a tool.
"""

import argparse
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from client import client_from_env, new_key  # noqa: E402

BOOKING_TASK = "Offer the caller two open times from the connected calendar, then book the one they choose and confirm it back."
CALENDAR = re.compile(r"calendar|cal\.com|calendly", re.IGNORECASE)


def find_connected_calendar(integrations: list[dict]) -> dict | None:
    """A calendar connection is connected, not merely configured or awaiting verification."""
    for item in integrations:
        label = f"{item.get('kind') or ''} {item.get('name') or ''}"
        if item.get("status") == "connected" and CALENDAR.search(label):
            return item
    return None


def book_with_calendar(client, agent: str, to: str, consent: str, idempotency_key: str | None = None) -> dict:
    if not (agent and to and consent):
        raise ValueError("agent, to and consent are all required")
    listed = client.request("GET", "/v1/integrations")
    calendar = find_connected_calendar(listed.get("data", {}).get("integrations", []))
    if calendar is None:
        raise SystemExit("no connected calendar: connect Google Calendar or Cal.com in the Sempera App, then run this again")
    verification = client.request("POST", f"/v1/integrations/{calendar['id']}/verify")
    if verification.get("status") != "connected":
        raise SystemExit(f"calendar {calendar['id']} did not verify (status {verification.get('status')})")
    call = client.request(
        "POST",
        "/v1/calls",
        body={"agent_id": agent, "to": to, "consent_basis": consent, "task": BOOKING_TASK},
        idempotency_key=idempotency_key or new_key(),
    )
    return {"integration": calendar["id"], "call": call}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--agent", required=True)
    parser.add_argument("--to", required=True)
    parser.add_argument("--consent", required=True)
    parser.add_argument("--idempotency-key")
    args = parser.parse_args(argv)
    outcome = book_with_calendar(client_from_env(), args.agent, args.to, args.consent, args.idempotency_key)
    print(json.dumps({"integration": outcome["integration"], "call": outcome["call"].get("id"), "status": outcome["call"].get("status")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
