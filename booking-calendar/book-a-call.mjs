#!/usr/bin/env node
// Check that a calendar is connected and verified, then place a call whose agent
// books through it.
//
//   SEMPERA_API_KEY=... node book-a-call.mjs --agent northwind-barbers \
//     --to +14165550100 --consent "They asked us to find a time for a trim."
//
// The calendar itself is connected in the Sempera App (Google Calendar and
// Cal.com use an OAuth screen there). The API cannot start that consent, so this
// example only finds a connection that already exists and checks it. The agent
// must also have that integration attached as a tool.

import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { clientFromEnv } from "../client.mjs";

export const BOOKING_TASK = "Offer the caller two open times from the connected calendar, then book the one they choose and confirm it back.";

// A calendar connection is connected, not merely configured or awaiting verification.
export function findConnectedCalendar(integrations) {
  return integrations.find(
    (item) => item.status === "connected" && /calendar|cal\.com|calendly/i.test(`${item.kind ?? ""} ${item.name ?? ""}`),
  );
}

export async function bookWithCalendar(client, { agent, to, consent, idempotencyKey = randomUUID() }) {
  if (!agent || !to || !consent) throw new Error("agent, to and consent are all required");
  const listed = await client.request("GET", "/v1/integrations");
  const calendar = findConnectedCalendar(listed.data?.integrations ?? []);
  if (!calendar) {
    throw new Error("no connected calendar: connect Google Calendar or Cal.com in the Sempera App, then run this again");
  }
  const verification = await client.request("POST", `/v1/integrations/${encodeURIComponent(calendar.id)}/verify`);
  if (verification.status !== "connected") {
    throw new Error(`calendar ${calendar.id} did not verify (status ${verification.status})`);
  }
  const call = await client.request("POST", "/v1/calls", {
    body: { agent_id: agent, to, consent_basis: consent, task: BOOKING_TASK },
    idempotencyKey,
  });
  return { integration: calendar.id, call };
}

function parse(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      agent: { type: "string" },
      to: { type: "string" },
      consent: { type: "string" },
      "idempotency-key": { type: "string" },
    },
    strict: true,
  });
  return { agent: values.agent, to: values.to, consent: values.consent, idempotencyKey: values["idempotency-key"] };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outcome = await bookWithCalendar(clientFromEnv(), parse(process.argv.slice(2)));
  console.log(JSON.stringify({ integration: outcome.integration, call: outcome.call.id, status: outcome.call.status }, null, 2));
}
