/**
 * Reusable x402 + API-key access guard (F-041 / F-042).
 *
 * Factors out the 401 → 429 → 402 gate that every metered endpoint needs, so route files can
 * compose it in one call instead of re-inlining the flow. It is a PURE composition over the shared
 * {@link getPaymentRuntime} singleton — no new dependencies, no network, no DB. The demo route
 * src/app/api/x402/route.ts documents the canonical 3-step flow this helper implements:
 *
 *  1. Authenticate the presented API key (F-042). Missing/unknown ⇒ 401.
 *  2. Per-key hard rate limit (F-042). Exceeded ⇒ 429 with Retry-After + rate-limit headers.
 *  3. x402 free/paid gate (F-041). Free quota ⇒ allow (free); valid `X-PAYMENT` ⇒ allow (paid);
 *     otherwise ⇒ 402 with the x402 `accepts` requirements.
 *
 * Statelessness note: on serverless the in-memory key store / meters may reset per invocation, so
 * the PAID path is authorised solely by the per-request `X-PAYMENT` proof verified by the gate —
 * never by server-held state. Callers get the raw decision back and serve their own payload.
 */

import { jsonResponse } from "@/app/api/_lib/http";
import {
  getPaymentRuntime,
  type PaymentRequirements,
  type RateLimitResult,
  type X402Decision,
} from "@/lib/payments";

/** The x402 decision once the guard has passed — never `payment_required` (that becomes a 402). */
export type GrantedDecision = Extract<X402Decision, { kind: "free" | "paid" }>;

/** Result of {@link guardX402}: either an allowed request or a ready-to-return gate response. */
export type GuardResult =
  | { ok: true; decision: GrantedDecision; meter: RateLimitResult; keyId: string }
  | { ok: false; response: Response };

/** Extract the presented API key from a Bearer header or `x-api-key`. */
export function extractApiKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth !== null) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m && m[1]) return m[1].trim();
  }
  const header = req.headers.get("x-api-key");
  return header !== null && header.length > 0 ? header : null;
}

/** Standard `x-ratelimit-*` headers describing the per-key meter state. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    "x-ratelimit-limit": String(r.limit),
    "x-ratelimit-remaining": String(r.remaining),
    "x-ratelimit-reset": String(Math.ceil(r.resetAt / 1000)),
  };
}

/** Build the HTTP 402 body carrying the x402 `accepts` payment requirements. */
export function paymentRequiredResponse(
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

/**
 * Run the 3-step x402 guard against the shared payment runtime.
 *
 * Returns `{ ok: true, decision, meter, keyId }` when the request may proceed (the caller then
 * serves its payload and SHOULD merge {@link rateLimitHeaders}(meter) into its response), or
 * `{ ok: false, response }` with a fully-formed 401 / 429 / 402 the caller returns verbatim.
 */
export async function guardX402(req: Request): Promise<GuardResult> {
  const rt = getPaymentRuntime();

  // 1. Authenticate (F-042).
  const presented = extractApiKey(req);
  const key = rt.keys.authenticate(presented);
  if (key === null) {
    return {
      ok: false,
      response: jsonResponse(
        { error: "unauthorized", detail: "a valid API key is required" },
        401,
      ),
    };
  }

  // 2. Per-key hard rate limit (F-042).
  const meter = rt.keyRateLimiter.consume(key.id);
  if (!meter.allowed) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "rate_limited", retry_after_ms: meter.retryAfterMs }),
        {
          status: 429,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "retry-after": String(Math.ceil(meter.retryAfterMs / 1000)),
            ...rateLimitHeaders(meter),
          },
        },
      ),
    };
  }

  // 3. x402 free/paid gate (F-041).
  const payment = req.headers.get("x-payment");
  const decision = await rt.x402Gate.evaluate({ clientId: key.id, payment });
  if (decision.kind === "payment_required") {
    return {
      ok: false,
      response: paymentRequiredResponse(decision.requirements, decision.reason),
    };
  }

  return { ok: true, decision, meter, keyId: key.id };
}
