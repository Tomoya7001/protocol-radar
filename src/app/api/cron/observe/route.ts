import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/app/_data/db";
import { isReadonlyMode } from "@/lib/db";
import { FetchHttpClient } from "@/lib/fetch/httpClient";
import { consoleLogger } from "@/lib/fetch/logger";
import { observeReleasesAndVerify } from "@/worker/observeReleasesOnce";
import { jsonResponse } from "@/app/api/_lib/http";
import { getObserveDepsOverride } from "./deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 残② (実観測の常時稼働) — first step: a Vercel Cron-compatible endpoint that runs ONE
 * GitHub Releases observation pass and folds new events into the HMAC hash-chain ledger.
 *
 * GET /api/cron/observe
 *  - Guarded by CRON_SECRET (Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`).
 *    Missing/mismatched auth -> 401. Missing ledger key -> 503.
 *  - Reuses the SINGLE shared core observeReleasesAndVerify() (no duplicated observe logic).
 *
 * The test-only dependency override lives in ./deps (NOT this file): Next.js only permits a
 * fixed set of exports from a Route module, so a `__setObserveDepsForTests` export here would
 * fail the build ("... is not a valid Route export field").
 *
 * DEPLOYMENT CONSTRAINT (why this is only the "first step"):
 *   On Vercel the DB is served READ-ONLY (vercel.json sets PROTOCOL_RADAR_DB_READONLY=1 and
 *   DATABASE_PATH=./data/snapshot.db; VERCEL=1 also forces read-only). The serverless
 *   filesystem is ephemeral, so an observation could neither persist nor be served even if
 *   the connection were writable. Therefore, in read-only mode this route does NOT attempt
 *   any write: it reports the constraint and returns without observing.
 *
 *   The always-on path is: run this observation on a WRITABLE host (the canonical
 *   ./data/protocol-radar.db), then regenerate the snapshot and redeploy.
 *
 *   IMPLEMENTED (残②-next, first operational step): the writable observe->snapshot cycle is
 *   now a single command — `pnpm observe:refresh` (= `observe:once` then `snapshot`).
 *   observe:once loads .env.local (PROTOCOL_RADAR_HMAC_SECRET) via --env-file-if-exists and,
 *   with PROTOCOL_RADAR_DB_READONLY unset, opens ./data/protocol-radar.db writable, polls the
 *   configured GitHub Releases feeds once, folds new events into the HMAC ledger, and
 *   self-checks with verifyFromRaw(); snapshot then regenerates ./data/snapshot.db. Run it on
 *   a writable host (cron/self-hosted worker) and commit+redeploy the snapshot to publish.
 *   Still manual: scheduling the host loop and the git commit/redeploy of the new snapshot.
 */

/** Constant-time compare of two ASCII strings (avoids leaking the secret via timing). */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Authorize a cron request against CRON_SECRET. An unset secret is a misconfiguration and is
 * treated as DENY (never open the endpoint). Vercel Cron sends `Authorization: Bearer <s>`.
 */
function authorize(req: Request): { ok: true } | { ok: false; reason: string } {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret.length === 0) {
    return { ok: false, reason: "CRON_SECRET is not configured" };
  }
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!safeEqual(header, expected)) {
    return { ok: false, reason: "unauthorized" };
  }
  return { ok: true };
}

export async function GET(req: Request): Promise<Response> {
  const auth = authorize(req);
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: auth.reason }, 401);
  }

  // The ledger key is mandatory: without it append()/verify() refuse to run.
  const secret = process.env.PROTOCOL_RADAR_HMAC_SECRET;
  if (secret === undefined || secret.length === 0) {
    return jsonResponse(
      { ok: false, error: "PROTOCOL_RADAR_HMAC_SECRET is not configured" },
      503,
    );
  }

  // Read-only deployment: cannot persist an observation. Report the constraint (see the
  // DEPLOYMENT CONSTRAINT note above) and return 200 so the cron ping is not flagged failed.
  if (isReadonlyMode()) {
    return jsonResponse(
      {
        ok: false,
        skipped: "readonly-deployment",
        detail:
          "Database is read-only on this deployment; observation cannot be persisted here. " +
          "Run the observe loop on a writable host, then regenerate and redeploy the snapshot.",
      },
      200,
    );
  }

  const depsOverride = getObserveDepsOverride();
  const db = depsOverride?.db ?? getDb();
  const client = depsOverride?.client ?? new FetchHttpClient();
  const now = depsOverride?.now ?? new Date();

  const result = await observeReleasesAndVerify({
    db,
    client,
    now,
    repos: depsOverride?.repos,
    logger: consoleLogger,
  });

  // A failed ledger self-check is a 500: the observation ran but provenance is broken.
  const status = result.verified.ok ? 200 : 500;
  return jsonResponse(
    {
      ok: result.verified.ok,
      reposPolled: result.reposPolled,
      eventsCreated: result.eventsCreated,
      reposWithoutReleases: result.reposWithoutReleases,
      verified: result.verified,
      observedAt: now.toISOString(),
    },
    status,
  );
}
