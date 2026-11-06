#!/usr/bin/env node
// Reply to an existing text conversation, but only after the API's policy says
// the recipient has not opted out and the thread can still be sent to.
//
//   SEMPERA_API_KEY=... node send-sms.mjs reply --conversation <id> \
//     --message "Your appointment is confirmed." --consent "They texted us to book."
//   SEMPERA_API_KEY=... node send-sms.mjs opt-out --conversation <id>
//
// Sempera also refuses a send to an opted-out recipient (PHONE_RECIPIENT_OPTED_OUT);
// this example reads the policy first so it can say why and not send at all.

import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { clientFromEnv, SemperaError } from "../client.mjs";

const thread = (id) => `/v1/sms/conversations/${encodeURIComponent(id)}`;

export async function readPolicy(client, conversationId) {
  const { data } = await client.request("GET", `${thread(conversationId)}/policy`);
  return data;
}

// Returns { sent: false, reason } when nothing was sent, or { sent: true, result }.
export async function replyIfAllowed(client, { conversationId, message, consent, idempotencyKey = randomUUID() }) {
  if (!conversationId || !message || !consent) throw new Error("conversation, message and consent are all required");
  const policy = await readPolicy(client, conversationId);
  if (policy.consent === "opted_out") return { sent: false, reason: "opted_out" };
  if (policy.consent !== "not_opted_out") return { sent: false, reason: "consent_unreadable" };
  if (!policy.can_send) return { sent: false, reason: policy.reason ?? "cannot_send" };
  try {
    const result = await client.request("POST", `${thread(conversationId)}/messages`, {
      body: { message, consent_basis: consent },
      idempotencyKey,
    });
    return { sent: true, result };
  } catch (err) {
    if (err instanceof SemperaError && err.code === "PHONE_RECIPIENT_OPTED_OUT") return { sent: false, reason: "opted_out" };
    throw err;
  }
}

// Record an opt-out the recipient gave outside the thread (a phone call, a form).
// It sends no text and returns the policy after the change.
export async function recordOptOut(client, { conversationId, idempotencyKey = randomUUID() }) {
  const { data } = await client.request("POST", `${thread(conversationId)}/opt-out`, { body: {}, idempotencyKey });
  return data;
}

function parse(argv) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      conversation: { type: "string" },
      message: { type: "string" },
      consent: { type: "string" },
      "idempotency-key": { type: "string" },
    },
    strict: true,
  });
  return { command, ...values, idempotencyKey: values["idempotency-key"] };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parse(process.argv.slice(2));
  const client = clientFromEnv();
  const conversationId = args.conversation;
  if (args.command === "reply") {
    const outcome = await replyIfAllowed(client, { conversationId, message: args.message, consent: args.consent, idempotencyKey: args.idempotencyKey });
    console.log(JSON.stringify(outcome.sent ? { sent: true } : outcome, null, 2));
  } else if (args.command === "opt-out") {
    console.log(JSON.stringify(await recordOptOut(client, { conversationId, idempotencyKey: args.idempotencyKey }), null, 2));
  } else {
    throw new Error("usage: send-sms.mjs reply|opt-out --conversation <id> [...]");
  }
}
