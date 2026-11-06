# Sempera API examples

[Documentation](https://docs.sempera.org) | [Webhooks](https://docs.sempera.org/webhooks) | [OpenAPI document](https://api.sempera.org/openapi.json) | [MIT licence](LICENSE)

Small, runnable examples of the public Sempera API in Node, Python and curl. Each one does a single real job: place a call, receive and verify webhooks, text without breaking opt-outs, book through a calendar, or start a batch from a CSV. They use only the routes in the Sempera developer documentation and the contract at `https://api.sempera.org/openapi.json`.

MIT licensed, copyright Sempera Labs, Inc. (see `license`).

| Example | What it does | Routes | Languages |
|---|---|---|---|
| [`send-a-call/`](send-a-call/README.md) | Places one outbound call | `POST /v1/calls` | Node, Python, curl |
| [`inbound-webhook/`](inbound-webhook/README.md) | Receives signed events and verifies them | `POST /v1/webhooks` (registration), signed deliveries | Node, Python |
| [`sms-opt-out/`](sms-opt-out/README.md) | Replies to a text only when the policy allows it | `GET .../policy`, `POST .../messages`, `POST .../opt-out` | Node, Python |
| [`booking-calendar/`](booking-calendar/README.md) | Checks a connected calendar, then places a booking call | `GET /v1/integrations`, `POST .../verify`, `POST /v1/calls` | Node, Python |
| [`batch-csv/`](batch-csv/README.md) | Starts an outbound batch from a CSV | `POST /v2/batches/create` | Node, Python |

## Quick start

You need Node 18.3 or later, or Python 3.9 or later, or curl. There are no packages to install.

```bash
export SEMPERA_API_KEY=sempera_sk_...            # a developer key, from the Sempera App
export SEMPERA_API_BASE=https://api.sempera.org  # optional; this is the default
node send-a-call/send-call.mjs --agent northwind-barbers --to +14165550100 \
  --consent "They asked us to call about Friday."
```

Every script refuses to run without the consent basis for the person it contacts. The examples never choose who to call, and a retry is safe when you pass the same `--idempotency-key`.

Use `555-01xx` numbers such as `+14165550100` and the demonstration agent `northwind-barbers` while you test. Neither is a real line or a real business.

## Files

- `client.mjs` and `client.py` are the shared client: bearer authentication, JSON, `Idempotency-Key`, and one error type that carries `code`, `reason`, `field` and `request_id`. They never print the key.
- `test/` holds the offline tests. They mock HTTP, so they check request shapes, guards and output. They do not prove live behaviour.

## Tests

```bash
npm test          # node --test for the Node examples, then the Python tests
```

Or run each half on its own with `node --test test/examples.test.mjs` and `python3 test/test-examples.py`.

Nothing here is published to npm or PyPI.

## Licence

MIT. See [LICENSE](LICENSE).
