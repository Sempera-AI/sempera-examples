#!/usr/bin/env node
// Start an outbound call batch from a CSV file with POST /v2/batches/create.
//
//   SEMPERA_API_KEY=... node batch-calls.mjs --agent northwind-barbers \
//     --csv sample-recipients.csv --consent "They booked with us and asked for reminders."
//   node batch-calls.mjs --csv sample-recipients.csv --consent "..." --agent northwind-barbers --dry-run
//
// The CSV needs a phone_number column. An optional timezone column applies to
// its row. Every other column becomes that recipient's metadata (text values
// the agent's opening template can use). One bad row refuses the whole batch.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { clientFromEnv } from "../client.mjs";

// RFC 4180 style: quoted fields may hold commas, line breaks and doubled quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error("the CSV ends inside a quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

// Each row becomes one call object. A row without a phone number is an error
// that names its line, because the API refuses the batch rather than skipping it.
export function recipientsFromCsv(text) {
  const [header, ...lines] = parseCsv(text);
  if (!header || !header.map((h) => h.trim()).includes("phone_number")) {
    throw new Error("the CSV needs a phone_number column");
  }
  const columns = header.map((h) => h.trim());
  return lines.map((cells, index) => {
    const line = index + 2;
    if (cells.length !== columns.length) throw new Error(`line ${line} has ${cells.length} fields, expected ${columns.length}`);
    const record = Object.fromEntries(columns.map((name, i) => [name, cells[i].trim()]));
    if (!record.phone_number) throw new Error(`line ${line} has no phone_number`);
    const { phone_number, timezone, ...metadata } = record;
    const object = { phone_number };
    if (timezone) object.timezone = timezone;
    const kept = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== ""));
    if (Object.keys(kept).length > 0) object.metadata = kept;
    return object;
  });
}

export function batchBody({ agent, consent, description, recipients }) {
  const body = { global: { agent_id: agent, consent_basis: consent }, call_objects: recipients };
  if (description) body.description = description;
  return body;
}

export async function startBatch(client, { agent, consent, description, csvText, idempotencyKey = randomUUID() }) {
  if (!agent || !consent) throw new Error("agent and consent are both required");
  const recipients = recipientsFromCsv(csvText);
  if (recipients.length === 0) throw new Error("the CSV has no recipients");
  const created = await client.request("POST", "/v2/batches/create", {
    body: batchBody({ agent, consent, description, recipients }),
    idempotencyKey,
  });
  return { recipients: recipients.length, batch: created.data ?? created };
}

function parse(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      agent: { type: "string" },
      csv: { type: "string" },
      consent: { type: "string" },
      description: { type: "string" },
      "idempotency-key": { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    strict: true,
  });
  return {
    agent: values.agent,
    csv: values.csv,
    consent: values.consent,
    description: values.description,
    idempotencyKey: values["idempotency-key"],
    dryRun: values["dry-run"],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parse(process.argv.slice(2));
  if (!args.csv) throw new Error("--csv <file> is required");
  const csvText = readFileSync(args.csv, "utf8");
  if (args.dryRun) {
    const recipients = recipientsFromCsv(csvText);
    console.log(JSON.stringify({ dry_run: true, recipients: recipients.length, first: recipients.slice(0, 2) }, null, 2));
  } else {
    const { recipients, batch } = await startBatch(clientFromEnv(), { ...args, csvText });
    console.log(JSON.stringify({ recipients, id: batch.id, state: batch.state, summary: batch.summary }, null, 2));
  }
}
