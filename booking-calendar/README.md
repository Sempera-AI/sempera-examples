# Booking with a calendar connection

Places a call whose agent offers two open times from a calendar you have connected, and books the one the caller picks. Node and Python, no packages.

```bash
export SEMPERA_API_KEY=sempera_sk_...
node book-a-call.mjs --agent northwind-barbers --to +14165550100 \
  --consent "They asked us to find a time for a trim."
python3 book-a-call.py --agent northwind-barbers --to +14165550100 \
  --consent "They asked us to find a time for a trim."
```

## What the example does

1. `GET /v1/integrations` lists the workspace's connections and takes the first one whose `status` is `connected` and whose name or kind says calendar (Google Calendar, Cal.com, Calendly).
2. `POST /v1/integrations/{id}/verify` checks that the connection still works now. Anything but `connected` stops the run.
3. `POST /v1/calls` places the call with the `task` that tells the agent to offer two times and book one.

## What the API cannot do here

- **Connect the calendar.** Google Calendar and Cal.com ask the workspace owner for consent on an OAuth screen in the Sempera App. The API lists and verifies connections; it does not start that consent. Connect once in the App, then use this example.
- **Attach the calendar to the agent.** The agent must have that integration as a tool. The example does not change the agent. Check it in the App, or through `PATCH /v1/agents/{id}/draft` with the tool set you have reviewed.
- **Guarantee the booking.** The call is the conversation. Whether a slot was booked is in the call record and the agent's tool timeline, which `GET /v1/calls/{id}` and the `call.completed` webhook report.

`consent` is required and never defaulted, for the same reason as the call example: it records why this person may be called.
