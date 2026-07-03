import { getDb } from "@/app/_data/db";
import { getProtocolSummaries } from "@/app/_data/queries";
import { jsonResponse, parseNow } from "@/app/api/_lib/http";
import {
  getPaymentRuntime,
  type PaymentRequirements,
  type RateLimitResult,
} from "@/lib/payments";

/** Read from the ledger DB at request time (never statically prerendered). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F-041 + F-042 — x402-metered protocol data endpoint.
 *
 * Flow per request:
 *  1. Authenticate the API key (F-042). Missing/unknown ⇒ 401.
 *  2. Per-key hard rate limit (F-042). Exceeded ⇒ 429 with Retry-After.
 *  3. x402 free/paid gate (F-041): free quota ⇒ serve; exhausted + no/invalid payment ⇒ 402
 *     with x402 `accepts` requirements; valid `X-PAYMENT` ⇒ serve (paid).
 *
 * The paid tier's on-chain settlement is verified through an injected verifier; this route
 * never touches a chain.
 */

/** Extract the presented API key from a Bearer header or `x-api-key`. */
function extractApiKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth !== null) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m && m[1]) return m[1].trim();
  }
  const header = req.headers.get("x-api-key");
  return header !== null && header.length > 0 ? header : null;
}

function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    "x-ratelimit-limit": String(r.limit),
    "x-ratelimit-remaining": String(r.remaining),
    "x-ratelimit-reset": String(Math.ceil(r.resetAt / 1000)),
  };
}

function paymentRequiredResponse(
  requirements: PaymentRequirements,
  reason: string,
): Response {
  return new Response(
    JSON.stringify({
      x402Version: 1,
      error: reason,
      accepts: [requirements],
    }),
    {
      status: 402,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-payment-required": "true",
      },
    },
  );
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const now = parseNow(url);
  const rt = getPaymentRuntime();

  // 1. Authenticate (F-042).
  const presented = extractApiKey(req);
  const key = rt.keys.authenticate(presented);
  if (key === null) {
    return jsonResponse(
      { error: "unauthorized", detail: "a valid API key is required" },
      401,
    );
  }

  // 2. Per-key hard rate limit (F-042).
  const meter = rt.keyRateLimiter.consume(key.id);
  if (!meter.allowed) {
    return new Response(
      JSON.stringify({ error: "rate_limited", retry_after_ms: meter.retryAfterMs }),
      {
        status: 429,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "retry-after": String(Math.ceil(meter.retryAfterMs / 1000)),
          ...rateLimitHeaders(meter),
        },
      },
    );
  }

  // 3. x402 free/paid gate (F-041).
  const payment = req.headers.get("x-payment");
  const decision = await rt.x402Gate.evaluate({ clientId: key.id, payment });

  if (decision.kind === "payment_required") {
    return paymentRequiredResponse(decision.requirements, decision.reason);
  }

  const protocols = getProtocolSummaries(getDb(), now);
  const body = JSON.stringify({
    protocols,
    count: protocols.length,
    billing:
      decision.kind === "paid"
        ? { tier: "paid", settlement: decision.verification }
        : { tier: "free", free_remaining: decision.meter.remaining },
  });

  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "x-payment-tier": decision.kind,
    ...rateLimitHeaders(meter),
  };
  if (decision.kind === "paid" && decision.verification.txHash !== undefined) {
    headers["x-payment-response"] = JSON.stringify({
      success: true,
      txHash: decision.verification.txHash,
      payer: decision.verification.payer ?? null,
    });
  }
  if (decision.kind === "free") {
    headers["x-free-tier-remaining"] = String(decision.meter.remaining);
  }

  return new Response(body, { status: 200, headers });
}
