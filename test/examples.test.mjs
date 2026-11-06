// Offline tests for the Node examples. The HTTP layer is a fake fetch: these
// prove request shapes, guards, the signature scheme and the output the examples
// print, not live API behaviour. Run with `npm test` from the examples folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, SemperaError } from "../client.mjs";
import { sendCall } from "../send-a-call/send-call.mjs";
import { verifySignature, handleDelivery } from "../inbound-webhook/receiver.mjs";
import { replyIfAllowed, recordOptOut } from "../sms-opt-out/send-sms.mjs";
import { findConnectedCalendar, bookWithCalendar } from "../booking-calendar/book-a-call.mjs";
import { parseCsv, recipientsFromCsv, batchBody, startBatch } from "../batch-csv/batch-calls.mjs";

const KEY = "sempera_sk_test_0123456789";

// routes: { "METHOD /path": { status, body } | (request) => { status, body } }
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    const { pathname } = new URL(url);
    const request = { method: init.method, path: pathname, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(request);
    const route = routes[`${init.method} ${pathname}`];
    if (!route) throw new Error(`unexpected ${init.method} ${pathname}`);
    const { status = 200, body = {} } = typeof route === "function" ? route(request) : route;
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
  return { fetch, calls };
}

const clientWith = (routes) => {
  const { fetch, calls } = fakeFetch(routes);
  return { client: createClient({ apiKey: KEY, baseUrl: "https://api.sempera.org/", fetch }), calls };
};

test("the client sends bearer auth, JSON and Idempotency-Key, and never puts the key in an error", async () => {
  const { client, calls } = clientWith({
    "POST /v1/calls": { status: 403, body: { error: { code: "insufficient_scope", message: "this credential cannot calls write", reason: "scope", request_id: "req_1" } } },
  });
  await assert.rejects(
    client.request("POST", "/v1/calls", { body: { a: 1 }, idempotencyKey: "k-1" }),
    (err) => {
      assert.ok(err instanceof SemperaError);
      assert.equal(err.status, 403);
      assert.equal(err.code, "insufficient_scope");
      assert.equal(err.requestId, "req_1");
      assert.ok(!String(err.message).includes(KEY));
      return true;
    },
  );
  assert.equal(calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].headers["Idempotency-Key"], "k-1");
  assert.equal(calls[0].path, "/v1/calls");
});

test("a missing key is refused before any request is made", () => {
  assert.throws(() => createClient({ apiKey: "" }), /SEMPERA_API_KEY is not set/);
});

test("sendCall posts the agent, number and consent basis, and refuses to run without consent", async () => {
  const { client, calls } = clientWith({ "POST /v1/calls": { status: 201, body: { id: "call-1", status: "answered", direction: "outbound" } } });
  const call = await sendCall(client, { agent: "northwind-barbers", to: "+14165550100", consent: "They asked.", idempotencyKey: "friday" });
  assert.equal(call.id, "call-1");
  assert.deepEqual(calls[0].body, { agent_id: "northwind-barbers", to: "+14165550100", consent_basis: "They asked." });
  assert.equal(calls[0].headers["Idempotency-Key"], "friday");
  await assert.rejects(sendCall(client, { agent: "northwind-barbers", to: "+14165550100", consent: "" }), /all required/);
  assert.equal(calls.length, 1, "no request without consent");
});

const SECRET = "whsec_vector_0123456789";
const VECTOR_BODY = Buffer.from('{"created_at":"2026-09-28T12:00:00+00:00","data":{"actor":"vector","endpoint_id":"22222222-2222-4222-8222-222222222222"},"id":"evt_00000000000000000000000000000001","object":"event","type":"webhook.test","workspace_id":"11111111-1111-4111-8111-111111111111"}');
const VECTOR_HEADER = "t=1790000000,v1=1f4226699ca9fa61b71fbb57dbd2f57efa6788488437ee2e411ea4e3002be3c1";

