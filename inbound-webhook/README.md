# Inbound webhook receiver

A small server that accepts Sempera's signed outbound events (`call.completed`, `call.outcomes`, `agent.published`, `test.completed`, `batch.updated` and `webhook.test`) and proves each one came from Sempera before reading it. Node and Python, no packages.

```bash
SEMPERA_WEBHOOK_SECRET=whsec_your_endpoint_secret PORT=8787 node receiver.mjs
SEMPERA_WEBHOOK_SECRET=whsec_your_endpoint_secret PORT=8787 python3 receiver.py
```

Both listen on `localhost:<PORT>` at `POST /sempera`. Put your own HTTPS endpoint in front of it, then register that URL with the same secret:

```bash
curl -sS -X POST https://api.sempera.org/v1/webhooks \
  -H "Authorization: Bearer $SEMPERA_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: receiver-setup-1" \
  --data '{"url":"https://hooks.example.com/sempera","events":["call.completed"],"secret":"whsec_your_endpoint_secret"}'
```

The secret is 16 to 256 characters, stored by Sempera encrypted and never returned.

## What the receiver does, in order

1. Reads the raw body bytes before anything parses them.
2. Reads `X-Sempera-Signature` (`t=<unix seconds>,v1=<hex>`). It refuses a `t` more than 300 seconds from its clock, in either direction.
3. Computes HMAC-SHA256 with the secret over `"<t>." + raw body` and compares it to `v1` in constant time. A mismatch is `401` and the body is never parsed.
4. Drops an `X-Sempera-Event-Id` it has already handled and answers `200`, so Sempera does not retry.
5. Hands the parsed envelope to your handler. Replace the default `console.log` (or `print`) with your own code.

Sempera delivers at least once. Answer `2xx` only after your handler has finished; a slow or failing receiver is retried. The `seen` set is in memory here. Store the ids in a database in production.

## Test the signature without a live endpoint

The signing scheme has a published known answer. The tests in `../test` check both implementations against it:

```text
secret = whsec_vector_0123456789
t      = 1790000000
body   = {"created_at":"2026-09-28T12:00:00+00:00","data":{"actor":"vector","endpoint_id":"22222222-2222-4222-8222-222222222222"},"id":"evt_00000000000000000000000000000001","object":"event","type":"webhook.test","workspace_id":"11111111-1111-4111-8111-111111111111"}
X-Sempera-Signature = t=1790000000,v1=1f4226699ca9fa61b71fbb57dbd2f57efa6788488437ee2e411ea4e3002be3c1
```

Use `POST /v1/webhooks/{id}/test` to have Sempera send a signed `webhook.test` to a registered endpoint and see what your receiver answered.
