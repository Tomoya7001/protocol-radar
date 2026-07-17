import { createHmac } from "node:crypto";

/**
 * C3 — outbound change webhook delivery (pure core).
 *
 * The observe loop (GitHub Actions, the only writable host) appends new change events to the
 * ledger, then this module POSTs those events to any externally-configured subscriber URLs
 * (Slack / Discord / a custom endpoint). It is deliberately a set of PURE, injectable helpers
 * so it is unit-testable offline and carries NO clock, NO env, and NO DB access of its own:
 *   - `generatedAt` is passed in (never Date.now()), so payloads are byte-stable and testable.
 *   - `fetchImpl` is injectable, so delivery is exercised without real network I/O.
 * It never touches the DB, the ledger, or the provenance invariant — it only formats and ships
 * event DTOs the runner script already read from the ledger.
 */

/** Header carrying the HMAC-SHA256 signature of the raw JSON body (sent only when a secret is set). */
export const WEBHOOK_SIGNATURE_HEADER = "X-Protocol-Radar-Signature";

/** Stable `source` marker embedded in every payload so receivers can attribute the feed. */
export const WEBHOOK_SOURCE = "protocol-radar";

/**
 * A single deliverable change event. Field names are stable JSON keys (the webhook contract).
 * These map directly from the existing read-side EventListItemDto (see listEventsDto):
 *   seq, protocol_key, protocol_name, type, summary, created_at, hash.
 * `hash` is the ledger event's tamper-evident chain hash — a receiver can cross-check it
 * against GET /api/verify. No field here is fabricated; all come from the read layer.
 */
export interface WebhookEvent {
  seq: number;
  protocol: string;
  protocolName: string;
  type: string;
  summary: string | null;
  createdAt: string;
  hash: string;
}

/** The JSON-serialisable payload POSTed to every subscriber. */
export interface WebhookPayload {
  source: string;
  generatedAt: string;
  count: number;
  events: WebhookEvent[];
}

export interface BuildWebhookPayloadOptions {
  /** Feed attribution marker; callers pass WEBHOOK_SOURCE. */
  source: string;
  /** ISO timestamp injected by the caller — NEVER Date.now(), so the payload is deterministic. */
  generatedAt: string;
}

/** Re-key a single event into a fixed field order so JSON.stringify output is byte-stable. */
function normalizeEvent(event: WebhookEvent): WebhookEvent {
  return {
    seq: event.seq,
    protocol: event.protocol,
    protocolName: event.protocolName,
    type: event.type,
    summary: event.summary,
    createdAt: event.createdAt,
    hash: event.hash,
  };
}

/**
 * Build a stable webhook payload from a set of events. Events are ordered by ascending `seq`
 * and re-keyed into a fixed shape, so the same logical set always serialises to identical
 * bytes regardless of input ordering — which keeps the HMAC signature reproducible.
 */
export function buildWebhookPayload(
  events: readonly WebhookEvent[],
  options: BuildWebhookPayloadOptions,
): WebhookPayload {
  const ordered = [...events].sort((a, b) => a.seq - b.seq).map(normalizeEvent);
  return {
    source: options.source,
    generatedAt: options.generatedAt,
    count: ordered.length,
    events: ordered,
  };
}

/** HMAC-SHA256 of the exact request body, hex-encoded. The shared secret authenticates the sender. */
export function signPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** Minimal request shape passed to the injected fetch implementation. */
export interface WebhookRequestInit {
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** Minimal response shape the delivery loop needs (a subset of the WHATWG Response). */
export interface WebhookResponseLike {
  ok: boolean;
  status: number;
}

/** Injectable fetch: real global fetch in production, a fake in tests. */
export type WebhookFetch = (
  url: string,
  init: WebhookRequestInit,
) => Promise<WebhookResponseLike>;

/** Per-URL outcome. `status` carries the HTTP status; `error` is set when the request threw. */
export interface DeliveryResult {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface DeliverWebhooksOptions {
  urls: readonly string[];
  payload: WebhookPayload;
  /** Optional HMAC secret. When absent/empty, no signature header is attached. */
  secret?: string;
  /** Optional fetch override; defaults to the global fetch. */
  fetchImpl?: WebhookFetch;
}

/** Default delivery uses the Node global fetch, adapting Response to WebhookResponseLike. */
const defaultFetch: WebhookFetch = async (url, init) => {
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
  });
  return { ok: res.ok, status: res.status };
};

/**
 * POST the payload to every URL as application/json, attaching the signature header when a
 * secret is configured. Each URL is delivered independently: a failure (network throw or a
 * rejected promise) is caught per-URL and recorded, so one bad subscriber never aborts the
 * rest. Returns one result per URL, in input order.
 */
export async function deliverWebhooks(
  options: DeliverWebhooksOptions,
): Promise<DeliveryResult[]> {
  const { urls, payload, secret } = options;
  const doFetch = options.fetchImpl ?? defaultFetch;
  const body = JSON.stringify(payload);

  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (secret !== undefined && secret.length > 0) {
    baseHeaders[WEBHOOK_SIGNATURE_HEADER] = `sha256=${signPayload(body, secret)}`;
  }

  const results: DeliveryResult[] = [];
  for (const url of urls) {
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { ...baseHeaders },
        body,
      });
      results.push({ url, ok: res.ok, status: res.status });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ url, ok: false, error: message });
    }
  }
  return results;
}

/**
 * Parse the comma-separated PROTOCOL_RADAR_WEBHOOK_URLS env value into a clean URL list:
 * split on commas, trim whitespace, drop empty entries. Undefined/null/empty ⇒ [] (no-op).
 */
export function parseWebhookUrls(raw: string | null | undefined): string[] {
  if (raw == null) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
