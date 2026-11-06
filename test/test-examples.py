#!/usr/bin/env python3
"""Offline tests for the Python examples. The HTTP layer is a fake opener, so
these prove request shapes, guards, the signature scheme and the output, not
live API behaviour. Run from the examples folder with `npm test` or
`python3 test/test-examples.py`.
"""

from __future__ import annotations

import importlib.util
import io
import json
import pathlib
import sys
import unittest
import urllib.error
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
EXAMPLES = HERE.parent
KEY = "sempera_sk_test_0123456789"


def load(relative: str):
    path = EXAMPLES / relative
    spec = importlib.util.spec_from_file_location(path.stem.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# One client module for the whole run: the examples' own `from client import ...`
# must see the same SemperaError class the tests catch.
client_mod = load("client.py")
sys.modules["client"] = client_mod
send_call = load("send-a-call/send-call.py")
receiver = load("inbound-webhook/receiver.py")
send_sms = load("sms-opt-out/send-sms.py")
book = load("booking-calendar/book-a-call.py")
batch = load("batch-csv/batch-calls.py")


class FakeResponse:
    def __init__(self, payload):
        self._raw = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def fake_opener(routes: dict, calls: list):
    """routes maps (METHOD, path) to (status, payload)."""

    def opener(req, timeout=None):
        path = urllib.parse.urlsplit(req.full_url).path
        body = json.loads(req.data) if req.data else None
        headers = {k.lower(): v for k, v in req.header_items()}
        calls.append({"method": req.get_method(), "path": path, "headers": headers, "body": body})
        status, payload = routes[(req.get_method(), path)]
        if status >= 400:
            raise urllib.error.HTTPError(req.full_url, status, "error", {}, io.BytesIO(json.dumps(payload).encode("utf-8")))
        return FakeResponse(payload)

    return opener


def client_with(routes: dict):
    calls: list = []
    return client_mod.Client(KEY, "https://api.sempera.org/", opener=fake_opener(routes, calls)), calls


class ClientTests(unittest.TestCase):
    def test_errors_carry_the_stable_fields_and_never_the_key(self):
        client, calls = client_with({("POST", "/v1/calls"): (403, {"error": {"code": "insufficient_scope", "message": "no", "request_id": "req_2", "reason": "scope"}})})
        with self.assertRaises(client_mod.SemperaError) as ctx:
            client.request("POST", "/v1/calls", body={"a": 1}, idempotency_key="k-1")
        self.assertEqual(ctx.exception.status, 403)
        self.assertEqual(ctx.exception.code, "insufficient_scope")
        self.assertEqual(ctx.exception.request_id, "req_2")
        self.assertNotIn(KEY, str(ctx.exception))
        self.assertEqual(calls[0]["headers"]["authorization"], f"Bearer {KEY}")
        self.assertEqual(calls[0]["headers"]["idempotency-key"], "k-1")

    def test_a_missing_key_is_refused(self):
        with self.assertRaises(SystemExit):
            client_mod.Client("")


class SendCallTests(unittest.TestCase):
    def test_the_call_carries_agent_number_and_consent(self):
        client, calls = client_with({("POST", "/v1/calls"): (201, {"id": "call-1", "status": "answered", "direction": "outbound"})})
        call = send_call.send_call(client, "northwind-barbers", "+14165550100", "They asked.", idempotency_key="friday")
        self.assertEqual(call["id"], "call-1")
        self.assertEqual(calls[0]["body"], {"agent_id": "northwind-barbers", "to": "+14165550100", "consent_basis": "They asked."})
        self.assertEqual(calls[0]["headers"]["idempotency-key"], "friday")

    def test_no_consent_means_no_request(self):
        client, calls = client_with({})
        with self.assertRaises(ValueError):
            send_call.send_call(client, "northwind-barbers", "+14165550100", "")
        self.assertEqual(calls, [])


class ReceiverTests(unittest.TestCase):
    SECRET = "whsec_vector_0123456789"
    BODY = b'{"created_at":"2026-09-28T12:00:00+00:00","data":{"actor":"vector","endpoint_id":"22222222-2222-4222-8222-222222222222"},"id":"evt_00000000000000000000000000000001","object":"event","type":"webhook.test","workspace_id":"11111111-1111-4111-8111-111111111111"}'
    HEADER = "t=1790000000,v1=1f4226699ca9fa61b71fbb57dbd2f57efa6788488437ee2e411ea4e3002be3c1"

    def test_the_published_known_answer_verifies_and_tampering_or_staleness_fails(self):
        now = 1790000000
        self.assertTrue(receiver.verify_signature(self.SECRET, self.BODY, self.HEADER, now=now))
        self.assertFalse(receiver.verify_signature(self.SECRET, self.BODY.replace(b"vector", b"other"), self.HEADER, now=now))
        self.assertFalse(receiver.verify_signature(self.SECRET, self.BODY, self.HEADER, now=now + 301))
        self.assertFalse(receiver.verify_signature(self.SECRET, self.BODY, self.HEADER, now=now - 301))
        self.assertFalse(receiver.verify_signature("whsec_wrong_secret_value", self.BODY, self.HEADER, now=now))
        self.assertFalse(receiver.verify_signature(self.SECRET, self.BODY, None, now=now))

    def test_a_signed_event_is_handled_once(self):
        seen: set = set()
        handled: list = []
        headers = {"x-sempera-signature": self.HEADER, "x-sempera-event-id": "evt_00000000000000000000000000000001"}
        now = 1790000000
        self.assertEqual(receiver.handle_delivery(self.SECRET, headers, self.BODY, seen, handled.append, now=now), (200, "handled"))
        self.assertEqual(receiver.handle_delivery(self.SECRET, headers, self.BODY, seen, handled.append, now=now), (200, "duplicate"))
        self.assertEqual(receiver.handle_delivery(self.SECRET, {}, self.BODY, seen, handled.append, now=now), (401, "bad_signature"))
        self.assertEqual([event["type"] for event in handled], ["webhook.test"])


class SmsTests(unittest.TestCase):
    def test_an_opted_out_recipient_gets_no_text(self):
        client, calls = client_with({("GET", "/v1/sms/conversations/sc-1/policy"): (200, {"data": {"consent": "opted_out", "can_send": False, "reason": "opted_out"}})})
        self.assertEqual(send_sms.reply_if_allowed(client, "sc-1", "Hi", "They texted."), {"sent": False, "reason": "opted_out"})
        self.assertEqual(len(calls), 1)

    def test_an_allowed_reply_carries_the_consent_basis(self):
        client, calls = client_with({
            ("GET", "/v1/sms/conversations/sc-1/policy"): (200, {"data": {"consent": "not_opted_out", "can_send": True}}),
            ("POST", "/v1/sms/conversations/sc-1/messages"): (201, {"data": {"status": "sent"}}),
        })
        outcome = send_sms.reply_if_allowed(client, "sc-1", "Confirmed.", "They texted.", idempotency_key="r-1")
        self.assertTrue(outcome["sent"])
        self.assertEqual(calls[1]["body"], {"message": "Confirmed.", "consent_basis": "They texted."})
        self.assertEqual(calls[1]["headers"]["idempotency-key"], "r-1")

    def test_an_opt_out_refused_at_the_last_moment_is_reported(self):
        client, _ = client_with({
            ("GET", "/v1/sms/conversations/sc-1/policy"): (200, {"data": {"consent": "not_opted_out", "can_send": True}}),
            ("POST", "/v1/sms/conversations/sc-1/messages"): (403, {"error": {"code": "PHONE_RECIPIENT_OPTED_OUT", "message": "The recipient texted STOP"}}),
        })
        self.assertEqual(send_sms.reply_if_allowed(client, "sc-1", "Hi", "They texted."), {"sent": False, "reason": "opted_out"})

    def test_recording_an_opt_out_posts_an_empty_object(self):
        client, calls = client_with({("POST", "/v1/sms/conversations/sc-1/opt-out"): (200, {"data": {"consent": "opted_out"}})})
        self.assertEqual(send_sms.record_opt_out(client, "sc-1", idempotency_key="o-1"), {"consent": "opted_out"})
        self.assertEqual(calls[0]["body"], {})


class BookingTests(unittest.TestCase):
    def test_a_configured_but_unverified_calendar_is_not_used(self):
        self.assertIsNone(book.find_connected_calendar([{"id": "a", "kind": "calendar", "status": "configured"}]))
        self.assertEqual(book.find_connected_calendar([{"id": "b", "name": "Cal.com", "status": "connected"}])["id"], "b")

    def test_no_connected_calendar_stops_before_any_call(self):
        client, calls = client_with({("GET", "/v1/integrations"): (200, {"data": {"integrations": []}})})
        with self.assertRaises(SystemExit):
            book.book_with_calendar(client, "northwind-barbers", "+14165550100", "They asked.")
        self.assertEqual(len(calls), 1)

    def test_a_verified_calendar_is_booked_by_a_call_with_the_booking_task(self):
        client, calls = client_with({
            ("GET", "/v1/integrations"): (200, {"data": {"integrations": [{"id": "int-9", "kind": "google_calendar", "status": "connected"}]}}),
            ("POST", "/v1/integrations/int-9/verify"): (200, {"status": "connected"}),
            ("POST", "/v1/calls"): (201, {"id": "call-9", "status": "answered"}),
        })
        outcome = book.book_with_calendar(client, "northwind-barbers", "+14165550100", "They asked.", idempotency_key="b-1")
        self.assertEqual(outcome["integration"], "int-9")
        self.assertEqual(outcome["call"]["id"], "call-9")
        self.assertIn("book the one they choose", calls[2]["body"]["task"])


class BatchTests(unittest.TestCase):
    def test_quoted_fields_and_empty_metadata(self):
        recipients = batch.recipients_from_csv('phone_number,first_name,appointment,timezone\n+14165550100,"Ada, Lovelace",,America/Toronto\n')
        self.assertEqual(recipients, [{"phone_number": "+14165550100", "timezone": "America/Toronto", "metadata": {"first_name": "Ada, Lovelace"}}])

    def test_a_row_without_a_number_refuses_the_file_and_names_the_line(self):
        with self.assertRaisesRegex(ValueError, "line 3 has no phone_number"):
            batch.recipients_from_csv("phone_number,first_name\n+14165550100,Ada\n,Grace\n")
        with self.assertRaisesRegex(ValueError, "phone_number column"):
            batch.recipients_from_csv("first_name\nAda\n")

    def test_the_batch_posts_the_global_consent_with_an_idempotency_key(self):
        client, calls = client_with({("POST", "/v2/batches/create"): (201, {"data": {"id": "batch-1", "state": "running"}})})
        outcome = batch.start_batch(client, "northwind-barbers", "They booked.", "phone_number\n+14165550100\n", idempotency_key="batch-key")
        self.assertEqual(outcome["recipients"], 1)
        self.assertEqual(outcome["batch"]["id"], "batch-1")
        self.assertEqual(calls[0]["headers"]["idempotency-key"], "batch-key")
        self.assertEqual(calls[0]["body"]["global"], {"agent_id": "northwind-barbers", "consent_basis": "They booked."})


class NoEmDashTests(unittest.TestCase):
    def test_no_example_file_uses_an_em_dash(self):
        for path in EXAMPLES.rglob("*"):
            if path.is_file() and "node_modules" not in path.parts and path.suffix in {".md", ".py", ".mjs", ".sh", ".csv", ".json"} and path.parent != HERE:
                self.assertNotIn("\u2014", path.read_text(encoding="utf-8"), str(path))


if __name__ == "__main__":
    unittest.main(verbosity=1)
