#!/usr/bin/env node
// A webhook receiver for Sempera's signed outbound events.
//
//   SEMPERA_WEBHOOK_SECRET=... PORT=8787 node receiver.mjs
//
// Point a registered https endpoint (POST /v1/webhooks) at this server's /sempera
// path through your own HTTPS front door. Every delivery is checked against
// X-Sempera-Signature before its body is parsed, and an event id already handled
// is acknowledged without running the handler again.

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

// X-Sempera-Signature is "t=<unix seconds>,v1=<hex HMAC-SHA256>". The HMAC is
// keyed with the endpoint secret over "<t>." followed by the raw body bytes.
export function verifySignature(secret, rawBody, header, { now = Date.now() / 1000, tolerance = 300 } = {}) {
  if (!secret || typeof header !== "string") return false;
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const at = part.indexOf("=");
      return [part.slice(0, at), part.slice(at + 1)];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(now - t) > tolerance) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest("hex"));
  const given = Buffer.from(parts.v1 ?? "");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// One delivery. `seen` is a Set of event ids this process has handled; keep it
// in a database in production, because deliveries are at least once.
export async function handleDelivery({ secret, headers, rawBody, seen, onEvent, now }) {
  if (!verifySignature(secret, rawBody, headers["x-sempera-signature"], { now })) {
    return { status: 401, reason: "bad_signature" };
  }
  const id = headers["x-sempera-event-id"];
  if (!id) return { status: 400, reason: "missing_event_id" };
  if (seen.has(id)) return { status: 200, reason: "duplicate" };
  const event = JSON.parse(rawBody.toString("utf8"));
  await onEvent(event);
  seen.add(id);
  return { status: 200, reason: "handled" };
}

export function startReceiver({ secret, port = 8787, onEvent = (event) => console.log(event.type, event.id) }) {
  const seen = new Set();
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/sempera") {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      try {
        const result = await handleDelivery({ secret, headers: req.headers, rawBody: Buffer.concat(chunks), seen, onEvent });
        res.writeHead(result.status, { "Content-Type": "application/json" }).end(JSON.stringify({ reason: result.reason }));
      } catch {
        res.writeHead(500).end();
      }
    });
  });
  return new Promise((resolve) => server.listen(port, "localhost", () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const secret = process.env.SEMPERA_WEBHOOK_SECRET;
  if (!secret) throw new Error("SEMPERA_WEBHOOK_SECRET is not set");
  const port = Number(process.env.PORT || 8787);
  await startReceiver({ secret, port });
  console.log(`listening on ${port} at /sempera`);
}