test("the signature check passes the published known answer and refuses tampering, staleness and the wrong secret", () => {
  const now = 1790000000;
  assert.equal(verifySignature(SECRET, VECTOR_BODY, VECTOR_HEADER, { now }), true);
  assert.equal(verifySignature(SECRET, Buffer.from(VECTOR_BODY.toString().replace("vector", "other")), VECTOR_HEADER, { now }), false);
  assert.equal(verifySignature(SECRET, VECTOR_BODY, VECTOR_HEADER, { now: now + 301 }), false);
  assert.equal(verifySignature(SECRET, VECTOR_BODY, VECTOR_HEADER, { now: now - 301 }), false);
  assert.equal(verifySignature("whsec_wrong_secret_value", VECTOR_BODY, VECTOR_HEADER, { now }), false);
  assert.equal(verifySignature(SECRET, VECTOR_BODY, undefined, { now }), false);
});

test("a receiver handles a signed event once, acknowledges a repeat, and refuses an unsigned one", async () => {
  const seen = new Set();
  const handled = [];
  const onEvent = (event) => handled.push(event.type);
  const headers = { "x-sempera-signature": VECTOR_HEADER, "x-sempera-event-id": "evt_00000000000000000000000000000001" };
  const now = 1790000000;
  assert.deepEqual(await handleDelivery({ secret: SECRET, headers, rawBody: VECTOR_BODY, seen, onEvent, now }), { status: 200, reason: "handled" });
  assert.deepEqual(await handleDelivery({ secret: SECRET, headers, rawBody: VECTOR_BODY, seen, onEvent, now }), { status: 200, reason: "duplicate" });
  assert.deepEqual(await handleDelivery({ secret: SECRET, headers: {}, rawBody: VECTOR_BODY, seen, onEvent, now }), { status: 401, reason: "bad_signature" });
  assert.deepEqual(handled, ["webhook.test"]);
});

test("replyIfAllowed sends nothing to an opted-out recipient and says why", async () => {
  const { client, calls } = clientWith({
    "GET /v1/sms/conversations/sc-1/policy": { body: { data: { consent: "opted_out", can_send: false, reason: "opted_out" } } },
  });
  const outcome = await replyIfAllowed(client, { conversationId: "sc-1", message: "Hi", consent: "They texted." });
  assert.deepEqual(outcome, { sent: false, reason: "opted_out" });
  assert.equal(calls.length, 1, "only the policy was read");
});

test("replyIfAllowed sends with the consent basis when the policy allows it", async () => {
  const { client, calls } = clientWith({
    "GET /v1/sms/conversations/sc-1/policy": { body: { data: { consent: "not_opted_out", can_send: true } } },
    "POST /v1/sms/conversations/sc-1/messages": { status: 201, body: { data: { status: "sent" } } },
  });
  const outcome = await replyIfAllowed(client, { conversationId: "sc-1", message: "Confirmed.", consent: "They texted.", idempotencyKey: "r-1" });
  assert.equal(outcome.sent, true);
  assert.deepEqual(calls[1].body, { message: "Confirmed.", consent_basis: "They texted." });
  assert.equal(calls[1].headers["Idempotency-Key"], "r-1");
});

test("a send refused as opted out at the last moment is reported, not thrown", async () => {
  const { client } = clientWith({
    "GET /v1/sms/conversations/sc-1/policy": { body: { data: { consent: "not_opted_out", can_send: true } } },
    "POST /v1/sms/conversations/sc-1/messages": { status: 403, body: { error: { code: "PHONE_RECIPIENT_OPTED_OUT", message: "The recipient texted STOP" } } },
  });
  assert.deepEqual(await replyIfAllowed(client, { conversationId: "sc-1", message: "Hi", consent: "They texted." }), { sent: false, reason: "opted_out" });
});

test("recordOptOut posts an empty object and returns the policy", async () => {
  const { client, calls } = clientWith({
    "POST /v1/sms/conversations/sc-1/opt-out": { body: { data: { consent: "opted_out" } } },
  });
  assert.deepEqual(await recordOptOut(client, { conversationId: "sc-1", idempotencyKey: "o-1" }), { consent: "opted_out" });
  assert.deepEqual(calls[0].body, {});
});

test("bookWithCalendar stops when no calendar is connected, and never places a call", async () => {
  const { client, calls } = clientWith({
    "GET /v1/integrations": { body: { data: { integrations: [{ id: "int-1", kind: "crm", name: "CRM", status: "connected" }] } } },
  });
  await assert.rejects(bookWithCalendar(client, { agent: "northwind-barbers", to: "+14165550100", consent: "They asked." }), /no connected calendar/);
  assert.equal(calls.length, 1);
});

