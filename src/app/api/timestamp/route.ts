import { buildTimestampResponse } from "@/lib/timestamp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F6 - GET /api/timestamp
 * Returns the current ledger head's OpenTimestamps (Bitcoin) anchor status, read entirely from
 * the DB + the committed `data/anchors/<head>.ots` proof at request time (NO network). All logic
 * lives in @/lib/timestamp; this Route file exports ONLY the Next.js-allowed runtime/dynamic/GET
 * (A3/B1 lesson: never export a handler field Next.js rejects at build).
 */
export async function GET(req: Request): Promise<Response> {
  return buildTimestampResponse(req);
}
