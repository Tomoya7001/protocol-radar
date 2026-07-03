import type { Db } from "@/lib/db";
import { verify, verifyFromRaw, LedgerSecretError } from "@/lib/ledger";

/**
 * F-034 backing logic. Wraps the F-002 ledger verifiers into a stable, serialisable result
 * used by BOTH the /verify page and GET /api/verify, so the human page and the API can never
 * disagree.
 *
 * Two modes:
 *  - "raw"   (default): recompute sha256 of each referenced raw observation body and compare
 *            to the content_hash bound into the chain — the true tamper-evidence proof.
 *  - "chain": field-level chain check only (trusts the stored content_hash column).
 */
export type VerifyMode = "raw" | "chain";

export type VerifyOutcome =
  | { ok: true; mode: VerifyMode; checked: number; unavailable?: false }
  | {
      ok: false;
      mode: VerifyMode;
      checked: number;
      tampered_seq: number;
      reason: string;
      unavailable?: false;
    }
  | {
      ok: false;
      mode: VerifyMode;
      checked: 0;
      unavailable: true;
      reason: string;
    };

export function parseVerifyMode(value: string | null): VerifyMode {
  return value === "chain" ? "chain" : "raw";
}

function countEvents(db: Db): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM events").get() as {
    c: number;
  };
  return row.c;
}

/**
 * Run the requested verification. Returns a structured outcome. If the ledger secret is
 * unset the verifiers throw LedgerSecretError; we surface that as an `unavailable` result
 * (mapped to HTTP 503 by the route) rather than leaking a stack trace.
 */
export function runVerify(db: Db, mode: VerifyMode): VerifyOutcome {
  try {
    const checked = countEvents(db);
    const result = mode === "chain" ? verify(db) : verifyFromRaw(db);
    if (result.ok) {
      return { ok: true, mode, checked };
    }
    return {
      ok: false,
      mode,
      checked,
      tampered_seq: result.tamperedSeq,
      reason: result.reason,
    };
  } catch (err) {
    if (err instanceof LedgerSecretError) {
      return {
        ok: false,
        mode,
        checked: 0,
        unavailable: true,
        reason: "ledger secret is not configured",
      };
    }
    throw err;
  }
}
