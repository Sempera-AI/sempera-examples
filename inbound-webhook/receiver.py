#!/usr/bin/env python3
"""A webhook receiver for Sempera's signed outbound events (standard library only).

    SEMPERA_WEBHOOK_SECRET=... PORT=8787 python3 receiver.py

Point a registered https endpoint (POST /v1/webhooks) at this server's /sempera
path through your own HTTPS front door. Every delivery is checked against
X-Sempera-Signature before its body is parsed, and an event id already handled
is acknowledged without running the handler again.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def verify_signature(secret: str, raw_body: bytes, header: str | None, now: float | None = None, tolerance: int = 300) -> bool:
    """X-Sempera-Signature is "t=<unix seconds>,v1=<hex HMAC-SHA256>"; the HMAC is
    keyed with the endpoint secret over "<t>." followed by the raw body bytes."""
    if not secret or not header:
        return False
    parts = dict(part.split("=", 1) for part in header.split(",") if "=" in part)
    try:
        t = int(parts["t"])
    except (KeyError, ValueError):
        return False
    current = time.time() if now is None else now
    if abs(current - t) > tolerance:
        return False
    expected = hmac.new(secret.encode("utf-8"), f"{t}.".encode("utf-8") + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))


def handle_delivery(secret: str, headers: dict, raw_body: bytes, seen: set, on_event, now: float | None = None) -> tuple[int, str]:
    """Return (status, reason) for one delivery. `seen` holds handled event ids;
    keep it in a database in production, because deliveries are at least once."""
    if not verify_signature(secret, raw_body, headers.get("x-sempera-signature"), now=now):
        return 401, "bad_signature"
    event_id = headers.get("x-sempera-event-id")
    if not event_id:
        return 400, "missing_event_id"
    if event_id in seen:
        return 200, "duplicate"
    on_event(json.loads(raw_body.decode("utf-8")))
    seen.add(event_id)
    return 200, "handled"


def make_handler(secret: str, seen: set, on_event):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 (http.server naming)
            if self.path != "/sempera":
                self.send_response(404)
                self.end_headers()
                return
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length)
            try:
                status, reason = handle_delivery(secret, {k.lower(): v for k, v in self.headers.items()}, raw_body, seen, on_event)
            except ValueError:
                status, reason = 400, "bad_json"
            payload = json.dumps({"reason": reason}).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format, *args):  # keep request bodies and headers out of logs
            return

    return Handler


def main() -> int:
    secret = os.environ.get("SEMPERA_WEBHOOK_SECRET", "")
    if not secret:
        raise SystemExit("SEMPERA_WEBHOOK_SECRET is not set")
    port = int(os.environ.get("PORT", "8787"))
    server = ThreadingHTTPServer(("localhost", port), make_handler(secret, set(), lambda event: print(event.get("type"), event.get("id"))))
    print(f"listening on {port} at /sempera")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