test("bookWithCalendar verifies a connected calendar and places the booking call", async () => {
  const { client, calls } = clientWith({
    "GET /v1/integrations": { body: { data: { integrations: [{ id: "int-9", kind: "google_calendar", name: "Calendar", status: "connected" }] } } },
    "POST /v1/integrations/int-9/verify": { body: { object: "integration_verification", integration_id: "int-9", status: "connected" } },
    "POST /v1/calls": { status: 201, body: { id: "call-9", status: "answered" } },
  });
  const outcome = await bookWithCalendar(client, { agent: "northwind-barbers", to: "+14165550100", consent: "They asked.", idempotencyKey: "b-1" });
  assert.equal(outcome.integration, "int-9");
  assert.equal(outcome.call.id, "call-9");
  assert.equal(calls[2].body.agent_id, "northwind-barbers");
  assert.match(calls[2].body.task, /book the one they choose/);
});

test("findConnectedCalendar ignores a calendar that is only configured", () => {
  assert.equal(findConnectedCalendar([{ id: "a", kind: "calendar", status: "configured" }]), undefined);
  assert.equal(findConnectedCalendar([{ id: "b", name: "Cal.com", status: "connected" }]).id, "b");
});

test("the CSV parser keeps quoted commas and doubled quotes and rejects an open quote", () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\n'), [["a", "b"], ["x, y", 'say "hi"']]);
  assert.throws(() => parseCsv('a,"b\n'), /quoted field/);
});

test("recipientsFromCsv turns each row into a call object and drops empty metadata", () => {
  const recipients = recipientsFromCsv("phone_number,first_name,appointment,timezone\n+14165550100,Ada,,America/Toronto\n");
  assert.deepEqual(recipients, [{ phone_number: "+14165550100", timezone: "America/Toronto", metadata: { first_name: "Ada" } }]);
});

test("recipientsFromCsv refuses the whole file when a row has no number, and names the line", () => {
  assert.throws(() => recipientsFromCsv("phone_number,first_name\n+14165550100,Ada\n,Grace\n"), /line 3 has no phone_number/);
  assert.throws(() => recipientsFromCsv("first_name\nAda\n"), /phone_number column/);
});

test("startBatch posts the global consent and the call objects with an idempotency key", async () => {
  const { client, calls } = clientWith({
    "POST /v2/batches/create": { status: 201, body: { data: { id: "batch-1", state: "running", summary: {} } } },
  });
  const outcome = await startBatch(client, { agent: "northwind-barbers", consent: "They booked.", csvText: "phone_number\n+14165550100\n", idempotencyKey: "batch-key" });
  assert.equal(outcome.recipients, 1);
  assert.equal(outcome.batch.id, "batch-1");
  assert.equal(calls[0].headers["Idempotency-Key"], "batch-key");
  assert.deepEqual(batchBody({ agent: "a", consent: "c", recipients: [{ phone_number: "+1" }] }), {
    global: { agent_id: "a", consent_basis: "c" },
    call_objects: [{ phone_number: "+1" }],
  });
});

test("the curl example is valid bash", () => {
  const script = fileURLToPath(new URL("../send-a-call/send-call.sh", import.meta.url));
  assert.equal(spawnSync("bash", ["-n", script]).status, 0);
});

test("no example file uses an em dash", () => {
  const files = [
    "../README.md", "../client.mjs", "../client.py", "../send-a-call/README.md", "../send-a-call/send-call.mjs",
    "../send-a-call/send-call.py", "../send-a-call/send-call.sh", "../inbound-webhook/README.md",
    "../inbound-webhook/receiver.mjs", "../inbound-webhook/receiver.py", "../sms-opt-out/README.md",
    "../sms-opt-out/send-sms.mjs", "../sms-opt-out/send-sms.py", "../booking-calendar/README.md",
    "../booking-calendar/book-a-call.mjs", "../booking-calendar/book-a-call.py", "../batch-csv/README.md",
    "../batch-csv/batch-calls.mjs", "../batch-csv/batch-calls.py", "../batch-csv/sample-recipients.csv",
  ];
  for (const file of files) {
    assert.ok(!readFileSync(new URL(file, import.meta.url), "utf8").includes("\u2014"), file);
  }
});
