#!/usr/bin/env node
// Place one outbound call with POST /v1/calls.
//
//   SEMPERA_API_KEY=... node send-call.mjs --agent northwind-barbers \
//     --to +14165550100 --consent "They asked us to call about Friday."
//
// consent is required: the API never decides who may be called for you, and
// neither does this example. Pass --idempotency-key to make a retry safe.

import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { clientFromEnv } from "../client.mjs";

export async function sendCall(client, { agent, to, consent, message, idempotencyKey = randomUUID() }) {
  if (!agent || !to || !consent) throw new Error("agent, to and consent are all required");
  const body = { agent_id: agent, to, consent_basis: consent };
  if (message) body.message = message;
  const call = await client.request("POST", "/v1/calls", { body, idempotencyKey });
  return call;
}

function parse(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      agent: { type: "string" },
      to: { type: "string" },
      consent: { type: "string" },
      message: { type: "string" },
      "idempotency-key": { type: "string" },
    },
    strict: true,
  });
  return {
    agent: values.agent,
    to: values.to,
    consent: values.consent,
    message: values.message,
    idempotencyKey: values["idempotency-key"],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parse(process.argv.slice(2));
  const call = await sendCall(clientFromEnv(), args);
  console.log(JSON.stringify({ id: call.id, status: call.status, direction: call.direction }, null, 2));
}
