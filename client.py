"""A minimal Sempera API client for the examples (standard library only).

Bearer authentication, JSON bodies, Idempotency-Key, and one error type that
carries the API's stable fields. It never prints or logs the key.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
import uuid

DEFAULT_BASE = "https://api.sempera.org"


class SemperaError(Exception):
    def __init__(self, status: int, payload: dict):
        error = (payload or {}).get("error") or {}
        self.status = status
        self.code = error.get("code")
        self.reason = error.get("reason")
        self.field = error.get("field")
        self.request_id = error.get("request_id")
        super().__init__(f"{status} {self.code or 'error'}: {error.get('message', 'request failed')}")


class Client:
    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE, opener=urllib.request.urlopen):
        if not api_key:
            raise SystemExit("SEMPERA_API_KEY is not set")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.opener = opener

    def request(self, method: str, path: str, body: dict | None = None, idempotency_key: str | None = None) -> dict:
        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        req = urllib.request.Request(self.base_url + path, data=data, method=method, headers=headers)
        try:
            with self.opener(req, timeout=30) as res:
                raw = res.read()
        except urllib.error.HTTPError as err:
            with err:
                payload = _json_or_empty(err.read())
            raise SemperaError(err.code, payload) from None
        return _json_or_empty(raw)


def _json_or_empty(raw: bytes) -> dict:
    try:
        return json.loads(raw) if raw else {}
    except ValueError:
        return {}


def client_from_env(env=os.environ) -> Client:
    return Client(env.get("SEMPERA_API_KEY", ""), env.get("SEMPERA_API_BASE") or DEFAULT_BASE)


def new_key() -> str:
    return str(uuid.uuid4())
