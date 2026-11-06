#!/usr/bin/env python3
"""Start an outbound call batch from a CSV file with POST /v2/batches/create.

    SEMPERA_API_KEY=... python3 batch-calls.py --agent northwind-barbers \
        --csv sample-recipients.csv --consent "They booked with us and asked for reminders."
    python3 batch-calls.py --csv sample-recipients.csv --consent "..." --agent northwind-barbers --dry-run

The CSV needs a phone_number column. An optional timezone column applies to its
row. Every other column becomes that recipient's metadata (text values the
agent's opening template can use). One bad row refuses the whole batch.
"""

import argparse
import csv
import io
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from client import client_from_env, new_key  # noqa: E402


def recipients_from_csv(text: str) -> list[dict]:
    reader = csv.reader(io.StringIO(text))
    rows = [row for row in reader if any(cell.strip() for cell in row)]
    if not rows or "phone_number" not in [h.strip() for h in rows[0]]:
        raise ValueError("the CSV needs a phone_number column")
    columns = [h.strip() for h in rows[0]]
    recipients = []
    for number, cells in enumerate(rows[1:], start=2):
        if len(cells) != len(columns):
            raise ValueError(f"line {number} has {len(cells)} fields, expected {len(columns)}")
        record = {name: cell.strip() for name, cell in zip(columns, cells)}
        if not record["phone_number"]:
            raise ValueError(f"line {number} has no phone_number")
        obj = {"phone_number": record.pop("phone_number")}
        timezone = record.pop("timezone", "")
        if timezone:
            obj["timezone"] = timezone
        metadata = {key: value for key, value in record.items() if value}
        if metadata:
            obj["metadata"] = metadata
        recipients.append(obj)
    return recipients


def batch_body(agent: str, consent: str, recipients: list[dict], description: str | None = None) -> dict:
    body = {"global": {"agent_id": agent, "consent_basis": consent}, "call_objects": recipients}
    if description:
        body["description"] = description
    return body


def start_batch(client, agent: str, consent: str, csv_text: str, description: str | None = None, idempotency_key: str | None = None) -> dict:
    if not (agent and consent):
        raise ValueError("agent and consent are both required")
    recipients = recipients_from_csv(csv_text)
    if not recipients:
        raise ValueError("the CSV has no recipients")
    created = client.request(
        "POST",
        "/v2/batches/create",
        body=batch_body(agent, consent, recipients, description),
        idempotency_key=idempotency_key or new_key(),
    )
    return {"recipients": len(recipients), "batch": created.get("data", created)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--agent", required=True)
    parser.add_argument("--csv", required=True)
    parser.add_argument("--consent", required=True)
    parser.add_argument("--description")
    parser.add_argument("--idempotency-key")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    csv_text = pathlib.Path(args.csv).read_text(encoding="utf-8")
    if args.dry_run:
        recipients = recipients_from_csv(csv_text)
        print(json.dumps({"dry_run": True, "recipients": len(recipients), "first": recipients[:2]}, indent=2))
        return 0
    outcome = start_batch(client_from_env(), args.agent, args.consent, csv_text, args.description, args.idempotency_key)
    batch = outcome["batch"]
    print(json.dumps({"recipients": outcome["recipients"], "id": batch.get("id"), "state": batch.get("state"), "summary": batch.get("summary")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
