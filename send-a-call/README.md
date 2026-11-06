# Send a call

Places one outbound call from a published agent with `POST /v1/calls`, in Node, Python or curl. The three do the same thing.

```bash
export SEMPERA_API_KEY=sempera_sk_...           # your developer key
node send-call.mjs --agent northwind-barbers --to +14165550100 \
  --consent "They asked us to call about Friday."
python3 send-call.py --agent northwind-barbers --to +14165550100 \
  --consent "They asked us to call about Friday."
AGENT=northwind-barbers TO=+14165550100 CONSENT="They asked us to call about Friday." ./send-call.sh
```

Each prints the call's `id`, `status` and `direction`. The call object is the dispatch record: whether the call was answered and how it ended come later, from `GET /v1/calls/{id}` and the `call.completed` webhook.

## Rules this example keeps

- `consent` (sent as `consent_basis`) is required. Nothing defaults it, because the consent wording is a legal fact about the person you are calling.
- Every request carries an `Idempotency-Key`. Pass `--idempotency-key` (or `IDEMPOTENCY_KEY`) with one value per intended call, and a retry returns the first answer instead of dialing again.
- Before dialing, the API checks the number against the workspace's do-not-contact list and its outbound limits. A refusal comes back as an error envelope; the example prints it unchanged.

## Requirements

- Node 18.3 or later, or Python 3.9 or later, or curl. No packages to install.
- A developer key with `calls:write`.

Use `555-01xx` numbers such as `+14165550100` while you test. They are not real lines.
