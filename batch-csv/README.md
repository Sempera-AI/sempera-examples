# Batch calls from a CSV

Starts an outbound call batch from a CSV file, in Node and Python. Start with `--dry-run` to see exactly what would be sent.

```bash
export SEMPERA_API_KEY=sempera_sk_...
node batch-calls.mjs --csv sample-recipients.csv --agent northwind-barbers \
  --consent "They booked with us and asked for reminders." --dry-run
node batch-calls.mjs --csv sample-recipients.csv --agent northwind-barbers \
  --consent "They booked with us and asked for reminders."
python3 batch-calls.py --csv sample-recipients.csv --agent northwind-barbers \
  --consent "They booked with us and asked for reminders."
```

## The CSV

| Column | Required | What it does |
|---|---|---|
| `phone_number` | yes | The recipient, E.164 (`+14165550100` in the sample) |
| `timezone` | no | The recipient's zone for sending hours, for that row only |
| anything else | no | Becomes the recipient's `metadata`: text values the agent's opening template can use, such as `{first_name}` |

Quoted fields may contain commas. An empty cell is dropped from the metadata. A row with no phone number, or the wrong number of fields, refuses the whole batch and the message names the line. Nothing is skipped silently.

## The request

`POST /v2/batches/create` with an `Idempotency-Key`:

```json
{
  "global": { "agent_id": "northwind-barbers", "consent_basis": "..." },
  "call_objects": [
    { "phone_number": "+14165550100", "timezone": "America/Toronto", "metadata": { "first_name": "Ada", "appointment": "Friday, 3pm" } }
  ],
  "description": "optional label"
}
```

The answer carries the batch `id`, its `state` and a `summary`. Creation dispatches one pass through the consent, do-not-contact, quota and call-cap checks. Later passes run only when the deployment's outbound scheduler is on, so a batch can show queued recipients after it is created.

## Limits to know

- Starting a batch needs the `calls:write` scope and the owner outbound permission.
- Each recipient is checked against the do-not-contact list and the workspace's outbound limits before dialing. A blocked number is recorded as blocked, not called.
- Stop a batch with `POST /v2/batches/{id}/stop`. It stops future recipients and retries; calls already connected finish.
- To hear each state change, register a webhook for `batch.updated` and pass its endpoint as `status_webhook`. See `../inbound-webhook`.
