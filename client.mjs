// A minimal Sempera API client for the examples: bearer authentication, JSON
// bodies, Idempotency-Key, and one error type that carries the API's stable
// fields. It never prints or logs the key. No dependencies.

export class SemperaError extends Error {
  constructor(status, payload) {
    const error = payload?.error ?? {};
    super(`${status} ${error.code ?? "error"}: ${error.message ?? "request failed"}`);
    this.name = "SemperaError";
    this.status = status;
    this.code = error.code;
    this.reason = error.reason;
    this.field = error.field;
    this.requestId = error.request_id;
  }
}

export function createClient({ apiKey, baseUrl = "https://api.sempera.org", fetch = globalThis.fetch }) {
  if (!apiKey) throw new Error("SEMPERA_API_KEY is not set");
  const root = baseUrl.replace(/\/+$/, "");
  return {
    async request(method, path, { body, idempotencyKey } = {}) {
      const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      const res = await fetch(`${root}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = parseJson(await res.text());
      if (!res.ok) throw new SemperaError(res.status, payload);
      return payload;
    },
  };
}

export function clientFromEnv(env = process.env) {
  return createClient({ apiKey: env.SEMPERA_API_KEY, baseUrl: env.SEMPERA_API_BASE || undefined });
}

function parseJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
