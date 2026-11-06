# Opt-out-aware texting

Replies inside an existing text conversation only when the API says it is allowed. Node and Python, no packages.

```bash
export SEMPERA_API_KEY=sempera_sk_...
node send-sms.mjs reply --conversation <conversation_id> \
  --message "Your appointment is confirmed for Friday at 3pm." \
  --consent "They texted us to book this appointment."
node send-sms.mjs opt-out --conversation <conversation_id>
```

The Python script takes the same arguments: `python3 send-sms.py reply ...` and `python3 send-sms.py opt-out ...`.

## The order of checks

1. `GET /v1/sms/conversations/{id}/policy`. The example stops here unless `consent` is `not_opted_out` and `can_send` is true. An `opted_out` recipient is reported as `opted_out` and nothing is sent; an unreadable record is reported as `consent_unreadable`.
2. `POST /v1/sms/conversations/{id}/messages` with `message`, `consent_basis` and an `Idempotency-Key`.
3. If the send is still refused with `PHONE_RECIPIENT_OPTED_OUT` (someone opted out between the two calls), the example reports `opted_out`. Any other error is raised unchanged.

`not_opted_out` is not proof that the person agreed to texts. The `consent` argument is what the send is based on, and the API records it. Write it as the reason the person has texted you, not as a general statement.

## Recording an opt-out

`opt-out` records a recipient's request to stop, when it reached you by a phone call or a form rather than a text. It sends no confirmation text and covers every sending number in the workspace. There is no restore action in the API: only an inbound START, UNSTOP or YES from the recipient restores texting.

## Requirements

- Node 18.3 or later, or Python 3.9 or later. No packages to install.
- A developer key with `calls:read` and `calls:write`, and a conversation id from `GET /v1/sms/conversations`.
